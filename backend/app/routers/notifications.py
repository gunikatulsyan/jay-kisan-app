from typing import Optional

from fastapi import APIRouter, Depends, Query

from ..db import db
from ..schemas import Message, NotificationOut, Page
from ..security import get_current_user
from ..utils import not_found, now, oid, paginate

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=Page[NotificationOut])
async def list_notifications(unread_only: bool = False, cursor: Optional[str] = None, limit: int = Query(30, ge=1, le=100),
                             user: dict = Depends(get_current_user)):
    filt: dict = {"recipient_id": user["_id"]}
    if unread_only:
        filt["read"] = False
    docs, nxt = await paginate(db.notifications, filt, cursor=cursor, limit=limit)
    return Page[NotificationOut](items=[NotificationOut.from_mongo(d) for d in docs], next_cursor=nxt)


@router.get("/unread-count")
async def unread_count(user: dict = Depends(get_current_user)):
    return {"count": await db.notifications.count_documents({"recipient_id": user["_id"], "read": False})}


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_read(notification_id: str, user: dict = Depends(get_current_user)):
    doc = await db.notifications.find_one_and_update(
        {"_id": oid(notification_id), "recipient_id": user["_id"]},
        [{"$set": {"read": True, "read_at": {"$ifNull": ["$read_at", now()]}}}], return_document=True,
    )
    if not doc:
        raise not_found("Notification")
    return NotificationOut.from_mongo(doc)


@router.post("/read-all", response_model=Message)
async def mark_all_read(user: dict = Depends(get_current_user)):
    res = await db.notifications.update_many({"recipient_id": user["_id"], "read": False}, {"$set": {"read": True, "read_at": now()}})
    return Message(message=f"{res.modified_count} notification(s) marked as read")
