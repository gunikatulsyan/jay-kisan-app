"""Products: indexed server-side search (prefix on name/SKU, word-prefix tokens, exact barcode) + keyset pagination."""
import re
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from pymongo.errors import DuplicateKeyError

from .. import config
from ..audit import write_audit
from ..db import db
from ..schemas import InventoryBrief, LookupOut, Page, ProductIn, ProductOut, ProductUpdate, ReasonIn
from ..security import ensure_warehouse_access, get_current_user, is_owner, require_owner
from ..services.stock import effective_min, sync_inventory_snapshot
from ..utils import AppError, jsonable, norm, not_found, now, oid, paginate, prefix_regex, to_dec, tokens

router = APIRouter(prefix="/products", tags=["products"])
PRICE_FIELDS = ("purchase_price", "selling_price")


def _present(user: dict, doc: dict) -> ProductOut:
    p = ProductOut.from_mongo(doc)
    if not is_owner(user):
        p.purchase_price = None
        p.supplier = None
    return p


def search_filter(q: str, base: dict, name_field="name_lc", sku_field="sku_norm", tokens_field="search_tokens") -> dict:
    qn = norm(q)
    words = [w for w in re.split(r"[^a-z0-9]+", qn) if w]
    ors = [{name_field: prefix_regex(qn)}, {sku_field: prefix_regex(q.strip().upper())}]
    if words:
        ors.append({"$and": [{tokens_field: prefix_regex(w)} for w in words[:5]]})
    return {**base, "$or": ors}


async def _attach_stock(user: dict, docs: list, warehouse_id: Optional[str]) -> dict:
    ids = [d["_id"] for d in docs]
    if not ids:
        return {}
    match: dict = {"product_id": {"$in": ids}}
    if warehouse_id:
        wid = oid(warehouse_id, "warehouse_id")
        ensure_warehouse_access(user, wid)
        match["warehouse_id"] = wid
    elif not is_owner(user):
        match["warehouse_id"] = {"$in": user.get("warehouse_ids") or []}
    rows = await db.inventory.aggregate([
        {"$match": match},
        {"$group": {"_id": "$product_id", "total": {"$sum": "$quantity"}, "statuses": {"$addToSet": "$stock_status"}}},
    ]).to_list(len(ids) * 2)
    return {r["_id"]: r for r in rows}


async def _category_ids(category_id: Optional[str]) -> tuple:
    if not category_id:
        return None, []
    cat = await db.categories.find_one({"_id": oid(category_id, "category_id")})
    if not cat:
        raise not_found("Category")
    return cat["_id"], cat.get("ancestors", []) + [cat["_id"]]


@router.get("", response_model=Page[ProductOut])
async def list_products(
    q: Optional[str] = None, category_id: Optional[str] = None, active: Optional[bool] = True, warehouse_id: Optional[str] = None,
    cursor: Optional[str] = None, limit: int = Query(30, ge=1, le=100), user: dict = Depends(get_current_user),
):
    base: dict = {}
    if active is not None:
        base["active"] = active if is_owner(user) else True
    if category_id:
        base["category_ids"] = oid(category_id, "category_id")
    pinned: list = []
    if q and q.strip():
        if config.ATLAS_SEARCH_INDEX and not cursor:
            docs = await db.products.aggregate([
                {"$search": {"index": config.ATLAS_SEARCH_INDEX, "compound": {"should": [
                    {"autocomplete": {"query": q, "path": "name", "fuzzy": {"maxEdits": 1}}},
                    {"text": {"query": q, "path": ["sku", "barcode", "brand"]}},
                ]}}},
                {"$match": base}, {"$limit": limit},
            ]).to_list(limit)
            stock = await _attach_stock(user, docs, warehouse_id)
            return Page[ProductOut](items=[_with_stock(user, d, stock) for d in docs], next_cursor=None)
        if not cursor:
            pinned = await db.products.find({**base, "$or": [{"barcode": q.strip()}, {"sku_norm": q.strip().upper()}]}).to_list(5)
        base = search_filter(q, base)
    docs, nxt = await paginate(db.products, base, sort_field="name_lc", direction=1, cursor=cursor, limit=limit)
    seen = {d["_id"] for d in pinned}
    docs = pinned + [d for d in docs if d["_id"] not in seen]
    stock = await _attach_stock(user, docs, warehouse_id)
    return Page[ProductOut](items=[_with_stock(user, d, stock) for d in docs], next_cursor=nxt)


def _with_stock(user, doc, stock) -> ProductOut:
    p = _present(user, doc)
    s = stock.get(doc["_id"])
    p.stock_total = s["total"] if s else 0
    statuses = set(s["statuses"]) if s else {"out"}
    p.stock_status = "out" if statuses == {"out"} else ("low" if statuses & {"low", "out"} else "ok")
    return p


@router.get("/lookup", response_model=LookupOut, summary="Exact barcode / SKU lookup for scanning")
async def lookup(code: str = Query(min_length=1, max_length=64), warehouse_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    c = code.strip()
    doc = await db.products.find_one({"barcode": c}) or await db.products.find_one({"sku_norm": c.upper()})
    if not doc or (not doc.get("active", True) and not is_owner(user)):
        raise AppError(404, "PRODUCT_NOT_FOUND", f"No product found for code '{c}'")
    out = LookupOut(product=_present(user, doc))
    if warehouse_id:
        wid = oid(warehouse_id, "warehouse_id")
        ensure_warehouse_access(user, wid)
        inv = await db.inventory.find_one({"product_id": doc["_id"], "warehouse_id": wid})
        out.warehouse_id, out.quantity = str(wid), inv["quantity"] if inv else 0
        out.stock_status = inv.get("stock_status") if inv else "out"
    return out


@router.get("/{product_id}", response_model=ProductOut)
async def get_product(product_id: str, user: dict = Depends(get_current_user)):
    doc = await db.products.find_one({"_id": oid(product_id)})
    if not doc or (not doc.get("active", True) and not is_owner(user)):
        raise not_found("Product")
    p = _present(user, doc)
    inv_filter: dict = {"product_id": doc["_id"]}
    if not is_owner(user):
        inv_filter["warehouse_id"] = {"$in": user.get("warehouse_ids") or []}
    rows = await db.inventory.find(inv_filter).to_list(1000)
    wh = {w["_id"]: w["name"] for w in await db.warehouses.find({"_id": {"$in": [r["warehouse_id"] for r in rows]}}).to_list(1000)}
    p.inventory = [InventoryBrief(warehouse_id=r["warehouse_id"], warehouse_name=wh.get(r["warehouse_id"]), quantity=r["quantity"],
                                  min_stock=r.get("min_stock"), effective_min=effective_min(r), stock_status=r.get("stock_status")) for r in rows]
    p.stock_total = sum(r["quantity"] for r in rows)
    return p


def _prepare(data: dict, current: Optional[dict] = None) -> dict:
    if "sku" in data:
        data["sku_norm"] = data["sku"].strip().upper()
    if "name" in data:
        data["name_lc"] = norm(data["name"])
    for f in PRICE_FIELDS:
        if f in data:
            data[f] = to_dec(data[f])
    if "barcode" in data:
        data["barcode"] = data["barcode"] or None
    if "expiry_date" in data and data["expiry_date"] is not None:
        data["expiry_date"] = data["expiry_date"].isoformat()
    merged = {**(current or {}), **data}
    data["search_tokens"] = tokens(merged.get("name"), merged.get("brand"), merged.get("sku"))
    return data


def _dup_error(e: DuplicateKeyError) -> AppError:
    if "barcode" in str(e):
        return AppError(409, "BARCODE_EXISTS", "Another product already uses this barcode")
    return AppError(409, "SKU_EXISTS", "Another product already uses this SKU")


@router.post("", response_model=ProductOut, status_code=201)
async def create_product(body: ProductIn, request: Request, owner: dict = Depends(require_owner)):
    data = _prepare(body.model_dump())
    cat_id, cat_ids = await _category_ids(body.category_id)
    t = now()
    data.update({"category_id": cat_id, "category_ids": cat_ids, "active": True, "created_at": t, "updated_at": t, "created_by": owner["_id"]})
    try:
        data["_id"] = (await db.products.insert_one(data)).inserted_id
    except DuplicateKeyError as e:
        raise _dup_error(e)
    await write_audit(owner, "PRODUCT_CREATE", "product", data["_id"], after=jsonable({k: data.get(k) for k in ("sku", "name", "barcode", "purchase_price", "selling_price", "min_stock")}), request=request)
    return ProductOut.from_mongo(data)


@router.patch("/{product_id}", response_model=ProductOut)
async def update_product(product_id: str, body: ProductUpdate, request: Request, owner: dict = Depends(require_owner)):
    pid = oid(product_id)
    current = await db.products.find_one({"_id": pid})
    if not current:
        raise not_found("Product")
    changes = body.model_dump(exclude_unset=True)
    for req in ("sku", "name", "unit"):
        if req in changes and not changes[req]:
            raise AppError(422, "VALIDATION_ERROR", f"{req} cannot be empty")
    if "min_stock" in changes and changes["min_stock"] is None:
        changes["min_stock"] = 0
    if not changes:
        return ProductOut.from_mongo(current)
    data = _prepare(dict(changes), current)
    if "category_id" in changes:
        data["category_id"], data["category_ids"] = await _category_ids(changes["category_id"])
    data["updated_at"] = now()
    try:
        updated = await db.products.find_one_and_update({"_id": pid}, {"$set": data}, return_document=True)
    except DuplicateKeyError as e:
        raise _dup_error(e)
    await sync_inventory_snapshot(updated)
    before = jsonable({k: current.get(k) for k in changes})
    after = jsonable({k: updated.get(k) for k in changes})
    await write_audit(owner, "PRODUCT_UPDATE", "product", pid, before=before, after=after, request=request)
    return ProductOut.from_mongo(updated)


async def _set_active(product_id: str, active: bool, reason: Optional[str], request: Request, owner: dict) -> ProductOut:
    pid = oid(product_id)
    updated = await db.products.find_one_and_update({"_id": pid}, {"$set": {"active": active, "updated_at": now()}}, return_document=True)
    if not updated:
        raise not_found("Product")
    await sync_inventory_snapshot(updated)
    await write_audit(owner, "PRODUCT_ACTIVATE" if active else "PRODUCT_DEACTIVATE", "product", pid, before={"active": not active}, after={"active": active}, reason=reason, request=request)
    return ProductOut.from_mongo(updated)


@router.post("/{product_id}/deactivate", response_model=ProductOut, summary="Soft-delete (history is always preserved)")
async def deactivate_product(product_id: str, body: ReasonIn, request: Request, owner: dict = Depends(require_owner)):
    return await _set_active(product_id, False, body.reason, request, owner)


@router.post("/{product_id}/activate", response_model=ProductOut)
async def activate_product(product_id: str, request: Request, owner: dict = Depends(require_owner)):
    return await _set_active(product_id, True, None, request, owner)
