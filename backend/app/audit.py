"""Append-only audit log writer (WHO / WHAT / WHEN / WHERE / BEFORE / AFTER / REASON)."""
from typing import Optional

from fastapi import Request

from .db import db
from .utils import now

SENSITIVE = {"password", "password_hash", "token", "refresh_token", "access_token", "code", "code_hash", "token_hash"}


def strip_sensitive(value):
    if isinstance(value, dict):
        return {k: strip_sensitive(v) for k, v in value.items() if k not in SENSITIVE}
    if isinstance(value, list):
        return [strip_sensitive(v) for v in value]
    return value


async def write_audit(
    actor: Optional[dict],
    action: str,
    entity_type: Optional[str] = None,
    entity_id=None,
    *,
    before=None,
    after=None,
    reason: Optional[str] = None,
    warehouse_id=None,
    request: Optional[Request] = None,
    session=None,
    meta=None,
):
    from .security import client_ip  # local import avoids a cycle

    doc = {
        "user_id": actor["_id"] if actor else None,
        "user_name": (actor.get("full_name") or actor.get("username")) if actor else None,
        "role": actor.get("role") if actor else None,
        "action": action,
        "entity_type": entity_type,
        "entity_id": str(entity_id) if entity_id is not None else None,
        "warehouse_id": warehouse_id,
        "before": strip_sensitive(before),
        "after": strip_sensitive(after),
        "reason": reason,
        "meta": strip_sensitive(meta),
        "ip": client_ip(request) if request else None,
        "user_agent": (request.headers.get("user-agent") or "")[:200] if request else None,
        "created_at": now(),
    }
    await db.audit_logs.insert_one(doc, session=session)
