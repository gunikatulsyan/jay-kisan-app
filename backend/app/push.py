"""Emergent-managed push relay (SuprSend passthrough). Device tokens are never stored by us —
the relay maps user_id -> devices. Pushes are sent only AFTER a stock change has committed and
never block or fail the stock operation."""
import asyncio
import logging
from typing import Literal, Optional

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from . import config
from .security import get_current_user
from .utils import AppError

log = logging.getLogger("jaykisan.push")

PUSH_BASE_URL = "https://integrations.emergentagent.com"
_client = httpx.AsyncClient(base_url=PUSH_BASE_URL, headers={"X-Push-Key": config.EMERGENT_PUSH_KEY}, timeout=10.0)
_tasks: set = set()

router = APIRouter(prefix="/api", tags=["push"])


class RegisterPushBody(BaseModel):
    user_id: str
    platform: Literal["android", "ios"]
    device_token: str = Field(min_length=1, max_length=4096)


@router.post("/register-push", status_code=201, summary="Register this device for push notifications")
async def register_push(body: RegisterPushBody, user: dict = Depends(get_current_user)):
    if body.user_id != str(user["_id"]):
        raise AppError(403, "FORBIDDEN", "You can only register your own device")
    resp = await _client.post("/api/v1/push/users/register", json=body.model_dump())
    if resp.status_code == 401:
        raise AppError(500, "PUSH_NOT_CONFIGURED", "EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise AppError(502, "PUSH_UNAVAILABLE", "Push provider unavailable")
    if resp.status_code >= 400:
        raise AppError(400, "PUSH_REGISTER_FAILED", "Could not register this device for notifications")
    return {"status": "registered"}


async def send_push(recipients: list[str], data: dict, idempotency_key: Optional[str] = None) -> None:
    if not recipients:
        return
    if len(recipients) > 100:
        raise ValueError("max 100 recipients per /trigger call; chunk before sending")
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    payload: dict = {"recipients": recipients, "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key
    resp = await _client.post("/api/v1/push/trigger", json=payload)
    if resp.status_code == 401:
        raise RuntimeError("EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise RuntimeError(f"Push provider unavailable ({resp.status_code})")
    resp.raise_for_status()


def _action_url(n: dict) -> str:
    if n.get("transaction_id"):
        return f"/transaction/{n['transaction_id']}"
    if n.get("product_id"):
        return f"/product/{n['product_id']}"
    return "/alerts"


def _push_message(n: dict) -> str:
    meta = n.get("meta") or {}
    msg = n["message"]
    if n["type"] == "SALE" and meta.get("warehouse_name"):
        msg += f" · {meta['warehouse_name']}"
        if meta.get("sold_to") and meta["sold_to"] != "—":
            msg += f" · Sold to {meta['sold_to']}"
    return msg


async def _dispatch(events: list) -> None:
    groups: dict = {}
    for e in events:
        p = e.get("payload") or {}
        if e.get("scope") != "user" or p.get("type") != "notification":
            continue
        n = p["data"]
        key = (n["type"], n.get("transaction_id"), n.get("product_id"), n.get("warehouse_id"))
        g = groups.setdefault(key, {"n": n, "users": []})
        g["users"].append(e["user_id"])
    for g in groups.values():
        n, users = g["n"], g["users"]
        data = {"title": n["title"], "message": _push_message(n), "action_url": _action_url(n)}
        for i in range(0, len(users), 100):
            try:
                await send_push(users[i:i + 100], data, idempotency_key=f"notif-{n.get('id')}-{i}")
            except Exception as ex:  # noqa: BLE001 — push must never break stock operations
                log.warning("Push failed (non-blocking): %s", ex)


def dispatch_pushes(events: list) -> None:
    """Fire-and-forget: sends a push for every committed owner notification."""
    if not any((e.get("payload") or {}).get("type") == "notification" for e in events or []):
        return
    task = asyncio.create_task(_dispatch(events))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
