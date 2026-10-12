"""Immutable transaction ledger: list/detail + dedicated correction endpoint (no UPDATE / DELETE exists)."""
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query, Request

from ..audit import write_audit
from ..db import db
from ..schemas import CorrectionIn, Page, StockResult, TransactionDetail, TransactionOut
from ..security import ensure_warehouse_access, get_current_user, is_owner, require_owner
from ..services.stock import apply_delta, build_txn, inventory_event, low_stock_events, price_fields, run_stock_op, strip_costs, txn_event
from ..utils import AppError, day_range, jsonable, not_found, oid, oid_range, paginate

router = APIRouter(prefix="/transactions", tags=["transactions"])
CORRECTABLE = {"SALE": -1, "STOCK_IN": 1, "STOCK_REMOVAL": -1}


def _out(user, doc) -> TransactionOut:
    t = TransactionOut.from_mongo(doc)
    if not is_owner(user):
        t.unit_cost = t.total_cost = t.profit = None
    return t


@router.get("", response_model=Page[TransactionOut])
async def list_transactions(
    warehouse_id: Optional[str] = None, type: Optional[str] = None, product_id: Optional[str] = None,
    user_id: Optional[str] = None, customer_id: Optional[str] = None, date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"), cursor: Optional[str] = None, limit: int = Query(30, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    filt: dict = {}
    if not is_owner(user):
        filt["user_id"] = user["_id"]  # employees only see their own history
    elif user_id:
        filt["user_id"] = oid(user_id, "user_id")
    if warehouse_id:
        wid = oid(warehouse_id, "warehouse_id")
        ensure_warehouse_access(user, wid)
        filt["warehouse_id"] = wid
    if type:
        types = [t.strip().upper() for t in type.split(",") if t.strip()]
        filt["type"] = {"$in": types}
    if product_id:
        filt["product_id"] = oid(product_id, "product_id")
    if customer_id:
        filt["customer_id"] = oid(customer_id, "customer_id")
    if date_from or date_to:
        start, end = day_range(date_from, date_to)
        filt["_id"] = oid_range(start, end)
    docs, nxt = await paginate(db.stock_transactions, filt, cursor=cursor, limit=limit)
    return Page[TransactionOut](items=[_out(user, d) for d in docs], next_cursor=nxt)


async def _effective(txn: dict, session=None) -> tuple[int, list]:
    corrections = await db.stock_transactions.find({"corrects_txn_id": txn["_id"]}, session=session).sort("_id", 1).to_list(500)
    return txn["quantity_change"] + sum(c["quantity_change"] for c in corrections), corrections


@router.get("/{txn_id}", response_model=TransactionDetail)
async def get_transaction(txn_id: str, user: dict = Depends(get_current_user)):
    txn = await db.stock_transactions.find_one({"_id": oid(txn_id)})
    if not txn or (not is_owner(user) and txn["user_id"] != user["_id"]):
        raise not_found("Transaction")
    effective, corrections = await _effective(txn)
    related = []
    if txn.get("transfer_id"):
        related = await db.stock_transactions.find({"transfer_id": txn["transfer_id"], "_id": {"$ne": txn["_id"]}}).to_list(5)
    if txn.get("corrects_txn_id"):
        orig = await db.stock_transactions.find_one({"_id": txn["corrects_txn_id"]})
        related += [orig] if orig else []
    sign = CORRECTABLE.get(txn["type"])
    return TransactionDetail(
        transaction=_out(user, txn), corrections=[_out(user, c) for c in corrections], related=[_out(user, r) for r in related],
        effective_quantity=abs(effective) if sign else None, correctable=bool(sign) and is_owner(user),
    )


@router.post("/{txn_id}/corrections", response_model=StockResult, summary="Create a linked correction transaction (owner)")
async def correct_transaction(txn_id: str, body: CorrectionIn, request: Request,
                              idem: Optional[str] = Header(default=None, alias="Idempotency-Key"), user: dict = Depends(require_owner)):
    orig = await db.stock_transactions.find_one({"_id": oid(txn_id)})
    if not orig:
        raise not_found("Transaction")
    sign = CORRECTABLE.get(orig["type"])
    if not sign:
        raise AppError(422, "NOT_CORRECTABLE", "Only sales, stock additions and stock removals can be corrected. Use an adjustment or reverse transfer instead.")
    product = await db.products.find_one({"_id": orig["product_id"]})
    warehouse = await db.warehouses.find_one({"_id": orig["warehouse_id"]})
    if not product or not warehouse:
        raise not_found("Product or warehouse")

    async def fn(s):
        effective, _ = await _effective(orig, s)
        target = sign * body.corrected_quantity
        delta = target - effective
        if delta == 0:
            raise AppError(422, "NO_CHANGE", f"The transaction already reflects {body.corrected_quantity} units")
        before, after, inv = await apply_delta(s, product, warehouse["_id"], delta, require_available=True)
        extra = {"corrects_txn_id": orig["_id"], "corrects_txn_no": orig["txn_no"], "original_type": orig["type"],
                 "reason_code": "CORRECTION", "reason_note": body.reason,
                 "customer_id": orig.get("customer_id"), "customer_name": orig.get("customer_name")}
        if orig["type"] == "SALE":
            sold = -delta
            extra.update({"counts_as_sale": True, "sales_qty": sold, "seller_id": orig.get("seller_id", orig["user_id"]), "seller_name": orig.get("seller_name", orig.get("user_name")),
                          **price_fields(sold, orig.get("unit_price"), orig.get("unit_cost"))})
        txn = build_txn(type_="CORRECTION", product=product, warehouse=warehouse, user=user, change=delta, before=before, after=after, **extra)
        txn["_id"] = (await db.stock_transactions.insert_one(txn, session=s)).inserted_id
        events = await low_stock_events(s, inv, before, product, warehouse)
        await write_audit(user, "TRANSACTION_CORRECTION", "stock_transaction", orig["_id"],
                          before={"effective_quantity": abs(effective)}, after={"effective_quantity": body.corrected_quantity, "correction_txn": txn["txn_no"]},
                          reason=body.reason, warehouse_id=warehouse["_id"], request=request, session=s,
                          meta={"original_txn_no": orig["txn_no"], "correction_txn_id": str(txn["_id"])})
        return {"transaction": jsonable(txn), "related": [jsonable(orig)]}, events + [inventory_event(inv), txn_event(txn)]

    result = await run_stock_op(user, idem, f"correct:{txn_id}", body.model_dump(), fn)
    return strip_costs(user, result)
