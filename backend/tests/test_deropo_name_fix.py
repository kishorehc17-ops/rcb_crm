"""Tests for Deropo webhook name-extraction fix (BUG-1) and rename regression."""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://party-planner-crm-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@rcbevents.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def created_lead_ids():
    ids = []
    yield ids
    # cleanup
    try:
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
        headers = {"Authorization": f"Bearer {r.json()['token']}"}
        for lid in ids:
            try:
                requests.delete(f"{API}/leads/{lid}", headers=headers, timeout=10)
            except Exception:
                pass
    except Exception:
        pass


def _find_lead(auth, mobile):
    r = requests.get(f"{API}/leads", headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    for ld in r.json():
        if (ld.get("mobile") or "").replace("+", "") == mobile:
            return ld
    return None


def _post_webhook(payload):
    r = requests.post(f"{API}/deropo/webhook", json=payload, timeout=15)
    assert r.status_code == 200, f"{r.status_code}: {r.text}"
    return r.json()


# ---- BUG-1: name extraction ----

def test_pushname_creates_lead_with_real_name(auth, created_lead_ids):
    mobile = "919000000111"
    _post_webhook({"event": "message_received", "data": {
        "from": mobile, "pushname": "Ramya Iyer", "type": "text",
        "message": "Hi need decoration", "id": "tst_001"
    }})
    time.sleep(1)
    lead = _find_lead(auth, mobile)
    assert lead is not None, "Lead not created"
    created_lead_ids.append(lead["id"])
    assert lead["name"] == "Ramya Iyer", f"expected 'Ramya Iyer', got '{lead['name']}'"


def test_sender_name_field(auth, created_lead_ids):
    mobile = "919000000222"
    _post_webhook({"event": "message_received", "data": {
        "from": mobile, "sender_name": "Kavya Nair", "type": "text", "message": "Hello"
    }})
    time.sleep(1)
    lead = _find_lead(auth, mobile)
    assert lead is not None
    created_lead_ids.append(lead["id"])
    assert lead["name"] == "Kavya Nair"


def test_nested_contact_name(auth, created_lead_ids):
    mobile = "919000000333"
    _post_webhook({"event": "message_received", "data": {
        "from": mobile, "contact": {"name": "Meena S"}, "type": "text", "message": "Hey"
    }})
    time.sleep(1)
    lead = _find_lead(auth, mobile)
    assert lead is not None
    created_lead_ids.append(lead["id"])
    assert lead["name"] == "Meena S"


def test_auto_upgrade_placeholder(auth, created_lead_ids):
    mobile = "919000000444"
    # first: no name field → placeholder
    _post_webhook({"event": "message_received", "data": {
        "from": mobile, "type": "text", "message": "Hi"
    }})
    time.sleep(1)
    lead1 = _find_lead(auth, mobile)
    assert lead1 is not None
    created_lead_ids.append(lead1["id"])
    assert lead1["name"].startswith("WA "), f"expected placeholder, got '{lead1['name']}'"

    # second: with pushname → should upgrade
    _post_webhook({"event": "message_received", "data": {
        "from": mobile, "pushname": "Arjun Reddy", "type": "text", "message": "Need decor"
    }})
    time.sleep(1)
    lead2 = _find_lead(auth, mobile)
    assert lead2["name"] == "Arjun Reddy", f"expected upgrade to 'Arjun Reddy', got '{lead2['name']}'"


def test_fallback_placeholder_still_works(auth, created_lead_ids):
    mobile = "919000000555"
    _post_webhook({"event": "message_received", "data": {
        "from": mobile, "type": "text", "message": "Hi"
    }})
    time.sleep(1)
    lead = _find_lead(auth, mobile)
    assert lead is not None
    created_lead_ids.append(lead["id"])
    assert lead["name"] == "WA 0555", f"expected 'WA 0555', got '{lead['name']}'"


# ---- Regression: PUT /api/leads/{id} rename ----

def test_rename_lead_put(auth, created_lead_ids):
    # Create a lead via webhook
    mobile = "919000000666"
    _post_webhook({"event": "message_received", "data": {
        "from": mobile, "pushname": "Old Name", "type": "text", "message": "Hi"
    }})
    time.sleep(1)
    lead = _find_lead(auth, mobile)
    assert lead is not None
    created_lead_ids.append(lead["id"])

    body = {
        "name": "TEST_Renamed User",
        "mobile": mobile,
        "stage": lead.get("stage") or "Lead",
        "source": lead.get("source") or "WhatsApp",
        "notes": lead.get("notes") or "",
        "event_date": lead.get("event_date"),
        "theme": lead.get("theme") or "",
        "location": lead.get("location") or "",
    }
    r = requests.put(f"{API}/leads/{lead['id']}", headers=auth, json=body, timeout=15)
    assert r.status_code == 200, f"{r.status_code}: {r.text}"

    lead2 = _find_lead(auth, mobile)
    assert lead2["name"] == "TEST_Renamed User"
