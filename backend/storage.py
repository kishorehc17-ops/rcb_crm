"""
Emergent Object Storage helper for RCB Events CRM.

- init_storage() once at app startup gets a session-scoped storage_key.
- put_object(path, data, content_type) uploads a file, returns metadata.
- get_object(path) downloads a file, returns (bytes, content_type).
- File references are tracked in the `files` MongoDB collection with a
  `is_deleted` soft-delete flag (storage has no delete API).
"""
from __future__ import annotations

import logging
import os
import time
from typing import Optional

import requests

logger = logging.getLogger(__name__)

STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
APP_NAME = "rcbevents"

_storage_key: Optional[str] = None


def _emergent_key() -> str:
    key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not key:
        raise RuntimeError("EMERGENT_LLM_KEY not set")
    return key


def init_storage() -> str:
    """Call once at startup. Returns session-scoped storage_key."""
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(
        f"{STORAGE_URL}/init",
        json={"emergent_key": _emergent_key()},
        timeout=30,
    )
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    logger.info("Emergent Object Storage initialized")
    return _storage_key


def _refresh_key():
    global _storage_key
    _storage_key = None
    return init_storage()


def put_object(path: str, data: bytes, content_type: str) -> dict:
    """Upload a file. Returns {path, size, etag}."""
    key = init_storage()
    for attempt in range(3):
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
        if resp.status_code == 403:
            key = _refresh_key()
            continue
        if resp.status_code == 429:
            time.sleep(2 ** attempt)
            continue
        resp.raise_for_status()
        return resp.json()
    resp.raise_for_status()  # bubble the last error
    return {}


def get_object(path: str) -> tuple[bytes, str]:
    """Download a file. Returns (bytes, content_type)."""
    key = init_storage()
    for attempt in range(3):
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=60,
        )
        if resp.status_code == 403:
            key = _refresh_key()
            continue
        if resp.status_code == 429:
            time.sleep(2 ** attempt)
            continue
        resp.raise_for_status()
        return resp.content, resp.headers.get("Content-Type", "application/octet-stream")
    resp.raise_for_status()
    return b"", "application/octet-stream"


MIME = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif", "webp": "image/webp",
}


def build_path(user_id: str, filename_ext: str) -> str:
    """Return an app-prefixed, uuid-based storage path."""
    import uuid
    ext = (filename_ext or "").lstrip(".").lower() or "bin"
    return f"{APP_NAME}/uploads/{user_id}/{uuid.uuid4().hex}.{ext}"
