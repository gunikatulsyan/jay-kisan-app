"""Dashboard KPIs and sales/profit analytics (server-side aggregation, short TTL cache)."""
from typing import Optional

from bson import Decimal128
from fastapi import APIRouter, Depends, Query

from .. import config
from ..db import db
from ..schemas import InventoryOut, TransactionOut
from ..security import require_owner
from ..services import cache
from ..utils import AppError, day_range, jsonable, oid

router = APIRouter(prefix="/reports", tags=["reports"])


def _f(v):
    if v is None:
        return None
    return float(v.to_decimal()) if isinstance(v, Decimal128) else float(v)


_PRICED = {"$ne": [{"$ifNull": ["$total_amount", None]}, None]}
_PROFIT = {"$ne": [{"$ifNull": ["$profit", None]}, None]}
SALES_ACC = {
    "units": {"$sum": "$sales_qty"},
    "txns": {"$sum": {"$cond": [{"$eq": ["$type", "SALE"]}, 1, 0]}},
    "revenue": {"$sum": "$total_amount"},
    "cost": {"$sum": "$total_cost"},
    "profit": {"$sum": "$profit"},
    "priced_rows": {"$sum": {"$cond": [_PRICED, 1, 0]}},
    "profit_rows": {"$sum": {"$cond": [_PROFIT, 1, 0]}},
    "priced_units": {"$sum": {"$cond": [_PRICED, "$sales_qty", 0]}},
    "profit_units": {"$sum": {"$cond": [_PROFIT, "$sales_qty", 0]}},
}


def sales_row(r: Optional[dict]) -> dict:
    """Revenue/profit are null (unavailable) when no price data exists — never a misleading 0."""
    if not r:
        return {"units": 0, "txns": 0, "revenue": None, "cost": None, "profit": None, "unpriced_units": 0, "profit_unavailable_units": 0}
    return {
        "units": r["units"],
        "txns": r["txns"],
        "revenue": _f(r["revenue"]) if r["priced_rows"] else None,
        "cost": _f(r["cost"]) if r["profit_rows"] else None,
        "profit": _f(r["profit"]) if r["profit_rows"] else None,
        "unpriced_units": r["units"] - r["priced_units"],
        "profit_unavailable_units": r["units"] - r["profit_units"],
    }


def sales_match(start, end, warehouse_id=None, category_id=None, product_id=None, employee_id=None, customer_id=None) -> dict:
    m: dict = {"counts_as_sale": True, "created_at": {"$gte": start, "$lt": end}}
    if warehouse_id:
        m["warehouse_id"] = oid(warehouse_id, "warehouse_id")
    if category_id:
        m["category_ids"] = oid(category_id, "category_id")
    if product_id:
        m["product_id"] = oid(product_id, "product_id")
    if employee_id:
        m["seller_id"] = oid(employee_id, "employee_id")
    if customer_id:
        m["customer_id"] = oid(customer_id, "customer_id")
    return m


async def _sales_total(match: dict) -> dict:
    rows = await db.stock_transactions.aggregate([{"$match": match}, {"$group": {"_id": None, **SALES_ACC}}]).to_list(1)
    return sales_row(rows[0] if rows else None)


GROUPS = {
    "product": ("$product_id", "$product_name"),
    "employee": ({"$ifNull": ["$seller_id", "$user_id"]}, {"$ifNull": ["$seller_name", "$user_name"]}),
    "warehouse": ("$warehouse_id", "$warehouse_name"),
    "customer": ("$customer_id", "$customer_name"),
}


async def sales_report_data(group_by: str, date_from=None, date_to=None, **filters) -> dict:
    start, end = day_range(date_from, date_to, default_days=29)
    match = sales_match(start, end, **filters)
    if group_by == "day":
        key = {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at", "timezone": config.BUSINESS_TZ}}
        label, sort = key, {"_id": 1}
    elif group_by in GROUPS:
        key, label = GROUPS[group_by]
        sort = {"units": -1}
    else:
        raise AppError(422, "INVALID_GROUP", "group_by must be product, employee, warehouse, customer or day")
    rows = await db.stock_transactions.aggregate([
        {"$match": match}, {"$group": {"_id": key, "label": {"$last": label}, **SALES_ACC}}, {"$sort": sort}, {"$limit": 500},
    ]).to_list(500)
    return {
        "group_by": group_by, "from": start.isoformat(), "to": end.isoformat(),
        "rows": [{"key": jsonable(r["_id"]), "label": r.get("label") or ("Walk-in / none" if group_by == "customer" else "—"), **sales_row(r)} for r in rows],
        "totals": await _sales_total(match),
    }


@router.get("/sales", summary="Sales / revenue / profit grouped by product, employee, warehouse, customer or day")
async def sales_report(
    group_by: str = "product", date_from: Optional[str] = Query(None, alias="from"), date_to: Optional[str] = Query(None, alias="to"),
    warehouse_id: Optional[str] = None, category_id: Optional[str] = None, product_id: Optional[str] = None,
    employee_id: Optional[str] = None, customer_id: Optional[str] = None, _owner: dict = Depends(require_owner),
):
    return await sales_report_data(group_by, date_from, date_to, warehouse_id=warehouse_id, category_id=category_id,
                                   product_id=product_id, employee_id=employee_id, customer_id=customer_id)


@router.get("/dashboard", summary="Owner dashboard KPIs")
async def dashboard(
    warehouse_id: Optional[str] = None, category_id: Optional[str] = None, product_id: Optional[str] = None,
    date_from: Optional[str] = Query(None, alias="from"), date_to: Optional[str] = Query(None, alias="to"),
    _owner: dict = Depends(require_owner),
):
    key = ("dash", warehouse_id, category_id, product_id, date_from, date_to)
    hit = cache.get(key)
    if hit:
        return hit
    inv_match: dict = {"product_active": {"$ne": False}}
    wh_match: dict = {}
    if warehouse_id:
        inv_match["warehouse_id"] = wh_match["warehouse_id"] = oid(warehouse_id, "warehouse_id")
    if category_id:
        inv_match["category_ids"] = oid(category_id, "category_id")
    if product_id:
        inv_match["product_id"] = wh_match["product_id"] = oid(product_id, "product_id")
    has_price = {"$ne": [{"$ifNull": ["$purchase_price", None]}, None]}
    positive = {"$gt": ["$quantity", 0]}
    inv_group = {
        "stocked": {"$sum": {"$cond": [positive, 1, 0]}},
        "qty": {"$sum": "$quantity"},
        "value": {"$sum": {"$cond": [{"$and": [positive, has_price]}, {"$multiply": ["$quantity", "$purchase_price"]}, 0]}},
        "unpriced": {"$sum": {"$cond": [{"$and": [positive, {"$not": [has_price]}]}, 1, 0]}},
        "low": {"$sum": {"$cond": [{"$eq": ["$stock_status", "low"]}, 1, 0]}},
        "out": {"$sum": {"$cond": [{"$eq": ["$stock_status", "out"]}, 1, 0]}},
    }
    tot = (await db.inventory.aggregate([{"$match": inv_match}, {"$group": {"_id": None, **inv_group}}]).to_list(1)) or [{}]
    tot = tot[0]
    if warehouse_id or product_id:
        total_products = tot.get("stocked", 0)
    else:
        pf: dict = {"active": True}
        if category_id:
            pf["category_ids"] = inv_match["category_ids"]
        total_products = await db.products.count_documents(pf)

    start, end = day_range(date_from, date_to)
    t_start, t_end = day_range()
    common = dict(warehouse_id=warehouse_id, category_id=category_id, product_id=product_id)
    period = await _sales_total(sales_match(start, end, **common))
    today = period if (start, end) == (t_start, t_end) else await _sales_total(sales_match(t_start, t_end, **common))

    wh_inv_match = {k: v for k, v in inv_match.items() if k != "warehouse_id"}
    wh_rows = await db.inventory.aggregate([{"$match": wh_inv_match}, {"$group": {"_id": "$warehouse_id", **inv_group}}]).to_list(1000)
    names = {w["_id"]: w for w in await db.warehouses.find({"active": True}).to_list(1000)}
    by_wh = {r["_id"]: r for r in wh_rows}
    warehouse_summary = [
        {"warehouse_id": str(wid), "name": w["name"], "code": w["code"], "quantity": by_wh.get(wid, {}).get("qty", 0),
         "low": by_wh.get(wid, {}).get("low", 0), "out": by_wh.get(wid, {}).get("out", 0),
         "value": _f(by_wh[wid]["value"]) if wid in by_wh else 0.0}
        for wid, w in names.items()
    ]
    top = await db.stock_transactions.aggregate([
        {"$match": sales_match(start if date_from else day_range(default_days=29)[0], end, **common)},
        {"$group": {"_id": "$product_id", "label": {"$last": "$product_name"}, "unit": {"$last": "$unit"}, **SALES_ACC}},
        {"$sort": {"units": -1}}, {"$limit": 5},
    ]).to_list(5)
    recent_sales = await db.stock_transactions.find({"type": "SALE", **wh_match}).sort("_id", -1).limit(8).to_list(8)
    recent = await db.stock_transactions.find(wh_match).sort("_id", -1).limit(8).to_list(8)
    slow = await db.inventory.find({**inv_match, "quantity": {"$gt": 0}}).sort("last_sale_at", 1).limit(5).to_list(5)
    low_items = await db.inventory.find({**inv_match, "stock_status": {"$in": ["low", "out"]}}).sort("quantity", 1).limit(8).to_list(8)
    wn = {k: v["name"] for k, v in names.items()}

    result = jsonable({
        "total_products": total_products,
        "total_stock": tot.get("qty", 0),
        "inventory_value": _f(tot.get("value")) if tot else None,
        "unpriced_stock_rows": tot.get("unpriced", 0),
        "low_stock_count": tot.get("low", 0),
        "out_of_stock_count": tot.get("out", 0),
        "today": today,
        "period": {**period, "from": start.isoformat(), "to": end.isoformat()},
        "warehouse_summary": warehouse_summary,
        "top_products": [{"product_id": str(r["_id"]), "name": r["label"], "unit": r.get("unit"), **sales_row(r)} for r in top],
        "recent_sales": [TransactionOut.from_mongo(d).model_dump(mode="json") for d in recent_sales],
        "recent_activity": [TransactionOut.from_mongo(d).model_dump(mode="json") for d in recent],
        "slow_moving": [InventoryOut.from_mongo({**d, "warehouse_name": wn.get(d["warehouse_id"])}).model_dump(mode="json") for d in slow],
        "low_stock_items": [InventoryOut.from_mongo({**d, "warehouse_name": wn.get(d["warehouse_id"])}).model_dump(mode="json") for d in low_items],
    })
    cache.put(key, result)
    return result
