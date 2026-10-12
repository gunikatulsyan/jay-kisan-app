from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from pymongo.errors import DuplicateKeyError

from ..audit import write_audit
from ..db import db
from ..schemas import Message, ResetCodeOut, TempPasswordIn, UserCreate, UserOut, UserUpdate
from ..security import check_password_policy, hash_password, require_owner, revoke_all_sessions
from ..utils import AppError, not_found, now, oid, prefix_regex, norm
from .auth import new_reset_code

router = APIRouter(prefix="/users", tags=["users"])


async def _validate_warehouses(ids: list) -> list:
    oids = [oid(w, "warehouse_id") for w in dict.fromkeys(ids)]
    if oids and await db.warehouses.count_documents({"_id": {"$in": oids}}) != len(oids):
        raise AppError(422, "INVALID_WAREHOUSE", "One or more warehouses do not exist")
    return oids


@router.get("", response_model=list[UserOut])
async def list_users(role: Optional[str] = None, q: Optional[str] = None, include_inactive: bool = True,
                     limit: int = Query(200, ge=1, le=500), _owner: dict = Depends(require_owner)):
    filt: dict = {}
    if role:
        filt["role"] = role
    if not include_inactive:
        filt["active"] = True
    if q:
        filt["username"] = prefix_regex(norm(q))
    docs = await db.users.find(filt).sort("username", 1).to_list(limit)
    return [UserOut.from_mongo(d) for d in docs]


@router.post("", response_model=UserOut, status_code=201)
async def create_user(body: UserCreate, request: Request, owner: dict = Depends(require_owner)):
    check_password_policy(body.password)
    wids = await _validate_warehouses(body.warehouse_ids)
    if body.role == "employee" and not wids:
        raise AppError(422, "WAREHOUSE_REQUIRED", "Assign at least one warehouse to the employee")
    t = now()
    doc = {"username": norm(body.username), "full_name": body.full_name, "phone": body.phone, "role": body.role,
           "password_hash": hash_password(body.password), "warehouse_ids": wids if body.role == "employee" else [],
           "active": True, "token_version": 0, "must_change_password": True, "created_at": t, "updated_at": t, "created_by": owner["_id"]}
    try:
        doc["_id"] = (await db.users.insert_one(doc)).inserted_id
    except DuplicateKeyError:
        raise AppError(409, "USERNAME_TAKEN", "This Employee ID / username is already in use")
    await write_audit(owner, "EMPLOYEE_CREATE" if body.role == "employee" else "OWNER_CREATE", "user", doc["_id"], request=request,
                      after={"username": doc["username"], "role": doc["role"], "warehouse_ids": [str(w) for w in wids]})
    return UserOut.from_mongo(doc)


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(user_id: str, body: UserUpdate, request: Request, owner: dict = Depends(require_owner)):
    uid = oid(user_id)
    user = await db.users.find_one({"_id": uid})
    if not user:
        raise not_found("User")
    changes = body.model_dump(exclude_unset=True)
    if uid == owner["_id"] and (changes.get("active") is False or changes.get("role") == "employee"):
        raise AppError(422, "SELF_LOCKOUT", "You cannot deactivate or demote your own account")
    if "warehouse_ids" in changes:
        changes["warehouse_ids"] = await _validate_warehouses(changes["warehouse_ids"] or [])
    role = changes.get("role", user["role"])
    if role == "employee" and not changes.get("warehouse_ids", user.get("warehouse_ids")):
        raise AppError(422, "WAREHOUSE_REQUIRED", "Assign at least one warehouse to the employee")
    if not changes:
        return UserOut.from_mongo(user)
    changes["updated_at"] = now()
    security_change = any(k in changes for k in ("role", "warehouse_ids", "active"))
    update = {"$set": changes}
    if changes.get("active") is False or "role" in changes:
        update["$inc"] = {"token_version": 1}
    updated = await db.users.find_one_and_update({"_id": uid}, update, return_document=True)
    if "$inc" in update:
        await revoke_all_sessions(uid)
    before = {k: user.get(k) for k in changes if k != "updated_at"}
    after = {k: changes[k] for k in changes if k != "updated_at"}
    await write_audit(owner, "PERMISSION_CHANGE" if security_change else "EMPLOYEE_UPDATE", "user", uid, before=before, after=after, request=request)
    return UserOut.from_mongo(updated)


@router.post("/{user_id}/set-password", response_model=Message)
async def set_temp_password(user_id: str, body: TempPasswordIn, request: Request, owner: dict = Depends(require_owner)):
    uid = oid(user_id)
    check_password_policy(body.password)
    res = await db.users.update_one({"_id": uid}, {"$set": {"password_hash": hash_password(body.password), "must_change_password": True, "updated_at": now()}, "$inc": {"token_version": 1}})
    if not res.matched_count:
        raise not_found("User")
    await revoke_all_sessions(uid)
    await write_audit(owner, "PASSWORD_RESET_BY_OWNER", "user", uid, request=request)
    return Message(message="Temporary password set. The user must change it at next sign-in.")


@router.post("/{user_id}/reset-code", response_model=ResetCodeOut)
async def create_reset_code(user_id: str, request: Request, owner: dict = Depends(require_owner)):
    uid = oid(user_id)
    if not await db.users.find_one({"_id": uid, "active": True}, {"_id": 1}):
        raise not_found("User")
    code = new_reset_code()
    expires = now() + timedelta(minutes=30)
    await db.reset_codes.update_many({"user_id": uid, "used": False}, {"$set": {"used": True}})
    await db.reset_codes.insert_one({"user_id": uid, "code_hash": hash_password(code), "used": False, "created_at": now(), "expires_at": expires, "created_by": owner["_id"]})
    await write_audit(owner, "RESET_CODE_ISSUED", "user", uid, request=request)
    return ResetCodeOut(code=code, expires_at=expires)
