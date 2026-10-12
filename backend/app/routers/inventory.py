from typing import Optional

from fastapi import APIRouter, Depends, Query, Request

from ..audit import write_audit
from ..db import db
from ..schemas import InventoryOut, Page, ThresholdIn
from ..security import ensure_warehouse_access, get_current_user, is_owner, require_owner
from ..services import cache
from ..services.stock import STATUS_STAGE, product_snapshot
from ..utils import AppError, lit, not_found, now, oid, paginate
from .products import search_filter

router = APIRouter(prefix="/inventory", tags=["inventory"])


async def _names(docs):
    ids = list({d["warehouse_id"] for d in docs})
    return {w["_id"]: w["name"] for w in await db.warehouses.find({"_id": {"$in": ids}}, {"name": 1}).to_list(len(ids) + 1)}


@router.get("", response_model=Page[InventoryOut], summary="Per-warehouse stock (server-side filter/sort/paginate)")
async def list_inventory(
    warehouse_id: Optional[str] = None, q: Optional[str] = None, status: Optional[str] = None, category_id: Optional[str] = None,
    sort: str = Query("name", pattern="^(name|quantity)$"), cursor: Optional[str] = None, limit: int = Query(30, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    filt: dict = {"product_active": {"$ne": False}}
    if warehouse_id:
        wid = oid(warehouse_id, "warehouse_id")
        ensure_warehouse_access(user, wid)
        filt["warehouse_id"] = wid
    elif not is_owner(user):
        raise AppError(422, "WAREHOUSE_REQUIRED", "Select a warehouse")
    if status:
        statuses = [s for s in status.split(",") if s in ("ok", "low", "out")]
        filt["stock_status"] = {"$in": statuses}
    if category_id:
        filt["category_ids"] = oid(category_id, "category_id")
    if q and q.strip():
        filt = search_filter(q, filt, name_field="product_name_lc")
    sort_field, direction = ("product_name_lc", 1) if sort == "name" else ("quantity", 1)
    docs, nxt = await paginate(db.inventory, filt, sort_field=sort_field, direction=direction, cursor=cursor, limit=limit)
    names = await _names(docs)
    items = []
    for d in docs:
        item = InventoryOut.from_mongo({**d, "warehouse_name": names.get(d["warehouse_id"])})
        if not is_owner(user):
            item.purchase_price = None
        items.append(item)
    return Page[InventoryOut](items=items, next_cursor=nxt)


@router.put("/threshold", response_model=InventoryOut, summary="Set a warehouse-specific low-stock threshold (null = product default)")
async def set_threshold(body: ThresholdIn, request: Request, owner: dict = Depends(require_owner)):
    pid, wid = oid(body.product_id, "product_id"), oid(body.warehouse_id, "warehouse_id")
    product = await db.products.find_one({"_id": pid})
    if not product or not await db.warehouses.find_one({"_id": wid}, {"_id": 1}):
        raise not_found("Product or warehouse")
    before = await db.inventory.find_one({"product_id": pid, "warehouse_id": wid}, {"min_stock": 1})
    t = now()
    s = {k: lit(v) for k, v in product_snapshot(product).items()}
    s.update({"min_stock": lit(body.min_stock), "quantity": {"$ifNull": ["$quantity", 0]}, "updated_at": lit(t), "created_at": {"$ifNull": ["$created_at", lit(t)]}})
    doc = await db.inventory.find_one_and_update({"product_id": pid, "warehouse_id": wid}, [{"$set": s}, STATUS_STAGE], upsert=True, return_document=True)
    cache.clear()
    await write_audit(owner, "THRESHOLD_CHANGE", "inventory", doc["_id"], before={"min_stock": before.get("min_stock") if before else None},
                      after={"min_stock": body.min_stock}, warehouse_id=wid, request=request, meta={"product_id": str(pid)})
    return InventoryOut.from_mongo(doc)
