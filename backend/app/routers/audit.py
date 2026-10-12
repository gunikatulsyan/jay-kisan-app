from typing import Optional

from fastapi import APIRouter, Depends, Query

from ..db import db
from ..schemas import AuditOut, Page
from ..security import require_owner
from ..utils import day_range, oid, oid_range, paginate

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=Page[AuditOut])
async def list_audit(
    user_id: Optional[str] = None, action: Optional[str] = None, entity_type: Optional[str] = None, entity_id: Optional[str] = None,
    date_from: Optional[str] = Query(None, alias="from"), date_to: Optional[str] = Query(None, alias="to"),
    cursor: Optional[str] = None, limit: int = Query(50, ge=1, le=100), _owner: dict = Depends(require_owner),
):
    filt: dict = {}
    if user_id:
        filt["user_id"] = oid(user_id, "user_id")
    if action:
        filt["action"] = {"$in": [a.strip().upper() for a in action.split(",") if a.strip()]}
    if entity_type:
        filt["entity_type"] = entity_type
    if entity_id:
        filt["entity_id"] = entity_id
    if date_from or date_to:
        filt["_id"] = oid_range(*day_range(date_from, date_to))
    docs, nxt = await paginate(db.audit_logs, filt, cursor=cursor, limit=limit)
    return Page[AuditOut](items=[AuditOut.from_mongo(d) for d in docs], next_cursor=nxt)
