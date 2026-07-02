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
    status: str = "Inquiry"
    total_amount: float = 0
    advance_paid: float = 0


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


# ---------- Bookings ----------
def _booking_number():
    return "RCB-" + datetime.now(timezone.utc).strftime("%y%m%d") + "-" + uuid.uuid4().hex[:5].upper()


@api_router.get("/bookings")
async def list_bookings(user: dict = Depends(get_current_user)):
    docs = await db.bookings.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return docs


@api_router.post("/bookings")
async def create_booking(data: BookingIn, user: dict = Depends(get_current_user)):
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["booking_number"] = _booking_number()
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    await db.bookings.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/bookings/{booking_id}")
async def get_booking(booking_id: str, user: dict = Depends(get_current_user)):
    doc = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Booking not found")
    return doc


@api_router.put("/bookings/{booking_id}")
async def update_booking(booking_id: str, data: BookingIn, user: dict = Depends(get_current_user)):
    upd = data.model_dump()
    upd["updated_at"] = now_iso()
    result = await db.bookings.update_one({"id": booking_id}, {"$set": upd})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Booking not found")
    doc = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    return doc


@api_router.delete("/bookings/{booking_id}")
async def delete_booking(booking_id: str, user: dict = Depends(get_current_user)):
    result = await db.bookings.delete_one({"id": booking_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Booking not found")
    return {"ok": True}


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
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    await db.payments.insert_one(doc)
    # Update booking advance
    booking = await db.bookings.find_one({"id": data.booking_id})
    if booking:
        new_advance = (booking.get("advance_paid") or 0) + data.amount
        await db.bookings.update_one({"id": data.booking_id}, {"$set": {"advance_paid": new_advance, "updated_at": now_iso()}})
    doc.pop("_id", None)
    return doc


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
    if data.name: upd["name"] = data.name
    if data.role:
        if data.role not in ("admin", "manager", "sales", "staff"):
            raise HTTPException(status_code=400, detail="Invalid role")
        upd["role"] = data.role
    if data.password: upd["password_hash"] = hash_password(data.password)
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
    import hmac, hashlib
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
    pay_entity = (payload.get("payment") or {}).get("entity") or {}

    booking_id = None
    amount = 0.0
    link_id = pl_entity.get("id") or pay_entity.get("payment_link_id")

    # Prefer payment_link entity data (has notes and amount_paid)
    if pl_entity:
        booking_id = (pl_entity.get("notes") or {}).get("booking_id")
        amount = float(pl_entity.get("amount_paid") or pl_entity.get("amount") or 0) / 100
    if not amount and pay_entity:
        amount = float(pay_entity.get("amount") or 0) / 100
    if not booking_id:
        booking_id = (pay_entity.get("notes") or {}).get("booking_id")
    # Fallback: look up booking by stored payment_link_id
    if not booking_id and link_id:
        b = await db.bookings.find_one({"payment_link_id": link_id}, {"id": 1})
        if b:
            booking_id = b.get("id")

    logger.info(f"Webhook parsed: booking_id={booking_id}, amount={amount}, link_id={link_id}")

    if ev in ("payment_link.paid", "payment.captured") and booking_id and amount > 0:
        b = await db.bookings.find_one({"id": booking_id})
        if b:
            # Idempotency: skip if we already recorded this exact razorpay payment id
            rzp_pay_id = pay_entity.get("id")
            if rzp_pay_id and await db.payments.find_one({"rzp_payment_id": rzp_pay_id}):
                logger.info(f"Webhook: duplicate payment id {rzp_pay_id}, skipping")
                return {"ok": True, "duplicate": True}
            new_adv = float(b.get("advance_paid") or 0) + amount
            await db.bookings.update_one({"id": booking_id}, {"$set": {
                "advance_paid": new_adv, "payment_link_status": "paid",
                "updated_at": now_iso()}})
            await db.payments.insert_one({"id": str(uuid.uuid4()),
                "booking_id": booking_id, "amount": amount, "method": "Razorpay",
                "note": f"Auto via webhook ({ev})", "rzp_payment_id": rzp_pay_id,
                "created_at": now_iso()})
            logger.info(f"Webhook: booking {booking_id} advance updated to {new_adv}")
    return {"ok": True}


@api_router.post("/payments/sync/{booking_id}")
async def sync_payment(booking_id: str, user: dict = Depends(get_current_user)):
    """Manually fetch Razorpay payment link status and reconcile advance_paid."""
    if not rzp_client:
        raise HTTPException(status_code=500, detail="Razorpay not configured")
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b or not b.get("payment_link_id"):
        raise HTTPException(status_code=404, detail="No payment link on this booking")
    try:
        link = rzp_client.payment_link.fetch(b["payment_link_id"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Razorpay error: {e}")
    amount_paid = float(link.get("amount_paid", 0)) / 100
    status = link.get("status", "created")
    # Only add difference between what Razorpay says was paid and what we've already recorded
    already_recorded = 0.0
    async for p in db.payments.find({"booking_id": booking_id, "method": "Razorpay"}):
        already_recorded += float(p.get("amount", 0))
    delta = amount_paid - already_recorded
    if delta > 0:
        new_adv = float(b.get("advance_paid") or 0) + delta
        await db.bookings.update_one({"id": booking_id}, {"$set": {
            "advance_paid": new_adv, "payment_link_status": status, "updated_at": now_iso()}})
        await db.payments.insert_one({"id": str(uuid.uuid4()), "booking_id": booking_id,
            "amount": delta, "method": "Razorpay", "note": "Reconciled via sync",
            "created_at": now_iso()})
    else:
        await db.bookings.update_one({"id": booking_id}, {"$set": {"payment_link_status": status}})
    return {"status": status, "amount_paid": amount_paid, "reconciled": delta}


# ---------- Health ----------
@api_router.get("/")
async def root():
    return {"message": "RCB Events CRM API", "status": "ok"}


# ---------- File Upload ----------
UPLOAD_DIR = ROOT_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


@api_router.post("/upload")
async def upload_file(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    ext = os.path.splitext(file.filename or "img.jpg")[1].lower() or ".jpg"
    if ext not in {".jpg", ".jpeg", ".png", ".gif", ".webp"}:
        raise HTTPException(status_code=400, detail="Only image files are allowed")
    filename = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOAD_DIR / filename
    contents = await file.read()
    dest.write_bytes(contents)
    return {"url": f"/api/uploads/{filename}"}


# ---------- Include router ----------
app.include_router(api_router)

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


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
