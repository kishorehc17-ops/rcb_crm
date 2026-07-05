"""
Deropo WhatsApp provider integration for RCB Events CRM.

Docs (as provided by product owner):
- Base URL: https://api.deropo.com/api  (override via DEROPO_BASE_URL)
- Device ID: 675                        (override via DEROPO_DEVICE_ID)
- API Key:   process.env.DEROPO_API_KEY (never hard-code)

Outgoing:  GET /api/send with query params {number, type, message, image_url|document_url, access_token}
Incoming:  our webhook at POST /api/deropo/webhook — accepts events:
             message_received, message_sent, message_delivered, message_read, message_failed

This module is a thin async service used by the existing WhatsApp router.
Send helpers are best-effort: they return a dict {ok, provider_id?, error?} so the
caller can still record a local message even if delivery fails.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import httpx
from fastapi import APIRouter, Request, HTTPException

logger = logging.getLogger(__name__)


def _cfg():
    return {
        "base_url": os.environ.get("DEROPO_BASE_URL", "https://api.deropo.com/api"),
        "device_id": os.environ.get("DEROPO_DEVICE_ID", ""),
        "api_key": os.environ.get("DEROPO_API_KEY", ""),
    }


def is_enabled() -> bool:
    c = _cfg()
    return bool(c["api_key"])


async def _send(params: dict) -> dict:
    cfg = _cfg()
    if not cfg["api_key"]:
        return {"ok": False, "error": "DEROPO_API_KEY not set"}
    params["access_token"] = cfg["api_key"]
    if cfg["device_id"] and "device_id" not in params:
        params["device_id"] = cfg["device_id"]
    url = f"{cfg['base_url'].rstrip('/')}/send"
    try:
        async with httpx.AsyncClient(timeout=20) as cli:
            r = await cli.get(url, params=params)
        body = r.text
        try:
            j = r.json()
        except Exception:
            j = {"raw": body}
        if r.status_code >= 300:
            logger.warning(f"Deropo send failed [{r.status_code}]: {body[:200]}")
            return {"ok": False, "status": r.status_code, "error": body[:200]}
        provider_id = None
        if isinstance(j, dict):
            provider_id = j.get("id") or j.get("message_id") or (j.get("data") or {}).get("id")
        return {"ok": True, "provider_id": provider_id, "raw": j}
    except Exception as e:
        logger.exception("Deropo send exception")
        return {"ok": False, "error": str(e)}


async def send_text(number: str, message: str) -> dict:
    return await _send({"number": number, "type": "text", "message": message})


async def send_image(number: str, image_url: str, caption: str = "") -> dict:
    return await _send({
        "number": number, "type": "image", "message": caption or "",
        "image_url": image_url,
    })


async def send_document(number: str, document_url: str, caption: str = "") -> dict:
    return await _send({
        "number": number, "type": "document", "message": caption or "",
        "document_url": document_url,
    })


# Future-ready stubs — same shape, extend when Deropo docs specify
async def send_video(number: str, video_url: str, caption: str = "") -> dict:
    return await _send({"number": number, "type": "video", "message": caption or "", "video_url": video_url})


async def send_audio(number: str, audio_url: str) -> dict:
    return await _send({"number": number, "type": "audio", "audio_url": audio_url})


async def send_buttons(number: str, message: str, buttons: list) -> dict:
    import json as _json
    return await _send({"number": number, "type": "buttons", "message": message,
                        "buttons": _json.dumps(buttons)})


async def send_list(number: str, message: str, sections: list) -> dict:
    import json as _json
    return await _send({"number": number, "type": "list", "message": message,
                        "sections": _json.dumps(sections)})


async def send_template(number: str, template_name: str, params: Optional[list] = None) -> dict:
    payload = {"number": number, "type": "template", "template": template_name}
    if params:
        import json as _json
        payload["params"] = _json.dumps(params)
    return await _send(payload)


async def mark_as_read(message_id: str) -> dict:
    cfg = _cfg()
    if not cfg["api_key"]:
        return {"ok": False, "error": "DEROPO_API_KEY not set"}
    try:
        async with httpx.AsyncClient(timeout=15) as cli:
            r = await cli.get(f"{cfg['base_url'].rstrip('/')}/mark-read",
                              params={"message_id": message_id, "access_token": cfg["api_key"]})
        return {"ok": r.status_code < 300, "status": r.status_code}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ---------------- Webhook parsing ----------------

def parse_webhook(body: dict) -> Optional[dict]:
    """Normalise Deropo webhook payload into a common shape used by the
    existing WhatsApp handler. Deropo sends events; we care about
    message_received (incoming customer message) and status updates
    (delivered / read / failed / sent) for outbound messages.

    Returns dict:
      {
        "event": "message_received" | "message_sent" | "message_delivered"
                 | "message_read" | "message_failed",
        "wa_id": "919xxxxx",         # customer's number (E.164 digits only)
        "profile_name": "Priya",
        "type": "text|image|document|video|audio",
        "text": "hello",
        "media_url": "https://...",  # optional
        "provider_id": "abc123",     # Deropo message id
        "timestamp": "2026-07-03T...",
      }
    Returns None if the event is not one we handle.
    """
    ev = (body.get("event") or body.get("type") or "").lower()
    # Deropo variations: some payloads may use "message" root
    data = body.get("data") or body.get("message") or body
    if not isinstance(data, dict):
        return None
    # Determine event kind
    if ev in {"", "message"}:
        # If direction present, use it
        direction = (data.get("direction") or data.get("from_me") or "").lower()
        if direction in {"outgoing", "out", "true", "1"} or data.get("from_me") is True:
            ev = "message_sent"
        else:
            ev = "message_received"
    known = {"message_received", "message_sent", "message_delivered",
             "message_read", "message_failed"}
    if ev not in known:
        return None

    # Extract the customer number. For incoming: from=customer. For outgoing status: to=customer.
    wa_from = (data.get("from") or data.get("sender") or data.get("phone")
               or data.get("number") or data.get("to") or "")
    wa_id = "".join(ch for ch in str(wa_from) if ch.isdigit())
    if not wa_id:
        return None

    msg_type = (data.get("type") or "text").lower()
    text = (data.get("message") or data.get("text") or data.get("body") or "")
    media_url = (data.get("media_url") or data.get("image_url")
                 or data.get("document_url") or data.get("video_url"))
    return {
        "event": ev,
        "wa_id": wa_id,
        "profile_name": data.get("name") or data.get("profile_name") or "",
        "type": msg_type,
        "text": text if isinstance(text, str) else str(text),
        "media_url": media_url,
        "provider_id": data.get("id") or data.get("message_id") or "",
        "timestamp": data.get("timestamp") or "",
    }


def build_router(db, handle_incoming_message):
    """Attach the /api/deropo/webhook endpoint. Reuses the existing WhatsApp
    incoming-handler so leads + conversations + messages stay in one place."""
    router = APIRouter(prefix="/api/deropo", tags=["deropo"])

    @router.post("/webhook")
    async def receive(request: Request):
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(400, "Invalid JSON")
        logger.info(f"Deropo webhook received: keys={list(body.keys())[:10]}")
        parsed = parse_webhook(body)
        if not parsed:
            return {"ok": True, "ignored": True}

        ev = parsed["event"]
        if ev == "message_received":
            await handle_incoming_message(
                db,
                parsed["wa_id"],
                parsed["profile_name"],
                parsed["text"] or ("[" + parsed["type"] + "]"),
                parsed["type"],
                parsed["media_url"],
                parsed["provider_id"] or None,
            )
            return {"ok": True, "created": True}

        # Status-only events (delivered / read / failed / sent) — update the
        # matching outbound message record if we have its provider_id.
        pid = parsed["provider_id"]
        if pid:
            new_status = {
                "message_sent": "sent",
                "message_delivered": "delivered",
                "message_read": "read",
                "message_failed": "failed",
            }.get(ev)
            if new_status:
                await db.wa_messages.update_one(
                    {"wa_msg_id": pid},
                    {"$set": {"status": new_status}},
                )
        return {"ok": True, "event": ev}

    return router
