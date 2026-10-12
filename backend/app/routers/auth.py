from datetime import timedelta
import secrets

from fastapi import APIRouter, Depends, Request

from ..audit import write_audit
from ..db import db
from ..schemas import ChangePasswordIn, LoginIn, LogoutIn, Message, RefreshIn, ResetWithCodeIn, TokenOut, UserOut, WarehouseOut
from ..security import (
    DUMMY_HASH,
    check_password_policy,
    client_ip,
    get_current_user,
    hash_password,
    ip_limit,
    issue_tokens,
    revoke_all_sessions,
    verify_password,
)
from ..utils import AppError, norm, now, sha256

router = APIRouter(prefix="/auth", tags=["auth"])

# (key prefix, max failures in window, lock minutes). Pair lock stops targeted guessing from one IP;
# account-wide lock is short so an attacker cannot lock someone out permanently.
LOCK_RULES = [("pair", 5, 15), ("user", 20, 5), ("ip", 50, 15)]
WINDOW_MIN = 15
GENERIC = "Invalid username or password"


def _keys(ip: str, ident: str):
    return {"pair": f"pair:{ip}|{ident}", "user": f"user:{ident}", "ip": f"ip:{ip}"}


async def _check_locked(ip: str, ident: str):
    keys = list(_keys(ip, ident).values())
    t = now()
    locked = await db.login_attempts.find_one({"_id": {"$in": keys}, "locked_until": {"$gt": t}})
    if locked:
        mins = max(1, int((locked["locked_until"] - t).total_seconds() // 60) + 1)
        raise AppError(429, "TOO_MANY_ATTEMPTS", f"Too many failed attempts. Try again in {mins} minute(s).")


async def _record_failure(ip: str, ident: str):
    t = now()
    keys = _keys(ip, ident)
    for kind, limit, lock_min in LOCK_RULES:
        k = keys[kind]
        doc = await db.login_attempts.find_one({"_id": k})
        if not doc or doc["window_start"] < t - timedelta(minutes=WINDOW_MIN):
            doc = {"_id": k, "count": 0, "window_start": t, "locked_until": None}
        doc["count"] += 1
        if doc["count"] >= limit:
            doc["locked_until"] = t + timedelta(minutes=lock_min)
            doc["count"] = 0
            doc["window_start"] = t
        doc["expires_at"] = t + timedelta(minutes=WINDOW_MIN + lock_min)
        await db.login_attempts.replace_one({"_id": k}, doc, upsert=True)


async def _warehouses_for(user: dict):
    filt = {"active": True} if user["role"] == "owner" else {"_id": {"$in": user.get("warehouse_ids") or []}, "active": True}
    docs = await db.warehouses.find(filt).sort("name", 1).to_list(500)
    return [WarehouseOut.from_mongo(d) for d in docs]


@router.post("/login", response_model=TokenOut, dependencies=[Depends(ip_limit("login", 20))])
async def login(body: LoginIn, request: Request):
    ip, ident = client_ip(request), norm(body.username)
    await _check_locked(ip, ident)
    user = await db.users.find_one({"username": ident})
    ok = verify_password(body.password, user["password_hash"] if user else DUMMY_HASH)
    if not user or not ok or not user.get("active", False):
        await _record_failure(ip, ident)
        await write_audit(user if user else None, "LOGIN_FAILED", "user", user["_id"] if user else None, request=request, meta={"username": ident})
        raise AppError(401, "INVALID_CREDENTIALS", GENERIC)
    await db.login_attempts.delete_many({"_id": {"$in": [f"pair:{ip}|{ident}"]}})
    tokens = await issue_tokens(user, request)
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"last_login_at": now()}})
    await write_audit(user, "LOGIN_SUCCESS", "user", user["_id"], request=request)
    return TokenOut(**tokens, user=UserOut.from_mongo(user))


@router.post("/refresh", response_model=TokenOut, dependencies=[Depends(ip_limit("refresh", 60))])
async def refresh(body: RefreshIn, request: Request):
    h = sha256(body.refresh_token)
    t = now()
    doc = await db.refresh_tokens.find_one_and_update(
        {"token_hash": h, "revoked_at": None, "expires_at": {"$gt": t}}, {"$set": {"revoked_at": t}}
    )
    if not doc:
        reused = await db.refresh_tokens.find_one({"token_hash": h})
        if reused and reused.get("revoked_at"):
            await revoke_all_sessions(reused["user_id"])  # token theft signal: kill the whole family
            await write_audit({"_id": reused["user_id"], "role": None}, "REFRESH_TOKEN_REUSE", "user", reused["user_id"], request=request)
        raise AppError(401, "SESSION_EXPIRED", "Your session has expired. Please sign in again.")
    user = await db.users.find_one({"_id": doc["user_id"]})
    if not user or not user.get("active", False):
        raise AppError(401, "SESSION_EXPIRED", "Your session has expired. Please sign in again.")
    tokens = await issue_tokens(user, request)
    return TokenOut(**tokens, user=UserOut.from_mongo(user))


@router.post("/logout", response_model=Message)
async def logout(body: LogoutIn, request: Request, user: dict = Depends(get_current_user)):
    payload = request.state.token
    from datetime import datetime, timezone

    await db.revoked_tokens.update_one(
        {"_id": payload["jti"]},
        {"$set": {"expires_at": datetime.fromtimestamp(payload["exp"], tz=timezone.utc)}}, upsert=True,
    )
    if body.refresh_token:
        await db.refresh_tokens.update_one({"token_hash": sha256(body.refresh_token), "user_id": user["_id"]}, {"$set": {"revoked_at": now()}})
    await write_audit(user, "LOGOUT", "user", user["_id"], request=request)
    return Message(message="Signed out")


@router.post("/logout-all", response_model=Message)
async def logout_all(request: Request, user: dict = Depends(get_current_user)):
    await db.users.update_one({"_id": user["_id"]}, {"$inc": {"token_version": 1}})
    await revoke_all_sessions(user["_id"])
    await write_audit(user, "LOGOUT_ALL_DEVICES", "user", user["_id"], request=request)
    return Message(message="Signed out from all devices")


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user": UserOut.from_mongo(user).model_dump(mode="json"),
            "warehouses": [w.model_dump(mode="json") for w in await _warehouses_for(user)]}


@router.post("/change-password", response_model=TokenOut, dependencies=[Depends(ip_limit("pwchange", 10))])
async def change_password(body: ChangePasswordIn, request: Request, user: dict = Depends(get_current_user)):
    if not verify_password(body.current_password, user["password_hash"]):
        raise AppError(400, "WRONG_PASSWORD", "Current password is incorrect")
    if body.current_password == body.new_password:
        raise AppError(422, "SAME_PASSWORD", "New password must be different from the current password")
    check_password_policy(body.new_password)
    updated = await db.users.find_one_and_update(
        {"_id": user["_id"]},
        {"$set": {"password_hash": hash_password(body.new_password), "must_change_password": False, "updated_at": now()}, "$inc": {"token_version": 1}},
        return_document=True,
    )
    await revoke_all_sessions(user["_id"])
    await write_audit(user, "PASSWORD_CHANGED", "user", user["_id"], request=request)
    tokens = await issue_tokens(updated, request)
    return TokenOut(**tokens, user=UserOut.from_mongo(updated))


@router.post("/reset-password", response_model=Message, dependencies=[Depends(ip_limit("pwreset", 10))])
async def reset_password(body: ResetWithCodeIn, request: Request):
    """Reset with a one-time code generated by the owner (expires in 30 minutes, single use)."""
    ip, ident = client_ip(request), norm(body.username)
    await _check_locked(ip, ident)
    user = await db.users.find_one({"username": ident, "active": True})
    code = body.code.strip().upper()
    match = None
    if user:
        for rc in await db.reset_codes.find({"user_id": user["_id"], "used": False, "expires_at": {"$gt": now()}}).to_list(10):
            if verify_password(code, rc["code_hash"]):
                match = rc
                break
    else:
        verify_password(code, DUMMY_HASH)
    if not match:
        await _record_failure(ip, ident)
        raise AppError(400, "INVALID_RESET", "Invalid username or reset code")
    check_password_policy(body.new_password)
    consumed = await db.reset_codes.update_one({"_id": match["_id"], "used": False}, {"$set": {"used": True, "used_at": now()}})
    if not consumed.modified_count:
        raise AppError(400, "INVALID_RESET", "Invalid username or reset code")
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"password_hash": hash_password(body.new_password), "must_change_password": False, "updated_at": now()}, "$inc": {"token_version": 1}},
    )
    await revoke_all_sessions(user["_id"])
    await write_audit(user, "PASSWORD_RESET_WITH_CODE", "user", user["_id"], request=request)
    return Message(message="Password updated. You can now sign in.")


def new_reset_code() -> str:
    alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
    return "".join(secrets.choice(alphabet) for _ in range(8))
