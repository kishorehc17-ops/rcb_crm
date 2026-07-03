"""
Backend tests for Booking + Payments synchronization state-machine
(RCB Events CRM). Uses live backend URL from REACT_APP_BACKEND_URL.
"""
import os
import time
import pytest
import requests
from datetime import datetime, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://party-planner-crm-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@rcbevents.com"
ADMIN_PASSWORD = "admin123"

_created_booking_ids: list[str] = []


def _create_booking_with_link(client, payload, retries=5, delay=8):
    """Create a booking and retry until Razorpay advance_link_id is populated
    (Razorpay test-mode rate-limits payment_link.create rapidly)."""
    last = None
    for i in range(retries):
        r = client.post(f"{API}/bookings", json=payload)
        assert r.status_code == 200, r.text
        b = r.json()
        _created_booking_ids.append(b["id"])
        if b.get("advance_link_id", "").startswith("plink_"):
            return b
        last = b
        # regenerate after backoff to try to attach the link
        time.sleep(delay)
        rr = client.post(f"{API}/bookings/{b['id']}/regenerate-advance-link")
        if rr.status_code == 200:
            b2 = client.get(f"{API}/bookings/{b['id']}").json()
            if b2.get("advance_link_id", "").startswith("plink_"):
                return b2
    return last


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def client(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


def _make_booking_payload(total=8000, advance=2000, event_date=None):
    if event_date is None:
        # future date to ensure Confirmed (not In Progress) after advance
        event_date = "2026-12-31"
    return {
        "customer_name": "TEST_Sync Customer",
        "mobile": "9999900001",
        "event_date": event_date,
        "event_time": "18:00",
        "location": "TEST Location",
        "theme": "Cricket",
        "package_name": "Gold",
        "selected_addons": ["Cake Table"],
        "special_requirements": "TEST booking - safe to delete",
        "total_amount": total,
        "advance_amount": advance,
    }


@pytest.fixture(scope="session")
def created_booking(client):
    b = _create_booking_with_link(client, _make_booking_payload())
    assert b.get("advance_link_id", "").startswith("plink_"), f"could not attach advance_link after retries: {b}"
    return b


# -------- 1. Create booking + auto advance link --------
class TestCreateBooking:
    def test_create_returns_pending_and_advance_link(self, client):
        r = client.post(f"{API}/bookings", json=_make_booking_payload())
        assert r.status_code == 200, r.text
        b = r.json()
        _created_booking_ids.append(b["id"])
        assert b["booking_status"] == "Pending"
        assert b["payment_status"] == "Advance Pending"
        assert b["balance_amount"] == b["total_amount"] == 8000
        assert b.get("advance_link_url", "").startswith("http"), f"missing advance_link_url: {b}"
        assert b.get("advance_link_id", "").startswith("plink_"), f"advance_link_id not plink_: {b.get('advance_link_id')}"
        assert b.get("booking_number", "").startswith("RCB-")

    def test_list_bookings_has_derived_fields(self, client, created_booking):
        r = client.get(f"{API}/bookings")
        assert r.status_code == 200
        docs = r.json()
        assert isinstance(docs, list) and len(docs) > 0
        found = next((d for d in docs if d["id"] == created_booking["id"]), None)
        assert found is not None
        for k in ("booking_status", "payment_status", "balance_amount"):
            assert k in found, f"{k} missing on list booking"
        assert found["balance_amount"] == found["total_amount"] - found.get("advance_paid", 0)


# -------- 2. Regenerate advance link --------
class TestRegenerateAdvanceLink:
    def test_regenerate_updates_url(self, client, created_booking):
        old_id = created_booking["advance_link_id"]
        r = client.post(f"{API}/bookings/{created_booking['id']}/regenerate-advance-link")
        assert r.status_code == 200, r.text
        link = r.json()
        assert link["id"].startswith("plink_")
        assert link["url"].startswith("http")
        # persisted
        g = client.get(f"{API}/bookings/{created_booking['id']}").json()
        assert g["advance_link_id"] == link["id"]
        assert g["advance_link_id"] != old_id


# -------- 3. Record advance payment via /api/payments (2000) --------
class TestAdvancePayment:
    def test_advance_payment_confirms_booking(self, client, created_booking):
        bid = created_booking["id"]
        r = client.post(f"{API}/payments", json={"booking_id": bid, "amount": 2000, "method": "Cash", "note": "TEST advance"})
        assert r.status_code == 200, r.text
        pay = r.json()
        assert pay["amount"] == 2000
        assert pay.get("receipt_no", "").startswith("RCPT-"), f"missing receipt_no: {pay}"

        # Verify booking transitions
        g = client.get(f"{API}/bookings/{bid}").json()
        assert g["booking_status"] == "Confirmed", f"expected Confirmed got {g['booking_status']}"
        assert g["payment_status"] == "Advance Received", f"expected Advance Received got {g['payment_status']}"
        assert g["advance_paid"] == 2000
        assert g["balance_amount"] == g["total_amount"] - 2000

        # Same in list
        docs = client.get(f"{API}/bookings").json()
        found = next(d for d in docs if d["id"] == bid)
        assert found["booking_status"] == "Confirmed"
        assert found["payment_status"] == "Advance Received"


# -------- 4. Balance QR generation --------
class TestBalanceQR:
    def test_generate_balance_qr(self, client, created_booking):
        bid = created_booking["id"]
        # retry on Razorpay rate limits
        r = None
        for _ in range(4):
            r = client.post(f"{API}/bookings/{bid}/generate-balance-qr")
            if r.status_code == 200:
                break
            time.sleep(10)
        assert r.status_code == 200, r.text
        qr = r.json()
        assert qr["id"].startswith("plink_"), f"balance QR id should be plink_: {qr['id']}"
        assert qr["image_url"].startswith("data:image/png;base64,"), "image_url should be base64 PNG data URL"
        assert qr["payment_url"].startswith("http"), "payment_url should be https URL"
        assert qr["payment_amount"] > 0


# -------- 5. Payment history --------
class TestPaymentHistory:
    def test_payment_history_totals(self, client, created_booking):
        bid = created_booking["id"]
        r = client.get(f"{API}/bookings/{bid}/payment-history")
        assert r.status_code == 200, r.text
        h = r.json()
        assert "booking" in h and "payments" in h and "totals" in h
        assert h["booking"]["id"] == bid
        assert isinstance(h["payments"], list)
        assert h["totals"]["total_paid"] == sum(p["amount"] for p in h["payments"])
        assert h["totals"]["balance"] == h["totals"]["total_amount"] - h["totals"]["total_paid"]


# -------- 6. Fully Paid transition --------
class TestFullyPaid:
    def test_full_payment_transitions_to_fully_paid(self, client):
        # New booking
        r = client.post(f"{API}/bookings", json=_make_booking_payload(total=5000, advance=2000))
        assert r.status_code == 200
        b = r.json()
        _created_booking_ids.append(b["id"])
        bid = b["id"]
        # Pay 2000 advance
        r1 = client.post(f"{API}/payments", json={"booking_id": bid, "amount": 2000, "method": "Cash"})
        assert r1.status_code == 200
        # Now pay 4000 more (exceeds total)
        r2 = client.post(f"{API}/payments", json={"booking_id": bid, "amount": 4000, "method": "Cash"})
        assert r2.status_code == 200
        g = client.get(f"{API}/bookings/{bid}").json()
        assert g["payment_status"] == "Fully Paid", f"expected Fully Paid, got {g['payment_status']}"
        assert g["advance_paid"] == 6000
        assert g["balance_amount"] == 0


# -------- 7. Config review URL --------
class TestReviewURL:
    def test_review_url(self, client):
        r = client.get(f"{API}/config/review-url")
        assert r.status_code == 200
        j = r.json()
        assert "google_review_url" in j
        assert "maps.app.goo.gl" in j["google_review_url"]


# -------- 8. Sync idempotency --------
class TestSyncIdempotency:
    def test_sync_second_call_reconciles_zero(self, client, created_booking):
        bid = created_booking["id"]
        # First sync (may add 0 since advance was manually recorded, not via Razorpay link)
        r1 = client.post(f"{API}/payments/sync/{bid}")
        assert r1.status_code == 200, r1.text
        first = r1.json()
        assert "reconciled" in first
        # Second sync must be 0 (idempotent)
        r2 = client.post(f"{API}/payments/sync/{bid}")
        assert r2.status_code == 200
        second = r2.json()
        assert second["reconciled"] == 0, f"expected 0 on 2nd sync, got {second['reconciled']}"


# -------- 9. Payments page filtering: distinct payment_status --------
class TestPaymentStatusesForFilter:
    def test_multiple_statuses_present(self, client):
        docs = client.get(f"{API}/bookings").json()
        statuses = {d.get("payment_status") for d in docs}
        # Expect at least a couple of these values to be present
        expected = {"Advance Pending", "Advance Received", "Partial Paid", "Fully Paid"}
        assert statuses & expected, f"no known payment statuses found: {statuses}"


# -------- 10. PUT preserves razorpay fields --------
class TestUpdatePreservesRazorpay:
    def test_update_keeps_advance_link(self, client, created_booking):
        # Reuse session-scoped booking which already has an advance link.
        bid = created_booking["id"]
        # Ensure we fetch latest state (advance_paid may be 2000 by now)
        b = client.get(f"{API}/bookings/{bid}").json()
        assert b.get("advance_link_id", "").startswith("plink_"), f"no advance link on session booking: {b}"
        original_link_id = b["advance_link_id"]
        original_link_url = b["advance_link_url"]

        # Update with a payload that does NOT include advance_link_*
        upd = _make_booking_payload(total=7500)
        upd["customer_name"] = "TEST_Updated Name"
        r2 = client.put(f"{API}/bookings/{bid}", json=upd)
        assert r2.status_code == 200, r2.text
        updated = r2.json()
        assert updated["customer_name"] == "TEST_Updated Name"
        assert updated["total_amount"] == 7500
        assert updated.get("advance_link_id") == original_link_id, "advance_link_id should be preserved"
        assert updated.get("advance_link_url") == original_link_url, "advance_link_url should be preserved"


# -------- Cleanup --------
def test_zzz_cleanup(client):
    for bid in _created_booking_ids:
        try:
            client.delete(f"{API}/bookings/{bid}")
        except Exception:
            pass
    # Idempotent assertion
    assert True
