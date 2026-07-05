from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import logging
import uuid
import bcrypt
import jwt
import razorpay
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Any
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict, EmailStr

# ---------- Setup ----------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="RCB Events CRM")
api_router = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGO = "HS256"

RZP_KEY = os.environ.get('RAZORPAY_KEY_ID', '')
RZP_SECRET = os.environ.get('RAZORPAY_KEY_SECRET', '')
rzp_client = razorpay.Client(auth=(RZP_KEY, RZP_SECRET)) if RZP_KEY and RZP_SECRET else None


def require_roles(*allowed):
    async def checker(user: dict = Depends(get_current_user)):
        if user.get("role") not in allowed:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return checker


# ---------- Helpers ----------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


async def get_current_user(request: Request, creds: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    token = None
    if creds and creds.credentials:
        token = creds.credentials
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def strip_id(doc):
    if doc is None:
        return None
    doc.pop("_id", None)
    return doc


# ---------- Models ----------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: Optional[str] = "staff"


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class BookingIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    customer_name: str
    mobile: str
    event_date: str  # ISO date
    event_time: str
    location: str
    theme: str
    theme_photo: Optional[str] = ""
    package_id: Optional[str] = None
    package_name: Optional[str] = None
    selected_addons: List[str] = []
    special_requirements: Optional[str] = ""
    status: str = "Pending"  # legacy compat; real state lives in booking_status/payment_status
    booking_status: Optional[str] = None  # Pending, Confirmed, In Progress, Completed, Cancelled
    payment_status: Optional[str] = None  # Advance Pending, Advance Received, Partial Paid, Fully Paid
    total_amount: float = 0
    advance_paid: float = 0
    advance_amount: float = 2000  # editable target advance


class PackageIn(BaseModel):
    name: str
    price: float
    decorations: List[str] = []
    addons: List[str] = []
    max_addons: int = 0
    active: bool = True


class PaymentIn(BaseModel):
    booking_id: str
    amount: float
    method: str = "Cash"
    note: Optional[str] = ""


class ExpenseIn(BaseModel):
    date: str
    category: str
    vendor_id: Optional[str] = None
    staff_id: Optional[str] = None
    amount: float
    remarks: Optional[str] = ""


class VendorIn(BaseModel):
    name: str
    phone: str
    address: Optional[str] = ""
    gst: Optional[str] = ""
    active: bool = True


class StaffIn(BaseModel):
    employee_code: str
    name: str
    phone: str
    address: Optional[str] = ""
    active: bool = True


class LeadIn(BaseModel):
    name: str
    mobile: str
    source: str = "Manual"  # Meta, Website, WhatsApp, Manual
    stage: str = "Lead"  # Lead, Contacted, Quotation Sent, Negotiation, Booked, Completed, Review Received
    notes: Optional[str] = ""
    event_date: Optional[str] = None
    theme: Optional[str] = ""
    location: Optional[str] = ""


# ---------- Auth Routes ----------
@api_router.post("/auth/register")
async def register(data: RegisterIn):
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "email": email,
        "password_hash": hash_password(data.password),
        "name": data.name,
        "role": data.role or "staff",
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    token = create_access_token(user_id, email, doc["role"])
    return {"token": token, "user": {"id": user_id, "email": email, "name": data.name, "role": doc["role"]}}


@api_router.post("/auth/login")
async def login(data: LoginIn):
    email = data.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["id"], user["email"], user["role"])
    return {
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"]},
    }


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


# ---------- Dashboard ----------
@api_router.get("/dashboard/stats")
async def dashboard_stats(user: dict = Depends(get_current_user)):
    today = datetime.now(timezone.utc).date().isoformat()
    total = await db.bookings.count_documents({})
    today_count = await db.bookings.count_documents({"event_date": today})
    upcoming = await db.bookings.count_documents({"event_date": {"$gt": today}, "status": {"$nin": ["Cancelled", "Completed"]}})
    completed = await db.bookings.count_documents({"status": "Completed"})

    # Revenue: sum of advance_paid for all bookings
    pipeline_rev = [{"$group": {"_id": None, "total": {"$sum": "$advance_paid"}}}]
    rev_agg = await db.bookings.aggregate(pipeline_rev).to_list(1)
    revenue = rev_agg[0]["total"] if rev_agg else 0

    # Pending payments
    pipeline_pend = [{"$project": {"balance": {"$subtract": ["$total_amount", "$advance_paid"]}}},
                     {"$group": {"_id": None, "total": {"$sum": "$balance"}}}]
    pend_agg = await db.bookings.aggregate(pipeline_pend).to_list(1)
    pending = pend_agg[0]["total"] if pend_agg else 0

    # Expenses
    exp_agg = await db.expenses.aggregate([{"$group": {"_id": None, "total": {"$sum": "$amount"}}}]).to_list(1)
    total_expenses = exp_agg[0]["total"] if exp_agg else 0

    return {
        "total_bookings": total,
        "today_bookings": today_count,
        "upcoming_bookings": upcoming,
        "completed_bookings": completed,
        "revenue": revenue,
        "pending_payments": pending,
        "total_expenses": total_expenses,
    }


@api_router.get("/reports/overview")
async def reports_overview(months: int = 6, user: dict = Depends(get_current_user)):
    """Aggregated reports for sales / expenses / profit / breakdowns."""
    from collections import defaultdict
    now = datetime.now(timezone.utc)
    # Build the last N months' keys as YYYY-MM
    keys: List[str] = []
    y, m = now.year, now.month
    for _ in range(months):
        keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    keys.reverse()

    # Sales = advance_paid grouped by booking created month
    sales_by_month = defaultdict(float)
    expenses_by_month = defaultdict(float)
    async for p in db.payments.find({}, {"amount": 1, "created_at": 1}):
        ca = (p.get("created_at") or "")[:7]  # YYYY-MM
        if ca:
            sales_by_month[ca] += float(p.get("amount") or 0)
    async for e in db.expenses.find({}, {"amount": 1, "date": 1, "created_at": 1}):
        # Prefer date field; fall back to created_at
        d = (e.get("date") or e.get("created_at") or "")[:7]
        if d:
            expenses_by_month[d] += float(e.get("amount") or 0)

    monthly = [
        {
            "month": k,
            "sales": round(sales_by_month.get(k, 0), 2),
            "expenses": round(expenses_by_month.get(k, 0), 2),
            "profit": round(sales_by_month.get(k, 0) - expenses_by_month.get(k, 0), 2),
        }
        for k in keys
    ]

    # Booking status breakdown
    status_counts = defaultdict(int)
    async for b in db.bookings.find({}, {"booking_status": 1, "status": 1}):
        status_counts[b.get("booking_status") or b.get("status") or "Pending"] += 1

    # Payment status breakdown
    ps_counts = defaultdict(int)
    async for b in db.bookings.find({}, {"payment_status": 1, "advance_paid": 1, "total_amount": 1}):
        paid = float(b.get("advance_paid") or 0)
        total = float(b.get("total_amount") or 0)
        ps = b.get("payment_status")
        if not ps:
            if total > 0 and paid >= total:
                ps = "Fully Paid"
            elif paid <= 0:
                ps = "Advance Pending"
            else:
                ps = "Partial Paid"
        ps_counts[ps] += 1

    # Expense category breakdown
    cat_totals = defaultdict(float)
    async for e in db.expenses.find({}, {"amount": 1, "category": 1}):
        cat_totals[e.get("category") or "Other"] += float(e.get("amount") or 0)
    exp_categories = sorted(
        [{"name": k, "value": round(v, 2)} for k, v in cat_totals.items()],
        key=lambda x: -x["value"],
    )

    # Top themes (by booking count)
    theme_counts = defaultdict(int)
    async for b in db.bookings.find({}, {"theme": 1}):
        t = (b.get("theme") or "").strip() or "Unspecified"
        theme_counts[t] += 1
    top_themes = sorted(
        [{"name": k, "count": v} for k, v in theme_counts.items()],
        key=lambda x: -x["count"],
    )[:8]

    # Top packages (by count)
    pkg_counts = defaultdict(int)
    async for b in db.bookings.find({}, {"package_name": 1}):
        p = (b.get("package_name") or "").strip() or "None"
        pkg_counts[p] += 1
    top_packages = sorted(
        [{"name": k, "count": v} for k, v in pkg_counts.items()],
        key=lambda x: -x["count"],
    )

    # Payment method breakdown
    method_totals = defaultdict(float)
    async for p in db.payments.find({}, {"amount": 1, "method": 1}):
        method_totals[p.get("method") or "Other"] += float(p.get("amount") or 0)
    payment_methods = sorted(
        [{"name": k, "value": round(v, 2)} for k, v in method_totals.items()],
        key=lambda x: -x["value"],
    )

    # Totals
    total_sales = sum(sales_by_month.values())
    total_expenses = sum(expenses_by_month.values())
    return {
        "monthly": monthly,
        "totals": {
            "sales": round(total_sales, 2),
            "expenses": round(total_expenses, 2),
            "profit": round(total_sales - total_expenses, 2),
        },
        "booking_status_counts": [{"name": k, "value": v} for k, v in status_counts.items()],
        "payment_status_counts": [{"name": k, "value": v} for k, v in ps_counts.items()],
        "expense_categories": exp_categories,
        "top_themes": top_themes,
        "top_packages": top_packages,
        "payment_methods": payment_methods,
    }


# ---------- Bookings ----------
from booking_flow import (
    apply_derived as _apply_derived,
    create_advance_link as _create_advance_link,
    create_balance_qr as _create_balance_qr,
    apply_payment as _apply_payment,
    sweep_event_day as _sweep_event_day,
    build_wa_link as _wa_link,
    GOOGLE_REVIEW_URL as _GOOGLE_REVIEW_URL,
)


def _booking_number():
    return "RCB-" + datetime.now(timezone.utc).strftime("%y%m%d") + "-" + uuid.uuid4().hex[:5].upper()


@api_router.get("/bookings")
async def list_bookings(user: dict = Depends(get_current_user)):
    docs = await db.bookings.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    for d in docs:
        _apply_derived(d)
    return docs


@api_router.post("/bookings")
async def create_booking(data: BookingIn, user: dict = Depends(get_current_user)):
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["booking_number"] = _booking_number()
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    if not doc.get("advance_amount"):
        doc["advance_amount"] = 2000.0
    # Auto-generate advance payment link (best-effort — won't block booking creation)
    if rzp_client and float(doc.get("advance_amount") or 0) > 0 and doc.get("mobile"):
        link = await _create_advance_link(rzp_client, doc)
        if link:
            doc["advance_link_id"] = link["id"]
            doc["advance_link_url"] = link["url"]
            doc["advance_link_status"] = link["status"]
    _apply_derived(doc)
    await db.bookings.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/bookings/{booking_id}")
async def get_booking(booking_id: str, user: dict = Depends(get_current_user)):
    doc = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Booking not found")
    _apply_derived(doc)
    return doc


@api_router.put("/bookings/{booking_id}")
async def update_booking(booking_id: str, data: BookingIn, user: dict = Depends(get_current_user)):
    upd = data.model_dump()
    upd["updated_at"] = now_iso()
    # Preserve link/QR fields if not provided
    existing = await db.bookings.find_one({"id": booking_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Booking not found")
    for k in ("advance_link_id", "advance_link_url", "advance_link_status",
              "balance_qr_id", "balance_qr_url", "balance_qr_status", "booking_number"):
        if k not in upd and k in existing:
            upd[k] = existing[k]
    _apply_derived(upd)
    await db.bookings.update_one({"id": booking_id}, {"$set": upd})
    doc = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    _apply_derived(doc)
    return doc


@api_router.delete("/bookings/{booking_id}")
async def delete_booking(booking_id: str, user: dict = Depends(get_current_user)):
    result = await db.bookings.delete_one({"id": booking_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Booking not found")
    return {"ok": True}


@api_router.post("/bookings/{booking_id}/regenerate-advance-link")
async def regenerate_advance_link(booking_id: str, user: dict = Depends(get_current_user)):
    if not rzp_client:
        raise HTTPException(status_code=500, detail="Razorpay not configured")
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if float(b.get("advance_paid") or 0) > 0:
        raise HTTPException(status_code=400, detail="Advance already received — link cannot be regenerated")
    link = await _create_advance_link(rzp_client, b)
    if not link:
        raise HTTPException(status_code=500, detail="Failed to create link")
    await db.bookings.update_one({"id": booking_id}, {"$set": {
        "advance_link_id": link["id"],
        "advance_link_url": link["url"],
        "advance_link_status": link["status"],
        "updated_at": now_iso(),
    }})
    return link


@api_router.post("/bookings/{booking_id}/generate-balance-qr")
async def generate_balance_qr(booking_id: str, user: dict = Depends(get_current_user)):
    if not rzp_client:
        raise HTTPException(status_code=500, detail="Razorpay not configured")
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    qr = await _create_balance_qr(rzp_client, b)
    if not qr:
        raise HTTPException(status_code=400, detail="No balance due or QR create failed")
    await db.bookings.update_one({"id": booking_id}, {"$set": {
        "balance_qr_id": qr["id"],
        "balance_qr_url": qr["image_url"],        # PNG data URL for <img>
        "balance_qr_payment_url": qr["payment_url"],  # Razorpay short URL
        "balance_qr_status": qr["status"],
        "updated_at": now_iso(),
    }})
    return qr


@api_router.get("/bookings/{booking_id}/payment-history")
async def payment_history(booking_id: str, user: dict = Depends(get_current_user)):
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    pays = await db.payments.find({"booking_id": booking_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    _apply_derived(b)
    total_paid = sum(float(p.get("amount") or 0) for p in pays)
    return {
        "booking": b,
        "payments": pays,
        "totals": {
            "total_paid": total_paid,
            "total_amount": float(b.get("total_amount") or 0),
            "balance": float(b.get("balance_amount") or 0),
        },
    }


@api_router.get("/config/review-url")
async def get_review_url(user: dict = Depends(get_current_user)):
    return {"google_review_url": _GOOGLE_REVIEW_URL}


# ---------- Packages ----------
@api_router.get("/packages")
async def list_packages(active_only: bool = False, user: dict = Depends(get_current_user)):
    q = {"active": True} if active_only else {}
    docs = await db.packages.find(q, {"_id": 0}).to_list(100)
    return docs


@api_router.post("/packages")
async def create_package(data: PackageIn, user: dict = Depends(get_current_user)):
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    await db.packages.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/packages/{pkg_id}")
async def update_package(pkg_id: str, data: PackageIn, user: dict = Depends(get_current_user)):
    upd = data.model_dump()
    result = await db.packages.update_one({"id": pkg_id}, {"$set": upd})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Package not found")
    doc = await db.packages.find_one({"id": pkg_id}, {"_id": 0})
    return doc


@api_router.delete("/packages/{pkg_id}")
async def delete_package(pkg_id: str, user: dict = Depends(get_current_user)):
    await db.packages.delete_one({"id": pkg_id})
    return {"ok": True}


# ---------- Payments ----------
@api_router.get("/payments")
async def list_payments(booking_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {"booking_id": booking_id} if booking_id else {}
    docs = await db.payments.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return docs


@api_router.post("/payments")
async def create_payment(data: PaymentIn, user: dict = Depends(get_current_user)):
    updated = await _apply_payment(
        db, data.booking_id, float(data.amount), method=data.method,
        note=data.note or "", source="manual",
    )
    if not updated:
        raise HTTPException(404, "Booking not found")
    pay = await db.payments.find_one({"booking_id": data.booking_id}, {"_id": 0},
                                     sort=[("created_at", -1)])
    return pay


# ---------- Expenses ----------
@api_router.get("/expenses")
async def list_expenses(user: dict = Depends(get_current_user)):
    docs = await db.expenses.find({}, {"_id": 0}).sort("date", -1).to_list(1000)
    return docs


@api_router.post("/expenses")
async def create_expense(data: ExpenseIn, user: dict = Depends(get_current_user)):
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    await db.expenses.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.delete("/expenses/{exp_id}")
async def delete_expense(exp_id: str, user: dict = Depends(get_current_user)):
    await db.expenses.delete_one({"id": exp_id})
    return {"ok": True}


# ---------- Vendors ----------
@api_router.get("/vendors")
async def list_vendors(user: dict = Depends(get_current_user)):
    return await db.vendors.find({}, {"_id": 0}).to_list(500)


@api_router.post("/vendors")
async def create_vendor(data: VendorIn, user: dict = Depends(get_current_user)):
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    await db.vendors.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/vendors/{vid}")
async def update_vendor(vid: str, data: VendorIn, user: dict = Depends(get_current_user)):
    await db.vendors.update_one({"id": vid}, {"$set": data.model_dump()})
    doc = await db.vendors.find_one({"id": vid}, {"_id": 0})
    return doc


@api_router.delete("/vendors/{vid}")
async def delete_vendor(vid: str, user: dict = Depends(get_current_user)):
    await db.vendors.delete_one({"id": vid})
    return {"ok": True}


# ---------- Staff ----------
@api_router.get("/staff")
async def list_staff(user: dict = Depends(get_current_user)):
    return await db.staff.find({}, {"_id": 0}).to_list(500)


@api_router.post("/staff")
async def create_staff(data: StaffIn, user: dict = Depends(get_current_user)):
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    await db.staff.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/staff/{sid}")
async def update_staff(sid: str, data: StaffIn, user: dict = Depends(get_current_user)):
    await db.staff.update_one({"id": sid}, {"$set": data.model_dump()})
    doc = await db.staff.find_one({"id": sid}, {"_id": 0})
    return doc


@api_router.delete("/staff/{sid}")
async def delete_staff(sid: str, user: dict = Depends(get_current_user)):
    await db.staff.delete_one({"id": sid})
    return {"ok": True}


# ---------- Leads ----------
@api_router.get("/leads")
async def list_leads(user: dict = Depends(get_current_user)):
    return await db.leads.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)


@api_router.post("/leads")
async def create_lead(data: LeadIn, user: dict = Depends(get_current_user)):
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    await db.leads.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/leads/{lid}")
async def update_lead(lid: str, data: LeadIn, user: dict = Depends(get_current_user)):
    await db.leads.update_one({"id": lid}, {"$set": data.model_dump()})
    doc = await db.leads.find_one({"id": lid}, {"_id": 0})
    return doc


@api_router.delete("/leads/{lid}")
async def delete_lead(lid: str, user: dict = Depends(get_current_user)):
    await db.leads.delete_one({"id": lid})
    return {"ok": True}


class StageUpdate(BaseModel):
    stage: str


@api_router.patch("/leads/{lid}/stage")
async def update_lead_stage(lid: str, data: StageUpdate, user: dict = Depends(get_current_user)):
    await db.leads.update_one({"id": lid}, {"$set": {"stage": data.stage}})
    doc = await db.leads.find_one({"id": lid}, {"_id": 0})
    return doc


# ---------- Users (admin only) ----------
@api_router.get("/users")
async def list_users(user: dict = Depends(require_roles("admin"))):
    return await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(500)


class UserCreateIn(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "staff"


@api_router.post("/users")
async def create_user(data: UserCreateIn, user: dict = Depends(require_roles("admin"))):
    email = data.email.lower()
    if data.role not in ("admin", "manager", "sales", "staff"):
        raise HTTPException(status_code=400, detail="Invalid role")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email exists")
    doc = {"id": str(uuid.uuid4()), "email": email, "password_hash": hash_password(data.password),
           "name": data.name, "role": data.role, "created_at": now_iso()}
    await db.users.insert_one(doc)
    return {"id": doc["id"], "email": email, "name": data.name, "role": data.role}


class UserUpdateIn(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None


@api_router.put("/users/{uid}")
async def update_user(uid: str, data: UserUpdateIn, user: dict = Depends(require_roles("admin"))):
    upd = {}
    if data.name:
        upd["name"] = data.name
    if data.role:
        if data.role not in ("admin", "manager", "sales", "staff"):
            raise HTTPException(status_code=400, detail="Invalid role")
        upd["role"] = data.role
    if data.password:
        upd["password_hash"] = hash_password(data.password)
    if upd:
        await db.users.update_one({"id": uid}, {"$set": upd})
    return {"ok": True}


@api_router.delete("/users/{uid}")
async def delete_user(uid: str, user: dict = Depends(require_roles("admin"))):
    if uid == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    await db.users.delete_one({"id": uid})
    return {"ok": True}


# ---------- Razorpay ----------
@api_router.post("/payments/create-link/{booking_id}")
async def create_payment_link(booking_id: str, user: dict = Depends(get_current_user)):
    if not rzp_client:
        raise HTTPException(status_code=500, detail="Razorpay not configured")
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    balance = float(b.get("total_amount", 0)) - float(b.get("advance_paid", 0))
    if balance <= 0:
        raise HTTPException(status_code=400, detail="No balance due")
    try:
        link = rzp_client.payment_link.create({
            "amount": int(balance * 100),
            "currency": "INR",
            "accept_partial": True,
            "description": f"RCB Events booking {b.get('booking_number')}",
            "customer": {"name": b.get("customer_name", ""), "contact": b.get("mobile", "")},
            "notify": {"sms": True, "email": False},
            "reminder_enable": True,
            "notes": {"booking_id": booking_id, "booking_number": b.get("booking_number", "")},
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Razorpay error: {e}")
    await db.bookings.update_one({"id": booking_id}, {"$set": {
        "payment_link_id": link.get("id"), "payment_link_url": link.get("short_url"),
        "payment_link_status": link.get("status", "created"), "updated_at": now_iso()}})
    return {"url": link.get("short_url"), "id": link.get("id"), "status": link.get("status")}


class RzpWebhook(BaseModel):
    payload: dict
    event: str


@api_router.post("/payments/webhook")
async def rzp_webhook(request: Request):
    import hmac
    import hashlib
    import json as _json
    raw = await request.body()
    webhook_secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
    signature = request.headers.get("x-razorpay-signature", "")
    if webhook_secret:
        expected = hmac.new(webhook_secret.encode(), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            logger.warning("Webhook: invalid signature")
            raise HTTPException(status_code=400, detail="Invalid signature")
    body = _json.loads(raw or b"{}")
    ev = body.get("event", "")
    logger.info(f"Webhook event: {ev}")

    payload = body.get("payload", {}) or {}
    pl_entity = (payload.get("payment_link") or {}).get("entity") or {}
    qr_entity = (payload.get("qr_code") or {}).get("entity") or {}
    pay_entity = (payload.get("payment") or {}).get("entity") or {}

    booking_id = None
    amount = 0.0
    source = "webhook"

    # Payment-link events (advance link OR balance link)
    if pl_entity:
        notes = pl_entity.get("notes") or {}
        booking_id = notes.get("booking_id")
        amount = float(pl_entity.get("amount_paid") or pl_entity.get("amount") or 0) / 100
        # differentiate advance vs balance link via `purpose` note
        source = "balance_qr" if notes.get("purpose") == "balance" else "advance_link"

    # QR-code events (only if Razorpay native QR API works — rare in test)
    if not booking_id and qr_entity:
        booking_id = (qr_entity.get("notes") or {}).get("booking_id")
        source = "balance_qr"

    # Fall back to payment entity for booking_id + amount
    if not amount and pay_entity:
        amount = float(pay_entity.get("amount") or 0) / 100
    if not booking_id:
        booking_id = (pay_entity.get("notes") or {}).get("booking_id")

    # Fallback: look up booking by stored link id (advance) or link stored as balance QR id
    link_id = pl_entity.get("id") or pay_entity.get("payment_link_id")
    qr_id = qr_entity.get("id")
    if not booking_id and link_id:
        b = await db.bookings.find_one({"advance_link_id": link_id}, {"id": 1})
        if b:
            booking_id = b.get("id")
            source = "advance_link"
        else:
            b = await db.bookings.find_one({"balance_qr_id": link_id}, {"id": 1})
            if b:
                booking_id = b.get("id")
                source = "balance_qr"
    if not booking_id and qr_id:
        b = await db.bookings.find_one({"balance_qr_id": qr_id}, {"id": 1})
        if b:
            booking_id = b.get("id")
            source = "balance_qr"

    logger.info(f"Webhook parsed: booking_id={booking_id}, amount={amount}, source={source}")

    paid_events = ("payment_link.paid", "payment.captured", "qr_code.credited")
    if ev in paid_events and booking_id and amount > 0:
        rzp_pay_id = pay_entity.get("id")
        await _apply_payment(
            db, booking_id, amount, method="Razorpay",
            note=f"Auto via webhook ({ev})", rzp_pay_id=rzp_pay_id, source=source,
        )
        # If advance link paid, auto-generate the balance QR
        if source == "advance_link" and rzp_client:
            b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
            if b and float(b.get("advance_paid") or 0) < float(b.get("total_amount") or 0):
                if not b.get("balance_qr_id"):
                    qr = await _create_balance_qr(rzp_client, b)
                    if qr:
                        await db.bookings.update_one({"id": booking_id}, {"$set": {
                            "balance_qr_id": qr["id"],
                            "balance_qr_url": qr["image_url"],
                            "balance_qr_status": qr["status"],
                        }})
        # Update link/qr status snapshot
        if pl_entity:
            await db.bookings.update_one({"id": booking_id}, {"$set": {
                "advance_link_status": pl_entity.get("status", "paid"),
            }})
        if qr_entity:
            await db.bookings.update_one({"id": booking_id}, {"$set": {
                "balance_qr_status": qr_entity.get("status", "active"),
            }})
    return {"ok": True}


@api_router.post("/payments/sync/{booking_id}")
async def sync_payment(booking_id: str, user: dict = Depends(get_current_user)):
    """Manually fetch Razorpay advance link + balance link status and reconcile
    payments for both. Both advance and balance are Razorpay payment_links."""
    if not rzp_client:
        raise HTTPException(status_code=500, detail="Razorpay not configured")
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if not (b.get("advance_link_id") or b.get("balance_qr_id") or b.get("payment_link_id")):
        raise HTTPException(status_code=404, detail="No Razorpay link/QR on this booking")

    total_reconciled = 0.0
    statuses = {}

    async def _sync_link(link_id: str, source_key: str, status_key: str):
        nonlocal total_reconciled
        if not link_id:
            return
        try:
            link = rzp_client.payment_link.fetch(link_id)
        except Exception as e:
            logger.warning(f"{source_key} sync failed: {e}")
            return
        amount_paid = float(link.get("amount_paid", 0)) / 100
        statuses[source_key] = link.get("status", "created")
        already = 0.0
        async for p in db.payments.find({"booking_id": booking_id, "source": source_key}):
            already += float(p.get("amount", 0))
        delta = amount_paid - already
        if delta > 0:
            await _apply_payment(db, booking_id, delta, method="Razorpay",
                                 note=f"Reconciled via sync ({source_key})", source=source_key)
            total_reconciled += delta
        await db.bookings.update_one({"id": booking_id}, {"$set": {
            status_key: statuses[source_key],
        }})

    # Sync advance payment link
    adv_link_id = b.get("advance_link_id") or b.get("payment_link_id")
    await _sync_link(adv_link_id, "advance_link", "advance_link_status")
    # Sync balance link (stored under balance_qr_id — also a payment_link id)
    await _sync_link(b.get("balance_qr_id"), "balance_qr", "balance_qr_status")

    updated = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    _apply_derived(updated)
    return {"reconciled": total_reconciled, "statuses": statuses, "booking": updated}


# ---------- Health ----------
@api_router.get("/")
async def root():
    return {"message": "RCB Events CRM API", "status": "ok"}


# ---------- File Upload ----------
# ---------- File Upload (Emergent Object Storage) ----------
from storage import init_storage as _init_storage, put_object as _put_object, get_object as _get_object, build_path as _build_path, MIME as _MIME
from fastapi import Header, Query
from fastapi.responses import Response

UPLOAD_DIR = ROOT_DIR / "uploads"  # legacy local dir (backwards compat for old bookings)
UPLOAD_DIR.mkdir(exist_ok=True)


@api_router.post("/upload")
async def upload_file(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    ext = os.path.splitext(file.filename or "img.jpg")[1].lower().lstrip(".") or "jpg"
    if ext not in {"jpg", "jpeg", "png", "gif", "webp"}:
        raise HTTPException(status_code=400, detail="Only image files are allowed")
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be under 5MB")
    content_type = _MIME.get(ext, "application/octet-stream")
    path = _build_path(user["id"], ext)
    try:
        result = _put_object(path, contents, content_type)
    except Exception as e:
        logger.exception("Object storage upload failed")
        raise HTTPException(status_code=500, detail=f"Storage upload failed: {e}")
    stored_path = result.get("path", path)
    await db.files.insert_one({
        "id": str(uuid.uuid4()),
        "storage_path": stored_path,
        "original_filename": file.filename or "",
        "content_type": content_type,
        "size": result.get("size", len(contents)),
        "owner_id": user["id"],
        "is_deleted": False,
        "created_at": now_iso(),
    })
    # Frontend-consumable URL — served by /api/files/{path:path}
    return {"url": f"/api/files/{stored_path}"}


@api_router.get("/files/{path:path}")
async def download_file(
    path: str,
    authorization: Optional[str] = Header(default=None),
    auth: Optional[str] = Query(default=None),
):
    """Serve a file from Emergent Object Storage. Auth via Bearer header OR
    `?auth=<token>` query param (needed for <img src>)."""
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1]
    elif auth:
        token = auth
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    record = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        data, ct = _get_object(path)
    except Exception as e:
        logger.exception("Object storage download failed")
        raise HTTPException(status_code=500, detail=f"Storage download failed: {e}")
    return Response(content=data, media_type=record.get("content_type") or ct)


# ---------- Include router ----------
app.include_router(api_router)

# ---------- WhatsApp module ----------
from whatsapp import build_router as _build_wa_router, seed_demo_conversations as _seed_wa, handle_incoming_message as _wa_handle_incoming
_wa_router = _build_wa_router(get_current_user, db)
app.include_router(_wa_router)

# ---------- Deropo WhatsApp provider (incoming webhook) ----------
from deropo import build_router as _build_deropo_router
_deropo_router = _build_deropo_router(db, _wa_handle_incoming)
app.include_router(_deropo_router)

# Serve uploaded files (mounted under /api so kubernetes ingress routes to backend)
app.mount("/api/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ---------- Startup: seed admin + default packages ----------
@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.bookings.create_index("event_date")
    await db.leads.create_index("stage")
    await db.files.create_index("storage_path")

    # Init Emergent Object Storage session (best-effort — /api/upload will retry on demand)
    try:
        _init_storage()
    except Exception as e:
        logger.warning(f"Emergent Object Storage init failed at startup: {e}")

    admin_email = os.environ.get("ADMIN_EMAIL", "admin@rcbevents.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Admin",
            "role": "admin",
            "created_at": now_iso(),
        })
        logger.info(f"Seeded admin: {admin_email}")
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})

    # Seed default packages
    if await db.packages.count_documents({}) == 0:
        common_addons = ["Cake Table", "Photo Props", "LED Lights", "Fog Machine", "Confetti Cannon", "Bubble Machine", "Photobooth", "Name Board", "Character Cutout", "Return Gifts"]
        defaults = [
            {"id": str(uuid.uuid4()), "name": "Standard", "price": 4999, "decorations": ["50 Balloons", "Basic Backdrop", "Welcome Board"], "addons": common_addons, "max_addons": 2, "active": True, "created_at": now_iso()},
            {"id": str(uuid.uuid4()), "name": "Gold", "price": 9999, "decorations": ["100 Balloons", "Themed Backdrop", "Welcome Board", "Foil Balloons"], "addons": common_addons, "max_addons": 4, "active": True, "created_at": now_iso()},
            {"id": str(uuid.uuid4()), "name": "Gold Plus", "price": 14999, "decorations": ["150 Balloons", "Premium Backdrop", "Welcome Board", "Foil Balloons", "LED Lights"], "addons": common_addons, "max_addons": 6, "active": True, "created_at": now_iso()},
            {"id": str(uuid.uuid4()), "name": "Diamond", "price": 24999, "decorations": ["250 Balloons", "Luxury Backdrop", "Welcome Board", "Foil Balloons", "LED Lights", "Photo Props", "Cake Table Setup"], "addons": common_addons, "max_addons": 10, "active": True, "created_at": now_iso()},
        ]
        await db.packages.insert_many(defaults)
        logger.info("Seeded default packages")


    # Backfill addons on existing packages (safe no-op if already set)
    await db.packages.update_many({"addons": {"$exists": False}}, {"$set": {"addons": ["Cake Table", "Photo Props", "LED Lights", "Fog Machine", "Confetti Cannon", "Bubble Machine", "Photobooth", "Name Board", "Character Cutout", "Return Gifts"]}})

    # Seed demo WhatsApp conversations
    await _seed_wa(db)

    # Background sweep: flip Confirmed -> In Progress and Fully Paid -> Completed
    # for bookings whose event_date is today. Runs hourly.
    import asyncio

    async def _bg_sweep():
        while True:
            try:
                await _sweep_event_day(db)
            except Exception as e:
                logger.warning(f"sweep_event_day failed: {e}")
            await asyncio.sleep(3600)  # every hour

    asyncio.create_task(_bg_sweep())
    # Also run once immediately at startup
    try:
        await _sweep_event_day(db)
    except Exception as e:
        logger.warning(f"initial sweep failed: {e}")


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
