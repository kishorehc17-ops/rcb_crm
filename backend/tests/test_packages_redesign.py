"""Backend tests for Packages redesign (PackageIn optional fields, duplicate, analytics)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to reading frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@rcbevents.com", "password": "admin123"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def created_ids():
    ids = []
    yield ids
    # Cleanup: delete created packages
    r = requests.post(f"{API}/auth/login", json={"email": "admin@rcbevents.com", "password": "admin123"})
    tok = r.json()["token"]
    hh = {"Authorization": f"Bearer {tok}"}
    for pid in ids:
        try:
            requests.delete(f"{API}/packages/{pid}", headers=hh)
        except Exception:
            pass


# ---- Package CRUD backward compat ----
def test_create_package_legacy_minimal(h, created_ids):
    payload = {"name": "TEST_Legacy_Pkg", "price": 1500.0, "decorations": ["Balloons"], "addons": ["Cake"], "max_addons": 2, "active": True}
    r = requests.post(f"{API}/packages", json=payload, headers=h)
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["name"] == "TEST_Legacy_Pkg"
    assert doc["price"] == 1500.0
    assert "id" in doc
    created_ids.append(doc["id"])

    # verify GET
    r2 = requests.get(f"{API}/packages", headers=h)
    assert r2.status_code == 200
    assert any(p["id"] == doc["id"] for p in r2.json())


def test_create_package_with_new_optional_fields(h, created_ids):
    payload = {
        "name": "TEST_Premium_Pkg",
        "price": 25000.0,
        "offer_price": 22000.0,
        "description": "Grand premium birthday setup",
        "photos": ["https://example.com/p1.jpg", "https://example.com/p2.jpg"],
        "videos": ["https://example.com/v1.mp4"],
        "brochure_url": "https://example.com/brochure.pdf",
        "cover_image": "https://example.com/cover.jpg",
        "tags": ["premium", "birthday"],
        "badge": "PREMIUM",
        "status": "Active",
        "decorations": ["LED", "Flowers"],
        "addons": ["Cake"],
        "max_addons": 3,
        "active": True,
    }
    r = requests.post(f"{API}/packages", json=payload, headers=h)
    assert r.status_code == 200, r.text
    doc = r.json()
    pid = doc["id"]
    created_ids.append(pid)

    # Fetch back
    r2 = requests.get(f"{API}/packages", headers=h)
    fetched = next(p for p in r2.json() if p["id"] == pid)
    assert fetched["offer_price"] == 22000.0
    assert fetched["description"] == "Grand premium birthday setup"
    assert fetched["photos"] == ["https://example.com/p1.jpg", "https://example.com/p2.jpg"]
    assert fetched["videos"] == ["https://example.com/v1.mp4"]
    assert fetched["brochure_url"] == "https://example.com/brochure.pdf"
    assert fetched["cover_image"] == "https://example.com/cover.jpg"
    assert fetched["tags"] == ["premium", "birthday"]
    assert fetched["badge"] == "PREMIUM"
    assert fetched["status"] == "Active"


def test_update_package_preserves_optional(h, created_ids):
    # create
    payload = {"name": "TEST_UpdMe", "price": 5000.0, "description": "orig", "badge": "NEW", "status": "Draft"}
    r = requests.post(f"{API}/packages", json=payload, headers=h)
    assert r.status_code == 200
    pid = r.json()["id"]
    created_ids.append(pid)

    # update with new values
    upd = {**payload, "price": 6000.0, "description": "updated", "badge": "POPULAR"}
    r2 = requests.put(f"{API}/packages/{pid}", json=upd, headers=h)
    assert r2.status_code == 200, r2.text
    d = r2.json()
    assert d["price"] == 6000.0
    assert d["description"] == "updated"
    assert d["badge"] == "POPULAR"
    assert d["status"] == "Draft"


# ---- Duplicate ----
def test_duplicate_package(h, created_ids):
    payload = {"name": "TEST_DupSource", "price": 3000.0, "active": True, "status": "Active", "badge": "NEW", "description": "src"}
    r = requests.post(f"{API}/packages", json=payload, headers=h)
    src = r.json()
    src_id = src["id"]
    created_ids.append(src_id)

    r2 = requests.post(f"{API}/packages/{src_id}/duplicate", headers=h)
    assert r2.status_code == 200, r2.text
    dup = r2.json()
    assert dup["id"] != src_id
    assert dup["name"] == "TEST_DupSource (copy)"
    assert dup["active"] is False
    assert dup["status"] == "Draft"
    # Retain other fields
    assert dup["price"] == 3000.0
    assert dup["description"] == "src"
    created_ids.append(dup["id"])

    # Original unchanged
    r3 = requests.get(f"{API}/packages", headers=h)
    orig = next(p for p in r3.json() if p["id"] == src_id)
    assert orig["name"] == "TEST_DupSource"
    assert orig["active"] is True


def test_duplicate_missing_returns_404(h):
    r = requests.post(f"{API}/packages/nonexistent-id-xyz/duplicate", headers=h)
    assert r.status_code == 404


# ---- Analytics ----
def test_packages_analytics_shape(h):
    r = requests.get(f"{API}/packages/analytics", headers=h)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "per_package" in data
    assert "totals" in data
    assert "bookings" in data["totals"]
    assert "revenue" in data["totals"]
    # Each package has required fields
    for pid, v in data["per_package"].items():
        for k in ("bookings", "revenue", "sent_via_whatsapp", "conversion_rate"):
            assert k in v, f"missing {k} for {pid}"
        assert isinstance(v["bookings"], int)
        assert isinstance(v["revenue"], (int, float))
