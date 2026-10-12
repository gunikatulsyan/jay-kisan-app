"""One-time secure owner bootstrap from environment secrets (no hardcoded defaults)."""
import logging

from . import config
from .audit import write_audit
from .db import db
from .security import check_password_policy, hash_password
from .utils import now

log = logging.getLogger("jaykisan.bootstrap")


async def create_owner(username: str, password: str, full_name: str, must_change: bool) -> dict:
    check_password_policy(password)
    t = now()
    doc = {
        "username": username.strip().lower(),
        "full_name": full_name,
        "role": "owner",
        "phone": None,
        "password_hash": hash_password(password),
        "warehouse_ids": [],
        "active": True,
        "token_version": 0,
        "must_change_password": must_change,
        "created_at": t,
        "updated_at": t,
    }
    res = await db.users.insert_one(doc)
    doc["_id"] = res.inserted_id
    await write_audit(None, "OWNER_BOOTSTRAP", "user", res.inserted_id, after={"username": doc["username"]})
    return doc


async def bootstrap_owner():
    if not (config.BOOTSTRAP_OWNER_USERNAME and config.BOOTSTRAP_OWNER_PASSWORD):
        return
    if await db.users.find_one({"role": "owner"}, {"_id": 1}):
        return
    await create_owner(
        config.BOOTSTRAP_OWNER_USERNAME, config.BOOTSTRAP_OWNER_PASSWORD, config.BOOTSTRAP_OWNER_NAME,
        config.BOOTSTRAP_OWNER_MUST_CHANGE,
    )
    log.warning("Bootstrap owner '%s' created. Remove BOOTSTRAP_OWNER_PASSWORD from the environment now.",
                config.BOOTSTRAP_OWNER_USERNAME)
