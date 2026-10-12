"""Password hashing, JWT access tokens, rotating refresh tokens, auth dependencies, RBAC and rate limiting."""
import re
import secrets
import time
from collections import defaultdict, deque
from datetime import timedelta
from typing import Optional

import bcrypt
import jwt
from bson import ObjectId
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import config
from .db import db
from .utils import AppError, now, sha256

bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


DUMMY_HASH = hash_password("timing-equaliser-9x")


def check_password_policy(password: str):
    if len(password) < 8 or len(password.encode("utf-8")) > 72:
        raise AppError(422, "WEAK_PASSWORD", "Password must be 8–72 characters long")
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise AppError(422, "WEAK_PASSWORD", "Password must contain both letters and numbers")


def client_ip(request: Request) -> str:
    if config.TRUST_PROXY_HEADERS:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def create_access_token(user: dict):
    iat = now()
    exp = iat + timedelta(minutes=config.ACCESS_TOKEN_MINUTES)
    payload = {
        "sub": str(user["_id"]),
        "role": user["role"],
        "ver": user.get("token_version", 0),
        "jti": secrets.token_urlsafe(16),
        "typ": "access",
        "iat": iat,
        "exp": exp,
        "iss": config.JWT_ISSUER,
        "aud": config.JWT_AUDIENCE,
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm="HS256"), config.ACCESS_TOKEN_MINUTES * 60


def decode_access_token(token: str) -> dict:
    try:
        payload = jwt.decode(
            token,
            config.JWT_SECRET,
            algorithms=["HS256"],
            issuer=config.JWT_ISSUER,
            audience=config.JWT_AUDIENCE,
            options={"require": ["sub", "exp", "iat", "jti", "ver"]},
        )
    except jwt.ExpiredSignatureError:
        raise AppError(401, "TOKEN_EXPIRED", "Your session has expired")
    except jwt.PyJWTError:
        raise AppError(401, "TOKEN_INVALID", "Invalid session")
    if payload.get("typ") != "access":
        raise AppError(401, "TOKEN_INVALID", "Invalid session")
    return payload


async def issue_tokens(user: dict, request: Request) -> dict:
    access, expires_in = create_access_token(user)
    raw = secrets.token_urlsafe(48)
    t = now()
    await db.refresh_tokens.insert_one(
        {
            "user_id": user["_id"],
            "token_hash": sha256(raw),
            "created_at": t,
            "expires_at": t + timedelta(days=config.REFRESH_TOKEN_DAYS),
            "revoked_at": None,
            "ip": client_ip(request),
            "user_agent": (request.headers.get("user-agent") or "")[:200],
        }
    )
    return {"access_token": access, "refresh_token": raw, "token_type": "bearer", "expires_in": expires_in}


async def revoke_all_sessions(user_id: ObjectId):
    await db.refresh_tokens.update_many({"user_id": user_id, "revoked_at": None}, {"$set": {"revoked_at": now()}})


async def load_user_from_token(token: str) -> tuple[dict, dict]:
    payload = decode_access_token(token)
    if await db.revoked_tokens.find_one({"_id": payload["jti"]}, {"_id": 1}):
        raise AppError(401, "TOKEN_REVOKED", "Session has been signed out")
    if not ObjectId.is_valid(payload["sub"]):
        raise AppError(401, "TOKEN_INVALID", "Invalid session")
    user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
    if not user or not user.get("active", False) or user.get("token_version", 0) != payload["ver"]:
        raise AppError(401, "TOKEN_INVALID", "Session is no longer valid")
    return user, payload


async def get_current_user(request: Request, cred: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> dict:
    if not cred or not cred.credentials:
        raise AppError(401, "UNAUTHENTICATED", "Authentication required")
    user, payload = await load_user_from_token(cred.credentials)
    request.state.user = user
    request.state.token = payload
    if user.get("must_change_password") and not request.url.path.startswith("/api/v1/auth/"):
        raise AppError(403, "PASSWORD_CHANGE_REQUIRED", "Please change your password to continue")
    return user


def is_owner(user: dict) -> bool:
    return user.get("role") == "owner"


async def require_owner(user: dict = Depends(get_current_user)) -> dict:
    if not is_owner(user):
        raise AppError(403, "FORBIDDEN", "Owner access required")
    return user


def ensure_warehouse_access(user: dict, warehouse_id: ObjectId):
    if is_owner(user):
        return
    if warehouse_id not in (user.get("warehouse_ids") or []):
        raise AppError(403, "WAREHOUSE_FORBIDDEN", "You are not assigned to this warehouse")


# ---------------- Rate limiting (in-process sliding window) ----------------
# Single-instance limiter. For multiple backend replicas, move this to Redis (documented).
class RateLimiter:
    def __init__(self):
        self.hits: dict[str, deque] = defaultdict(deque)

    def check(self, key: str, limit: int, window: int):
        t = time.monotonic()
        q = self.hits[key]
        while q and q[0] <= t - window:
            q.popleft()
        if len(q) >= limit:
            retry = int(window - (t - q[0])) + 1
            raise AppError(429, "RATE_LIMITED", "Too many requests. Please slow down and try again.", {"retry_after": retry})
        q.append(t)
        if len(self.hits) > 20000:
            for k in [k for k, v in self.hits.items() if not v]:
                self.hits.pop(k, None)


limiter = RateLimiter()


def ip_limit(bucket: str, limit: int, window: int = 60):
    async def dep(request: Request):
        limiter.check(f"{bucket}:{client_ip(request)}", limit, window)

    return dep


def user_limit(bucket: str, limit: int, window: int = 60):
    async def dep(user: dict = Depends(get_current_user)):
        limiter.check(f"{bucket}:{user['_id']}", limit, window)

    return dep
