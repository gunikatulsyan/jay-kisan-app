from fastapi import APIRouter, Depends, Request

from ..audit import write_audit
from ..db import db, get_settings
from ..schemas import SettingsOut, SettingsUpdate
from ..security import get_current_user, require_owner

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=SettingsOut)
async def read_settings(_user: dict = Depends(get_current_user)):
    return SettingsOut(**{k: v for k, v in (await get_settings()).items() if k != "_id"})


@router.patch("", response_model=SettingsOut)
async def update_settings(body: SettingsUpdate, request: Request, owner: dict = Depends(require_owner)):
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    before = await get_settings()
    if changes:
        await db.settings.update_one({"_id": "global"}, {"$set": changes}, upsert=True)
        await write_audit(owner, "SETTINGS_CHANGE", "settings", "global", before={k: before.get(k) for k in changes}, after=changes, request=request)
    return SettingsOut(**{k: v for k, v in (await get_settings()).items() if k != "_id"})
