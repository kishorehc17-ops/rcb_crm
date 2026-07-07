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

GOOGLE_REVIEW_URL = os.environ.get(
    "GOOGLE_REVIEW_URL", "https://maps.app.goo.gl/RA3EktprJ4rqN5Su7"
)


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

    old_status = b.get("booking_status") or b.get("status") or "Pending"

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

    # Send WhatsApp notifications on status transitions
    new_status = updated["booking_status"]

    # Send booking_confirmed when transitioning to Confirmed
    if new_status == "Confirmed" and old_status != "Confirmed" and not b.get("booking_confirmed_sent"):
        await send_booking_confirmed_whatsapp(db, updated)

    # Send thank-you when transitioning to Completed
    if new_status == "Completed" and old_status != "Completed" and not b.get("thank_you_sent"):
        await send_thank_you_whatsapp(db, updated)

    return updated


async def sweep_event_day(db):
    """Flip Confirmed -> In Progress for bookings whose event_date is today.
    Also transitions Fully Paid bookings to Completed.
    Sends event_day WhatsApp when transitioning to In Progress.
    Sends thank-you WhatsApp when transitioning to Completed.
    Idempotent, run periodically."""
    today = datetime.now(timezone.utc).date().isoformat()
    async for b in db.bookings.find({"event_date": today}):
        old_status = b.get("booking_status") or b.get("status") or "Pending"
        derived = apply_derived({**b})
        if derived["booking_status"] != old_status:
            await db.bookings.update_one({"id": b["id"]}, {"$set": {
                "booking_status": derived["booking_status"],
                "payment_status": derived["payment_status"],
                "status": derived["status"],
                "updated_at": now_iso(),
            }})
            logger.info(f"sweep: {b.get('booking_number')} -> {derived['booking_status']}")

            # Send event_day WhatsApp when transitioning to In Progress
            if derived["booking_status"] == "In Progress" and old_status != "In Progress" and not b.get("event_day_sent"):
                b.pop("_id", None)
                await send_event_day_whatsapp(db, derived)

            # Send thank-you WhatsApp when transitioning to Completed
            if derived["booking_status"] == "Completed" and old_status != "Completed" and not b.get("thank_you_sent"):
                await send_thank_you_whatsapp(db, derived)


async def sweep_one_day_before(db):
    """Send event reminder WhatsApp to customers one day before their event.
    Runs daily, idempotent based on event_reminder_sent flag."""
    from datetime import timedelta
    tomorrow = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
    async for b in db.bookings.find({"event_date": tomorrow}):
        if not b.get("event_reminder_sent"):
            # Only send to Confirmed or In Progress bookings
            status = b.get("booking_status") or b.get("status") or "Pending"
            if status in ("Confirmed", "In Progress"):
                b.pop("_id", None)
                await send_event_reminder_whatsapp(db, b)


async def _send_whatsapp(db, mobile: str, message: str, label: str = "notification") -> bool:
    """Helper to send WhatsApp via Deropo or store locally. Returns True if sent."""
    from deropo import is_enabled as deropo_enabled, send_text as deropo_send_text

    if not mobile:
        return False

    sent = False
    try:
        if deropo_enabled():
            result = await deropo_send_text(mobile, message)
            sent = result.get("ok", False)
            if sent:
                logger.info(f"{label} WhatsApp sent via Deropo to {mobile}")
            else:
                logger.warning(f"Deropo send failed for {mobile}: {result.get('error')}")
        else:
            wa_doc = {
                "id": str(uuid.uuid4()),
                "wa_id": mobile,
                "direction": "out",
                "type": "text",
                "text": message,
                "status": f"sent (mock {label})",
                "created_at": now_iso(),
            }
            await db.wa_messages.insert_one(wa_doc)
            logger.info(f"{label} message recorded locally (no Deropo)")
            sent = True
    except Exception as e:
        logger.exception(f"Failed to send {label} WhatsApp")
        sent = False

    return sent


async def send_booking_created_whatsapp(db, booking: dict) -> bool:
    """Send WhatsApp when a new booking is created (Pending status)."""
    if booking.get("booking_created_sent"):
        return False

    mobile = booking.get("mobile", "")
    customer_name = booking.get("customer_name", "Customer")
    booking_number = booking.get("booking_number", "")
    event_date = booking.get("event_date", "")
    event_time = booking.get("event_time", "")
    location = booking.get("location", "")
    theme = booking.get("theme", "")
    package_name = booking.get("package_name", "")
    total_amount = booking.get("total_amount", 0)
    advance_amount = booking.get("advance_amount", 2000)

    message = (
        f"Thank you for contacting RCB Events!\n\n"
        f"Your booking request has been created successfully.\n\n"
        f"Please complete the advance payment to confirm your booking.\n\n"
        f"Booking ID: {booking_number}\n"
        f"Customer: {customer_name}\n"
        f"Event Date: {event_date}\n"
        f"Event Time: {event_time}\n"
        f"Location: {location}\n"
        f"Theme: {theme}\n"
        f"Package: {package_name}\n"
        f"Total Amount: ₹{total_amount:,.0f}\n"
        f"Advance Amount: ₹{advance_amount:,.0f}"
    )

    sent = await _send_whatsapp(db, mobile, message, "booking_created")
    if sent:
        await db.bookings.update_one(
            {"id": booking.get("id")},
            {"$set": {"booking_created_sent": True, "booking_created_sent_at": now_iso()}}
        )
    return sent


async def send_booking_confirmed_whatsapp(db, booking: dict) -> bool:
    """Send WhatsApp when booking status changes to Confirmed (advance received)."""
    if booking.get("booking_confirmed_sent"):
        return False

    mobile = booking.get("mobile", "")
    customer_name = booking.get("customer_name", "Customer")
    booking_number = booking.get("booking_number", "")
    event_date = booking.get("event_date", "")
    event_time = booking.get("event_time", "")
    location = booking.get("location", "")
    theme = booking.get("theme", "")
    package_name = booking.get("package_name", "")
    addons = ", ".join(booking.get("selected_addons", [])) or "None"
    special_req = booking.get("special_requirements", "None")
    total_amount = booking.get("total_amount", 0)
    advance_paid = booking.get("advance_paid", 0)
    balance = float(total_amount) - float(advance_paid)

    message = (
        f"🎉 *Booking Confirmed!*\n\n"
        f"Dear *{customer_name}*,\n\n"
        f"Thank you for choosing **RCB Events**.\n"
        f"Your booking has been successfully confirmed.\n\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"📌 *Booking Details*\n\n"
        f"🆔 Booking ID: {booking_number}\n"
        f"📅 Event Date: {event_date}\n"
        f"🕒 Event Time: {event_time}\n"
        f"📍 Location: {location}\n"
        f"🎈 Theme: {theme}\n"
        f"🎁 Package: {package_name}\n"
        f"✨ Add-ons: {addons}\n"
        f"📝 Special Requirements: {special_req}\n\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"💰 *Payment Summary*\n\n"
        f"Package Amount: ₹{total_amount:,.0f}\n"
        f"Advance Paid: ₹{advance_paid:,.0f}\n"
        f"Balance Amount: ₹{balance:,.0f}\n\n"
        f"━━━━━━━━━━━━━━━━━━\n\n"
        f"Our team will contact you before the event for final coordination.\n\n"
        f"Thank you for trusting **RCB Events**.\n\n"
        f"❤️ Team RCB Events"
    )

    sent = await _send_whatsapp(db, mobile, message, "booking_confirmed")
    if sent:
        await db.bookings.update_one(
            {"id": booking.get("id")},
            {"$set": {"booking_confirmed_sent": True, "booking_confirmed_sent_at": now_iso()}}
        )
    return sent


async def send_event_reminder_whatsapp(db, booking: dict) -> bool:
    """Send WhatsApp one day before the event with balance reminder."""
    if booking.get("event_reminder_sent"):
        return False

    mobile = booking.get("mobile", "")
    customer_name = booking.get("customer_name", "Customer")
    booking_number = booking.get("booking_number", "")
    event_date = booking.get("event_date", "")
    event_time = booking.get("event_time", "")
    location = booking.get("location", "")
    total_amount = booking.get("total_amount", 0)
    advance_paid = booking.get("advance_paid", 0)
    balance = float(total_amount) - float(advance_paid)

    message = (
        f"📅 *Event Reminder*\n\n"
        f"Dear {customer_name},\n\n"
        f"This is a friendly reminder that your event is tomorrow!\n\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"📌 *Event Details*\n\n"
        f"🆔 Booking ID: {booking_number}\n"
        f"📅 Date: {event_date}\n"
        f"🕒 Time: {event_time}\n"
        f"📍 Venue: {location}\n\n"
    )

    if balance > 0:
        message += (
            f"━━━━━━━━━━━━━━━━━━\n"
            f"💰 *Payment Reminder*\n\n"
            f"Balance Due: ₹{balance:,.0f}\n"
            f"Please have the payment ready on event day.\n\n"
        )

    message += (
        f"Our team will arrive on time for setup.\n\n"
        f"Thank you for choosing **RCB Events**!\n\n"
        f"❤️ Team RCB Events"
    )

    sent = await _send_whatsapp(db, mobile, message, "event_reminder")
    if sent:
        await db.bookings.update_one(
            {"id": booking.get("id")},
            {"$set": {"event_reminder_sent": True, "event_reminder_sent_at": now_iso()}}
        )
    return sent


async def send_event_day_whatsapp(db, booking: dict) -> bool:
    """Send WhatsApp on the event day when status becomes In Progress."""
    if booking.get("event_day_sent"):
        return False

    mobile = booking.get("mobile", "")
    customer_name = booking.get("customer_name", "Customer")
    event_time = booking.get("event_time", "")
    location = booking.get("location", "")

    message = (
        f"🎉 *Today is Your Event!*\n\n"
        f"Dear {customer_name},\n\n"
        f"Today is your special event at {event_time}!\n"
        f"📍 Venue: {location}\n\n"
        f"Our decoration team will arrive as scheduled to set up everything beautifully.\n\n"
        f"Thank you for choosing **RCB Events**.\n\n"
        f"❤️ Team RCB Events"
    )

    sent = await _send_whatsapp(db, mobile, message, "event_day")
    if sent:
        await db.bookings.update_one(
            {"id": booking.get("id")},
            {"$set": {"event_day_sent": True, "event_day_sent_at": now_iso()}}
        )
    return sent


async def send_thank_you_whatsapp(db, booking: dict) -> bool:
    """Send a thank-you WhatsApp message to the customer when booking is Completed.
    Sets thank_you_sent=True on the booking to prevent duplicate sends.
    Returns True if sent successfully, False otherwise."""
    if booking.get("thank_you_sent"):
        return False

    mobile = booking.get("mobile", "")
    if not mobile:
        logger.warning(f"Cannot send thank-you: no mobile for booking {booking.get('booking_number', booking.get('id'))}")
        return False

    customer_name = booking.get("customer_name", "")
    theme = booking.get("theme", "your event")
    booking_number = booking.get("booking_number", "")

    message = (
        f"Hi {customer_name}, Thank you for choosing RCB Events! We hope you loved the {theme} decoration. "
        f"We'd be grateful if you could take a moment to leave a Google review for us: {GOOGLE_REVIEW_URL}"
    )

    sent = await _send_whatsapp(db, mobile, message, "thank-you")
    if sent:
        await db.bookings.update_one(
            {"id": booking.get("id")},
            {"$set": {"thank_you_sent": True, "thank_you_sent_at": now_iso()}}
        )
    return sent


def build_wa_link(mobile: str, text: str) -> str:
    """Build a wa.me click-to-chat link with pre-filled message."""
    import urllib.parse
    num = "".join(ch for ch in (mobile or "") if ch.isdigit())
    return f"https://wa.me/{num}?text={urllib.parse.quote(text)}"
