"""
WhatsApp Cloud API integration for RCB Events CRM.

- Webhook endpoints (verify + receive) per Meta WhatsApp Cloud API spec.
- Auto-creates a lead in `leads` collection on first incoming message from a
  new phone number, and uses an LLM to parse a possible event date + location
  from the free-text message.
- Stores conversations & messages in Mongo so the UI can render a WhatsApp-style
  chat panel embedded inside the Pipeline page.
- Ships with a `POST /api/whatsapp/mock/incoming` endpoint so the whole UI can
  be exercised end-to-end without live Meta credentials, and seeds a couple of
  demo conversations on startup for immediate visibility.
- Sending outbound messages: when WHATSAPP_ACCESS_TOKEN / PHONE_NUMBER_ID are
  present the send endpoint POSTs to Graph API; otherwise it stores the message
  locally as an outbound "queued" record so the UI still works.
"""
from __future__ import annotations

import os
import re
import uuid
import json
import logging
import hmac
import hashlib
from datetime import datetime, timezone
from typing import Optional, List

import httpx
from fastapi import APIRouter, HTTPException, Depends, Request, Query
from pydantic import BaseModel, ConfigDict

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])

STAGES = ["Lead", "Contacted", "Quotation Sent", "Negotiation", "Booked", "Completed", "Review Received"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_phone(num: str) -> str:
    """Return digits-only phone number. Strip leading + and spaces."""
    return re.sub(r"\D", "", num or "")


# ---------------- LLM Parsing ----------------

async def parse_lead_details(text: str) -> dict:
    """Use Emergent LLM key + Claude to try to extract event_date + location
    from a chat message. Returns {location, event_date} with either or both None.
    Fails silently — parsing is best-effort.
    """
    if not text or len(text.strip()) < 3:
        return {"location": None, "event_date": None}
    api_key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not api_key:
        return {"location": None, "event_date": None}
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=api_key,
            session_id=f"wa-parse-{uuid.uuid4().hex[:8]}",
            system_message=(
                "You extract event booking details from short WhatsApp chat "
                "messages sent to a balloon-decoration business in India. "
                "Return STRICT JSON: {\"location\": <string or null>, "
                "\"event_date\": <YYYY-MM-DD or null>}. "
                "Location = area/city if mentioned (e.g. 'Bangalore', 'HSR Layout'). "
                "event_date = a specific calendar date if mentioned (e.g. '15 March', "
                "'next Sunday'). Assume year 2026 if year not specified. "
                "If information is missing, use null. Return ONLY the JSON, no prose."
            ),
        ).with_model("anthropic", "claude-sonnet-4-6")
        resp = await chat.send_message(UserMessage(text=text[:800]))
        raw = str(resp).strip()
        # Extract JSON — model may wrap in ```json fences
        m = re.search(r"\{[^{}]*\}", raw, re.DOTALL)
        if not m:
            return {"location": None, "event_date": None}
        data = json.loads(m.group(0))
        return {
            "location": data.get("location") or None,
            "event_date": data.get("event_date") or None,
        }
    except Exception as e:
        logger.warning(f"LLM parse failed: {e}")
        return {"location": None, "event_date": None}


# ---------------- DB helpers ----------------

async def _ensure_lead(db, wa_id: str, profile_name: str, first_message_text: str) -> dict:
    """Find existing lead by mobile == wa_id; if none, create a new one and try
    to parse location/date via LLM. Returns the lead dict.

    If an existing lead exists with a placeholder "WA XXXX" name and a real
    profile_name arrives later, upgrade the lead's name in place.
    """
    lead = await db.leads.find_one({"mobile": wa_id}, {"_id": 0})
    if lead:
        current_name = (lead.get("name") or "").strip()
        is_placeholder = current_name.startswith("WA ") and len(current_name) <= 8
        clean_profile = (profile_name or "").strip()
        if is_placeholder and clean_profile:
            await db.leads.update_one({"id": lead["id"]}, {"$set": {
                "name": clean_profile,
                "wa_profile_name": clean_profile,
            }})
            # Also update the conversation record
            await db.wa_conversations.update_one({"wa_id": wa_id}, {"$set": {
                "profile_name": clean_profile,
            }})
            lead["name"] = clean_profile
            lead["wa_profile_name"] = clean_profile
            logger.info(f"WA upgraded lead name for {wa_id}: {clean_profile}")
        return lead
    parsed = await parse_lead_details(first_message_text)
    lead = {
        "id": str(uuid.uuid4()),
        "name": (profile_name or "").strip() or f"WA {wa_id[-4:]}",
        "mobile": wa_id,
        "source": "WhatsApp",
        "stage": "Lead",
        "notes": first_message_text[:500] if first_message_text else "",
        "event_date": parsed.get("event_date"),
        "location": parsed.get("location") or "",
        "theme": "",
        "wa_profile_name": profile_name or "",
        "created_at": now_iso(),
    }
    await db.leads.insert_one(lead)
    logger.info(f"WA auto-created lead for {wa_id} → {lead['id']}")
    lead.pop("_id", None)
    return lead


async def _upsert_conversation(db, wa_id: str, profile_name: str, last_text: str, direction: str):
    await db.wa_conversations.update_one(
        {"wa_id": wa_id},
        {
            "$set": {
                "wa_id": wa_id,
                "profile_name": profile_name or "",
                "last_message": (last_text or "")[:200],
                "last_direction": direction,
                "last_at": now_iso(),
            },
            "$setOnInsert": {"created_at": now_iso()},
            "$inc": {"unread": 1 if direction == "in" else 0},
        },
        upsert=True,
    )


async def _insert_message(db, wa_id: str, direction: str, text: str, msg_type: str = "text",
                           media_url: Optional[str] = None, wa_msg_id: Optional[str] = None):
    doc = {
        "id": str(uuid.uuid4()),
        "wa_id": wa_id,
        "direction": direction,  # "in" or "out"
        "type": msg_type,        # "text" | "image"
        "text": text or "",
        "media_url": media_url,
        "wa_msg_id": wa_msg_id,
        "status": "delivered" if direction == "in" else "sent",
        "created_at": now_iso(),
    }
    await db.wa_messages.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ---------------- Public helper for import ----------------

async def handle_incoming_message(db, wa_id: str, profile_name: str, text: str,
                                    msg_type: str = "text", media_url: Optional[str] = None,
                                    wa_msg_id: Optional[str] = None):
    """Public entry point used by webhook + mock endpoint."""
    wa_id = _normalize_phone(wa_id)
    if not wa_id:
        return None
    lead = await _ensure_lead(db, wa_id, profile_name, text if msg_type == "text" else "")
    msg = await _insert_message(db, wa_id, "in", text, msg_type, media_url, wa_msg_id)
    await _upsert_conversation(db, wa_id, profile_name, text if msg_type == "text" else "[image]", "in")
    return {"lead": lead, "message": msg}


# ---------------- Routes ----------------

class SendMessageIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    wa_id: str
    text: str
    type: str = "text"  # "text" | "image"
    media_url: Optional[str] = None


class MockIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    wa_id: str
    profile_name: Optional[str] = ""
    text: str
    type: str = "text"
    media_url: Optional[str] = None


class SendPackageIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    wa_id: str
    package_id: str


def build_router(get_current_user, db):
    """Register routes with an outer dependency on auth + db handle."""

    @router.get("/conversations")
    async def list_conversations(user: dict = Depends(get_current_user)):
        convos = await db.wa_conversations.find({}, {"_id": 0}).sort("last_at", -1).to_list(500)
        # attach lead info if present
        wa_ids = [c["wa_id"] for c in convos]
        leads = {ld["mobile"]: ld async for ld in db.leads.find({"mobile": {"$in": wa_ids}}, {"_id": 0})}
        for c in convos:
            ld = leads.get(c["wa_id"])
            c["lead_id"] = ld.get("id") if ld else None
            c["lead_name"] = ld.get("name") if ld else c.get("profile_name", "")
            c["stage"] = ld.get("stage") if ld else "Lead"
            c["location"] = ld.get("location") if ld else ""
            c["event_date"] = ld.get("event_date") if ld else None
        return convos

    @router.get("/conversations/{wa_id}/messages")
    async def list_messages(wa_id: str, user: dict = Depends(get_current_user)):
        wa_id = _normalize_phone(wa_id)
        msgs = await db.wa_messages.find({"wa_id": wa_id}, {"_id": 0}).sort("created_at", 1).to_list(2000)
        # mark read
        await db.wa_conversations.update_one({"wa_id": wa_id}, {"$set": {"unread": 0}})
        return msgs

    @router.post("/send")
    async def send_message(data: SendMessageIn, user: dict = Depends(get_current_user)):
        wa_id = _normalize_phone(data.wa_id)
        if not wa_id:
            raise HTTPException(400, "Invalid wa_id")
        wa_msg_id = None
        status = "queued"
        # Provider selection: Deropo (if configured) → Meta Cloud API (if configured) → mock
        try:
            from deropo import is_enabled as _deropo_on, send_text as _dsend_text, send_image as _dsend_image
            if _deropo_on():
                if data.type == "image":
                    resp = await _dsend_image(wa_id, data.media_url or "", data.text or "")
                else:
                    resp = await _dsend_text(wa_id, data.text or "")
                if resp.get("ok"):
                    wa_msg_id = resp.get("provider_id")
                    status = "sent (deropo)"
                else:
                    logger.warning(f"Deropo send failed: {resp.get('error')}")
                    status = f"failed: {resp.get('error', 'deropo error')[:80]}"
            else:
                token = os.environ.get("WHATSAPP_ACCESS_TOKEN", "")
                phone_id = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "")
                if token and phone_id:
                    payload = {"messaging_product": "whatsapp", "to": wa_id, "type": data.type}
                    if data.type == "text":
                        payload["text"] = {"body": data.text}
                    elif data.type == "image":
                        payload["image"] = {"link": data.media_url, "caption": data.text or ""}
                    async with httpx.AsyncClient(timeout=15) as cli:
                        r = await cli.post(
                            f"https://graph.facebook.com/v20.0/{phone_id}/messages",
                            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                            json=payload,
                        )
                    if r.status_code >= 300:
                        logger.warning(f"WA send failed {r.status_code}: {r.text}")
                        raise HTTPException(502, f"Meta API error: {r.text[:200]}")
                    body = r.json()
                    wa_msg_id = (body.get("messages") or [{}])[0].get("id")
                    status = "sent"
                else:
                    status = "sent (mock)"
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("send error")
            raise HTTPException(500, str(e))
        msg = await _insert_message(db, wa_id, "out", data.text, data.type, data.media_url, wa_msg_id)
        msg["status"] = status
        await db.wa_messages.update_one({"id": msg["id"]}, {"$set": {"status": status}})
        # update conversation preview
        convo = await db.wa_conversations.find_one({"wa_id": wa_id})
        profile_name = (convo or {}).get("profile_name", "")
        await _upsert_conversation(db, wa_id, profile_name,
                                     data.text if data.type == "text" else "[image]", "out")
        return msg

    @router.get("/webhook")
    async def verify_webhook(
        hub_mode: str = Query(default="", alias="hub.mode"),
        hub_challenge: str = Query(default="", alias="hub.challenge"),
        hub_verify_token: str = Query(default="", alias="hub.verify_token"),
    ):
        """Meta webhook verification handshake."""
        expected = os.environ.get("WHATSAPP_VERIFY_TOKEN", "")
        if hub_mode == "subscribe" and expected and hub_verify_token == expected:
            # Meta expects the raw challenge string returned
            from fastapi.responses import PlainTextResponse
            return PlainTextResponse(hub_challenge)
        raise HTTPException(status_code=403, detail="Verification failed")

    @router.post("/webhook")
    async def receive_webhook(request: Request):
        """Incoming WhatsApp messages from Meta Cloud API."""
        raw = await request.body()
        # Optional signature validation (X-Hub-Signature-256)
        app_secret = os.environ.get("WHATSAPP_APP_SECRET", "")
        if app_secret:
            signature = request.headers.get("x-hub-signature-256", "")
            expected = "sha256=" + hmac.new(app_secret.encode(), raw, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, signature):
                logger.warning("WhatsApp webhook: invalid signature")
                raise HTTPException(status_code=403, detail="Invalid signature")
        try:
            body = json.loads(raw or b"{}")
        except Exception:
            raise HTTPException(400, "Invalid JSON")

        # Meta payload traversal
        for entry in body.get("entry", []) or []:
            for change in entry.get("changes", []) or []:
                value = change.get("value", {}) or {}
                contacts = {c.get("wa_id"): c.get("profile", {}).get("name", "")
                            for c in (value.get("contacts") or [])}
                for m in value.get("messages", []) or []:
                    wa_from = m.get("from") or ""
                    profile = contacts.get(wa_from, "")
                    mtype = m.get("type", "text")
                    text = ""
                    media_url = None
                    if mtype == "text":
                        text = (m.get("text") or {}).get("body", "")
                    elif mtype == "image":
                        text = (m.get("image") or {}).get("caption", "") or "[image]"
                        media_url = (m.get("image") or {}).get("id")
                    else:
                        text = f"[{mtype} message]"
                    await handle_incoming_message(
                        db, wa_from, profile, text, mtype, media_url, m.get("id")
                    )
        return {"ok": True}

    @router.post("/mock/incoming")
    async def mock_incoming(data: MockIn, user: dict = Depends(get_current_user)):
        """DEV: simulate an incoming WhatsApp message (no Meta creds needed)."""
        result = await handle_incoming_message(
            db, data.wa_id, data.profile_name or "", data.text, data.type, data.media_url,
        )
        if not result:
            raise HTTPException(400, "Invalid wa_id")
        return result

    @router.post("/send-package")
    async def send_package(data: SendPackageIn, user: dict = Depends(get_current_user)):
        """Send a package's images + description + price to a customer via WA."""
        wa_id = _normalize_phone(data.wa_id)
        pkg = await db.packages.find_one({"id": data.package_id}, {"_id": 0})
        if not pkg:
            raise HTTPException(404, "Package not found")
        # Compose caption — read from both new + legacy field names
        includes = pkg.get("decorations") or pkg.get("includes") or []
        addons = pkg.get("addons") or pkg.get("available_addons") or []
        max_ad = pkg.get("max_addons")
        price = pkg.get("price") or 0
        offer_price = pkg.get("offer_price")
        try:
            price_int = int(round(float(price)))
        except Exception:
            price_int = 0
        offer_int = None
        if offer_price:
            try:
                offer_int = int(round(float(offer_price)))
            except Exception:
                offer_int = None

        header = f"*{pkg.get('name', 'Package')}*"
        if offer_int and offer_int < price_int:
            savings = round(((price_int - offer_int) / price_int) * 100)
            price_line = f"~₹{price_int:,}~  *₹{offer_int:,}*  🎉 {savings}% OFF"
        else:
            price_line = f"₹{price_int:,}"
        parts = [f"{header}", price_line]
        if pkg.get("description"):
            parts.append("")
            parts.append(pkg["description"])
        if includes:
            parts.append("")
            parts.append("_Includes:_")
            parts.extend([f"✔ {x}" for x in includes[:10]])
        if addons:
            parts.append("")
            if max_ad:
                parts.append(f"_Add-ons (pick up to {max_ad}):_")
            else:
                parts.append("_Add-ons:_")
            parts.extend([f"• {x}" for x in addons[:8]])
        parts.append("")
        parts.append("Reply here to book. 🎈")
        caption = "\n".join(parts)

        # Cover / gallery photos — new field first, then legacy fallbacks
        photos = (pkg.get("photos") or []) + ([pkg.get("cover_image")] if pkg.get("cover_image") else []) + ([pkg.get("photo")] if pkg.get("photo") else [])
        # de-duplicate while preserving order and drop empties
        seen = set()
        photos = [p for p in photos if p and not (p in seen or seen.add(p))]
        sent_msgs = []
        try:
            from deropo import is_enabled as _deropo_on, send_image as _dsend_image, send_text as _dsend_text
            if _deropo_on() and photos:
                # Send first photo with the full caption
                r = await _dsend_image(wa_id, photos[0], caption)
                m = await _insert_message(db, wa_id, "out", caption, "image", photos[0], r.get("provider_id"))
                await db.wa_messages.update_one({"id": m["id"]}, {"$set": {"status": "sent (deropo)" if r.get("ok") else "failed"}})
                sent_msgs.append(m)
                # Send extra photos without captions (max 2 more so we don't spam)
                for p in photos[1:3]:
                    r2 = await _dsend_image(wa_id, p, "")
                    m2 = await _insert_message(db, wa_id, "out", "[image]", "image", p, r2.get("provider_id"))
                    sent_msgs.append(m2)
            else:
                # Text-only fallback
                if _deropo_on():
                    r = await _dsend_text(wa_id, caption)
                    provider_id = r.get("provider_id")
                    status = "sent (deropo)" if r.get("ok") else "failed"
                else:
                    provider_id = None
                    status = "sent (mock)"
                m = await _insert_message(db, wa_id, "out", caption, "text", None, provider_id)
                await db.wa_messages.update_one({"id": m["id"]}, {"$set": {"status": status}})
                sent_msgs.append(m)
        except Exception as e:
            logger.exception("send_package failed")
            raise HTTPException(500, str(e))
        # Refresh conversation
        convo = await db.wa_conversations.find_one({"wa_id": wa_id})
        profile_name = (convo or {}).get("profile_name", "")
        await _upsert_conversation(db, wa_id, profile_name,
                                   f"📦 Package: {pkg.get('name')}", "out")
        return {"messages": sent_msgs, "package": pkg.get("name"), "caption": caption}

    return router


async def seed_demo_conversations(db):
    """Seed a couple of sample conversations on startup so the UI has content
    before any live webhook events arrive. Idempotent — runs once."""
    if await db.wa_conversations.count_documents({}) > 0:
        return
    demo = [
        {
            "wa_id": "919845012345",
            "profile_name": "Priya Sharma",
            "location": "HSR Layout, Bangalore",
            "event_date": "2026-03-15",
            "messages": [
                ("in", "Hi, I need balloon decoration for my daughter's 5th birthday"),
                ("out", "Hello Priya! We'd love to help. What theme are you thinking?"),
                ("in", "Unicorn theme. Date is 15 March 2026. Location HSR Layout, Bangalore"),
                ("out", "Perfect! Our Gold package (₹9999) covers 100 balloons + themed backdrop. Shall I share full details?"),
                ("in", "Yes please send me the details"),
            ],
        },
        {
            "wa_id": "919886054321",
            "profile_name": "Rohit Kumar",
            "location": "Whitefield",
            "event_date": None,
            "messages": [
                ("in", "Do you do baby shower decorations?"),
                ("out", "Absolutely! We have specialized baby-shower packages. When is the event?"),
                ("in", "Next Sunday in Whitefield"),
            ],
        },
        {
            "wa_id": "917349977889",
            "profile_name": "Anjali Nair",
            "location": "",
            "event_date": None,
            "messages": [
                ("in", "Hi"),
                ("in", "Price for anniversary decor?"),
            ],
        },
    ]
    for d in demo:
        wa = d["wa_id"]
        # lead
        lead = {
            "id": str(uuid.uuid4()),
            "name": d["profile_name"],
            "mobile": wa,
            "source": "WhatsApp",
            "stage": "Lead",
            "notes": d["messages"][0][1][:500],
            "event_date": d["event_date"],
            "location": d["location"],
            "theme": "",
            "wa_profile_name": d["profile_name"],
            "created_at": now_iso(),
        }
        # avoid duplicating existing leads for same mobile
        if not await db.leads.find_one({"mobile": wa}):
            await db.leads.insert_one(lead)
        for direction, text in d["messages"]:
            await _insert_message(db, wa, direction, text, "text")
        last_dir, last_txt = d["messages"][-1]
        await db.wa_conversations.update_one(
            {"wa_id": wa},
            {"$set": {
                "wa_id": wa,
                "profile_name": d["profile_name"],
                "last_message": last_txt[:200],
                "last_direction": last_dir,
                "last_at": now_iso(),
                "unread": 1 if last_dir == "in" else 0,
                "created_at": now_iso(),
            }},
            upsert=True,
        )
    logger.info("Seeded demo WhatsApp conversations")
