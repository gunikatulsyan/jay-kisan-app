"""Core stock engine: atomic conditional inventory updates, immutable transactions, idempotency,
notifications and post-commit real-time events."""
import json
from datetime import timedelta

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..db import db, run_atomic
from ..push import dispatch_pushes
from ..realtime import manager
from ..security import ensure_warehouse_access
from ..utils import AppError, dec_val, gen_code, jsonable, lit, not_found, now, oid, sha256, to_dec
from . import cache

REMOVAL_REASONS = {
    "DAMAGED": "Damaged stock",
    "EXPIRED": "Expired stock",
    "COUNT_DISCREPANCY": "Physical count discrepancy",
    "LOST": "Lost stock",
    "RETURNED_TO_SUPPLIER": "Returned to supplier",
    "OTHER": "Other",
}
ADJUST_REASONS = {
    "COUNT_DISCREPANCY": "Physical count discrepancy",
    "DAMAGED": "Damaged stock",
    "EXPIRED": "Expired stock",
    "LOST": "Lost stock",
    "FOUND": "Found stock",
    "DATA_ENTRY_ERROR": "Data entry error",
    "OTHER": "Other",
}

EFFECTIVE_MIN = {"$ifNull": ["$min_stock", {"$ifNull": ["$product_min_stock", 0]}]}
STATUS_STAGE = {
    "$set": {
        "stock_status": {
            "$switch": {
                "branches": [
                    {"case": {"$lte": ["$quantity", 0]}, "then": "out"},
                    {"case": {"$lt": ["$quantity", EFFECTIVE_MIN]}, "then": "low"},
                ],
                "default": "ok",
            }
        }
    }
}


def effective_min(inv: dict) -> int:
    m = inv.get("min_stock")
    return m if m is not None else (inv.get("product_min_stock") or 0)


def status_of(qty: int, eff_min: int) -> str:
    return "out" if qty <= 0 else ("low" if qty < eff_min else "ok")


def product_snapshot(p: dict) -> dict:
    return {
        "product_name": p["name"],
        "product_name_lc": p["name_lc"],
        "sku": p["sku"],
        "sku_norm": p["sku_norm"],
        "barcode": p.get("barcode"),
        "unit": p.get("unit"),
        "category_ids": p.get("category_ids", []),
        "search_tokens": p.get("search_tokens", []),
        "product_min_stock": p.get("min_stock", 0),
        "purchase_price": p.get("purchase_price"),
        "selling_price": p.get("selling_price"),
        "product_active": p.get("active", True),
    }


async def sync_inventory_snapshot(product: dict, session=None):
    """Refresh denormalised product fields on all inventory rows of a product (bounded by #warehouses)."""
    s = {k: lit(v) for k, v in product_snapshot(product).items()}
    await db.inventory.update_many({"product_id": product["_id"]}, [{"$set": s}, STATUS_STAGE], session=session)


async def apply_delta(session, product: dict, warehouse_id, delta: int, *, require_available=True, expected=None, extra=None):
    """Atomically change quantity in ONE conditional update (check + write are the same operation).
    Returns (before, after, inventory_doc)."""
    filt = {"product_id": product["_id"], "warehouse_id": warehouse_id}
    upsert = False
    if expected is not None:
        filt["quantity"] = expected
        upsert = expected == 0
    elif delta < 0 and require_available:
        filt["quantity"] = {"$gte": -delta}
    else:
        upsert = True
    t = now()
    s = {k: lit(v) for k, v in product_snapshot(product).items()}
    s.update(
        {
            "quantity": {"$add": [{"$ifNull": ["$quantity", 0]}, delta]},
            "updated_at": lit(t),
            "created_at": {"$ifNull": ["$created_at", lit(t)]},
        }
    )
    for k, v in (extra or {}).items():
        s[k] = lit(v)
    pipeline = [{"$set": s}, STATUS_STAGE]
    doc = None
    for attempt in range(2):
        try:
            doc = await db.inventory.find_one_and_update(
                filt, pipeline, upsert=upsert, return_document=ReturnDocument.AFTER, session=session
            )
            break
        except DuplicateKeyError:
            if session is None and expected is None and attempt == 0:
                continue
            raise AppError(409, "CONCURRENT_UPDATE", "Stock was changed at the same moment. Please refresh and retry.")
    if doc is None:
        cur = await db.inventory.find_one({"product_id": product["_id"], "warehouse_id": warehouse_id}, {"quantity": 1}, session=session)
        available = cur["quantity"] if cur else 0
        if expected is not None:
            raise AppError(409, "STOCK_CHANGED", f"Stock changed since it was counted. Current system quantity is {available}.", {"available": available})
        raise AppError(409, "INSUFFICIENT_STOCK", f"Insufficient stock — only {available} available", {"available": available})
    after = doc["quantity"]
    return after - delta, after, doc


def price_fields(qty: int, unit_price, unit_cost) -> dict:
    up, uc = dec_val(unit_price), dec_val(unit_cost)
    total = up * qty if up is not None else None
    tcost = uc * qty if uc is not None else None
    profit = total - tcost if (total is not None and tcost is not None) else None
    return {"unit_price": to_dec(up), "unit_cost": to_dec(uc), "total_amount": to_dec(total), "total_cost": to_dec(tcost), "profit": to_dec(profit)}


def build_txn(*, type_, product, warehouse, user, change, before, after, **extra) -> dict:
    doc = {
        "txn_no": gen_code("TX"),
        "type": type_,
        "product_id": product["_id"],
        "product_name": product["name"],
        "sku": product["sku"],
        "unit": product.get("unit"),
        "category_ids": product.get("category_ids", []),
        "warehouse_id": warehouse["_id"],
        "warehouse_name": warehouse["name"],
        "quantity_change": change,
        "quantity_before": before,
        "quantity_after": after,
        "user_id": user["_id"],
        "user_name": user.get("full_name") or user["username"],
        "user_role": user["role"],
        "counts_as_sale": False,
        "created_at": now(),
    }
    doc.update(extra)
    return doc


def inventory_event(inv: dict) -> dict:
    return {
        "scope": "warehouse",
        "warehouse_id": str(inv["warehouse_id"]),
        "payload": {
            "type": "inventory",
            "data": {"product_id": str(inv["product_id"]), "warehouse_id": str(inv["warehouse_id"]), "quantity": inv["quantity"], "stock_status": inv.get("stock_status")},
        },
    }


def txn_event(txn: dict) -> dict:
    return {"scope": "owners", "payload": {"type": "transaction", "data": jsonable(txn)}}


async def notify_owners(session, *, ntype, title, message, meta=None, txn=None, product=None, warehouse=None, exclude=None) -> list:
    owners = await db.users.find({"role": "owner", "active": True}, {"_id": 1}, session=session).to_list(100)
    docs = []
    for o in owners:
        if exclude is not None and o["_id"] == exclude:
            continue
        docs.append(
            {
                "recipient_id": o["_id"],
                "type": ntype,
                "title": title,
                "message": message,
                "transaction_id": txn["_id"] if txn else None,
                "product_id": product["_id"] if product else None,
                "warehouse_id": warehouse["_id"] if warehouse else None,
                "meta": meta or {},
                "read": False,
                "read_at": None,
                "created_at": now(),
            }
        )
    if docs:
        await db.notifications.insert_many(docs, session=session)
    return [{"scope": "user", "user_id": str(d["recipient_id"]), "payload": {"type": "notification", "data": jsonable(d)}} for d in docs]


async def low_stock_events(session, inv: dict, before: int, product: dict, warehouse: dict) -> list:
    m = effective_min(inv)
    prev, cur = status_of(before, m), inv.get("stock_status")
    if cur == prev or cur not in ("low", "out"):
        return []
    title = "Out of stock" if cur == "out" else "Low stock"
    msg = f"{product['name']} at {warehouse['name']}: {inv['quantity']} {product.get('unit') or ''} left (minimum {m})".replace("  ", " ")
    return await notify_owners(
        session, ntype="OUT_OF_STOCK" if cur == "out" else "LOW_STOCK", title=title, message=msg,
        meta={"quantity": inv["quantity"], "minimum": m, "warehouse_name": warehouse["name"], "product_name": product["name"]},
        product=product, warehouse=warehouse,
    )


async def load_product_warehouse(user, product_id, warehouse_id, *, require_active=True):
    pid, wid = oid(product_id, "product_id"), oid(warehouse_id, "warehouse_id")
    if user is not None:
        ensure_warehouse_access(user, wid)
    product = await db.products.find_one({"_id": pid})
    if not product:
        raise not_found("Product")
    if require_active and not product.get("active", True):
        raise AppError(422, "PRODUCT_INACTIVE", "This product is inactive")
    warehouse = await db.warehouses.find_one({"_id": wid})
    if not warehouse:
        raise not_found("Warehouse")
    if not warehouse.get("active", True):
        raise AppError(422, "WAREHOUSE_INACTIVE", "This warehouse is inactive")
    return product, warehouse


def strip_costs(user: dict, data: dict) -> dict:
    """Employees never see cost/profit information."""
    if user.get("role") == "owner":
        return data

    def clean(t):
        if isinstance(t, dict):
            return {**t, "unit_cost": None, "total_cost": None, "profit": None}
        return t

    out = dict(data)
    if "transaction" in out:
        out["transaction"] = clean(out["transaction"])
    if "related" in out:
        out["related"] = [clean(t) for t in out["related"]]
    return out


async def run_stock_op(user: dict, key, endpoint: str, payload: dict, fn):
    """Idempotent stock operation with safe handling of existing request keys."""
    if not key or not (8 <= len(key) <= 128):
        raise AppError(
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "A unique Idempotency-Key header (8-128 chars) is required for stock changes",
        )

    request_hash = sha256(json.dumps(jsonable(payload), sort_keys=True))
    kid = f"{user['_id']}:{key}"
    acquired = False

    for _ in range(3):
        created_at = now()
        try:
            await db.idempotency_keys.insert_one({
                "_id": kid,
                "user_id": user["_id"],
                "endpoint": endpoint,
                "request_hash": request_hash,
                "status": "processing",
                "created_at": created_at,
                "expires_at": created_at + timedelta(days=7),
            })
            acquired = True
            break
        except DuplicateKeyError:
            existing = await db.idempotency_keys.find_one({"_id": kid})
            if existing is None:
                continue
            if (
                existing.get("request_hash") != request_hash
                or existing.get("endpoint") != endpoint
            ):
                raise AppError(
                    422,
                    "IDEMPOTENCY_KEY_REUSED",
                    "This request key was already used for a different operation",
                )
            if existing.get("status") == "completed":
                return {**existing["response"], "idempotent_replay": True}
            raise AppError(
                409,
                "REQUEST_IN_PROGRESS",
                "This request is already processing or needs recovery. "
                "Do not retry with a new key until its outcome is confirmed.",
            )

    if not acquired:
        raise AppError(
            409,
            "IDEMPOTENCY_RECORD_UNAVAILABLE",
            "Could not establish an idempotency record. Retry with the same key.",
        )

    async def inner(session):
        response, events = await fn(session)
        result = await db.idempotency_keys.update_one(
            {
                "_id": kid,
                "status": "processing",
                "request_hash": request_hash,
                "endpoint": endpoint,
            },
            {
                "$set": {
                    "status": "completed",
                    "response": response,
                    "completed_at": now(),
                }
            },
            session=session,
        )
        if result.matched_count != 1:
            raise AppError(
                500,
                "IDEMPOTENCY_COMPLETION_FAILED",
                "Could not safely complete the stock operation.",
            )
        return response, events

    try:
        response, events = await run_atomic(inner)
    except Exception:
        await db.idempotency_keys.delete_one({
            "_id": kid,
            "status": "processing",
            "request_hash": request_hash,
            "endpoint": endpoint,
        })
        raise

    cache.clear()
    await manager.emit(events)
    dispatch_pushes(events)
    return response
