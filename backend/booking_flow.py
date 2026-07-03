"""
Booking + Payment lifecycle state machine + Razorpay helpers for advance
payment link and balance QR code.

Status model:
  booking_status: Pending → Confirmed → In Progress → Completed
                  (or Cancelled at any point)
  payment_status: Advance Pending → Advance Received/Partial Paid → Fully Paid

Rules:
  advance_paid == 0                              -> Advance Pending
  0 < advance_paid < advance_amount              -> Partial Paid
  advance_amount <= advance_paid < total_amount  -> Advance Received
  advance_paid >= total_amount                   -> Fully Paid

  booking_status starts Pending. When Advance Received or better it becomes
  Confirmed. On event date, a background job flips Confirmed -> In Progress.
  When Fully Paid AND status is In Progress, becomes Completed.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def compute_payment_status(booking: dict) -> str:
    advance_paid = float(booking.get("advance_paid") or 0)
    total = float(booking.get("total_amount") or 0)
    if total > 0 and advance_paid >= total:
        return "Fully Paid"
    if advance_paid <= 0:
        return "Advance Pending"
    return "Partial Paid"


def compute_booking_status(booking: dict, today_iso: Optional[str] = None) -> str:
    """Derive booking_status.
    Rules:
      - Cancelled stays Cancelled
      - Fully Paid → Completed (immediate, regardless of event date)
      - Advance Pending → Pending
      - Partial Paid + event_date == today → In Progress
      - Partial Paid + already In Progress → stays In Progress
      - Partial Paid otherwise → Confirmed
    """
    current = booking.get("booking_status") or booking.get("status") or "Pending"
    if current == "Cancelled":
        return "Cancelled"
    payment_status = compute_payment_status(booking)
    event_date = booking.get("event_date") or ""
    today = today_iso or datetime.now(timezone.utc).date().isoformat()

    if payment_status == "Fully Paid":
        return "Completed"
    if payment_status == "Advance Pending":
        return "Pending"
    # Partial Paid from here
    if event_date == today:
        return "In Progress"
    if current == "In Progress":
        return "In Progress"
    return "Confirmed"


def apply_derived(booking: dict) -> dict:
    """Mutates booking to add derived fields and returns it."""
    if "advance_amount" not in booking or booking.get("advance_amount") in (None, 0):
        booking["advance_amount"] = 2000.0
    booking["payment_status"] = compute_payment_status(booking)
    booking["booking_status"] = compute_booking_status(booking)
    booking["balance_amount"] = max(
        0.0, float(booking.get("total_amount") or 0) - float(booking.get("advance_paid") or 0)
    )
    # keep legacy `status` in sync so old UI keeps working
    booking["status"] = booking["booking_status"]
    return booking


async def create_advance_link(rzp_client, booking: dict) -> Optional[dict]:
    """Create a Razorpay payment link for the advance amount. Returns dict with
    id, url, status; None on failure."""
    if not rzp_client:
        return None
    amount = float(booking.get("advance_amount") or 2000)
    if amount <= 0:
        return None
    try:
        link = rzp_client.payment_link.create({
            "amount": int(amount * 100),
            "currency": "INR",
            "accept_partial": False,
            "description": f"Advance payment for {booking.get('booking_number', '')}",
            "customer": {
                "name": booking.get("customer_name", "") or "Customer",
                "contact": booking.get("mobile", "") or "",
            },
            "notify": {"sms": True, "email": False},
            "reminder_enable": True,
            "notes": {
                "booking_id": booking.get("id", ""),
                "booking_number": booking.get("booking_number", ""),
                "purpose": "advance",
            },
        })
        return {
            "id": link.get("id"),
            "url": link.get("short_url"),
            "status": link.get("status", "created"),
        }
    except Exception as e:
        logger.warning(f"create_advance_link failed: {e}")
        return None


async def create_balance_qr(rzp_client, booking: dict) -> Optional[dict]:
    """Create a Razorpay payment link for the outstanding balance amount and
    render its short URL as a QR code image (PNG data URL) so customers can
    scan-and-pay. This gives us Razorpay webhook events + a scannable QR.
    Returns {id, image_url, payment_url, payment_amount, status} or None."""
    if not rzp_client:
        return None
    total = float(booking.get("total_amount") or 0)
    paid = float(booking.get("advance_paid") or 0)
    balance = max(0.0, total - paid)
    if balance <= 0:
        return None
    try:
        link = rzp_client.payment_link.create({
            "amount": int(balance * 100),
            "currency": "INR",
            "accept_partial": False,
            "description": f"Balance for {booking.get('booking_number', '')}",
            "customer": {
                "name": (booking.get("customer_name") or "Customer")[:64],
                "contact": booking.get("mobile", "") or "",
            },
            "notify": {"sms": True, "email": False},
            "reminder_enable": True,
            "notes": {
                "booking_id": booking.get("id", ""),
                "booking_number": booking.get("booking_number", ""),
                "purpose": "balance",
            },
        })
        url = link.get("short_url", "")
        # Render QR image as base64 PNG data URL
        image_data_url = _make_qr_data_url(url)
        return {
            "id": link.get("id"),
            "image_url": image_data_url,
            "payment_url": url,
            "payment_amount": balance,
            "status": link.get("status", "created"),
        }
    except Exception as e:
        logger.warning(f"create_balance_qr failed: {e}")
        return None


def _make_qr_data_url(text: str) -> str:
    """Return a data:image/png;base64,... URL for the given text (safe in <img>)."""
    import io
    import base64
    import qrcode
    img = qrcode.make(text, box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


async def apply_payment(db, booking_id: str, amount: float, method: str = "Razorpay",
                        note: str = "", rzp_pay_id: Optional[str] = None,
                        source: str = "manual") -> Optional[dict]:
    """Idempotently record a payment against a booking and refresh statuses.
    Returns the updated booking dict, or None if booking not found."""
    b = await db.bookings.find_one({"id": booking_id})
    if not b:
        return None
    # Idempotency by rzp payment id
    if rzp_pay_id:
        if await db.payments.find_one({"rzp_payment_id": rzp_pay_id}):
            logger.info(f"apply_payment: duplicate rzp_payment_id {rzp_pay_id}, skipping")
            b.pop("_id", None)
            return apply_derived(b)
    new_advance = float(b.get("advance_paid") or 0) + float(amount)
    receipt_no = "RCPT-" + datetime.now(timezone.utc).strftime("%y%m%d") + "-" + uuid.uuid4().hex[:5].upper()
    payment_doc = {
        "id": str(uuid.uuid4()),
        "booking_id": booking_id,
        "amount": float(amount),
        "method": method,
        "note": note,
        "rzp_payment_id": rzp_pay_id,
        "receipt_no": receipt_no,
        "source": source,  # "advance_link" | "balance_qr" | "manual" | "webhook"
        "created_at": now_iso(),
    }
    await db.payments.insert_one(payment_doc)
    await db.bookings.update_one({"id": booking_id}, {"$set": {
        "advance_paid": new_advance,
        "updated_at": now_iso(),
    }})
    updated = await db.bookings.find_one({"id": booking_id})
    updated.pop("_id", None)
    apply_derived(updated)
    # persist derived booking_status so background sweeps don't need to recompute
    await db.bookings.update_one({"id": booking_id}, {"$set": {
        "booking_status": updated["booking_status"],
        "payment_status": updated["payment_status"],
        "status": updated["status"],
    }})
    return updated


async def sweep_event_day(db):
    """Flip Confirmed -> In Progress for bookings whose event_date is today.
    Idempotent, run periodically."""
    today = datetime.now(timezone.utc).date().isoformat()
    async for b in db.bookings.find({"event_date": today}):
        derived = apply_derived({**b})
        if derived["booking_status"] != b.get("booking_status"):
            await db.bookings.update_one({"id": b["id"]}, {"$set": {
                "booking_status": derived["booking_status"],
                "payment_status": derived["payment_status"],
                "status": derived["status"],
                "updated_at": now_iso(),
            }})
            logger.info(f"sweep: {b.get('booking_number')} -> {derived['booking_status']}")


GOOGLE_REVIEW_URL = os.environ.get(
    "GOOGLE_REVIEW_URL", "https://maps.app.goo.gl/RA3EktprJ4rqN5Su7"
)


def build_wa_link(mobile: str, text: str) -> str:
    """Build a wa.me click-to-chat link with pre-filled message."""
    import urllib.parse
    num = "".join(ch for ch in (mobile or "") if ch.isdigit())
    return f"https://wa.me/{num}?text={urllib.parse.quote(text)}"
