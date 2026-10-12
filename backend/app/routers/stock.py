"""Stock-changing endpoints. Every call requires an Idempotency-Key header and runs atomically."""
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, Header, Request

from ..audit import write_audit
from ..db import db, get_settings
from ..schemas import SaleIn, StockAdjustIn, StockInIn, StockRemoveIn, StockResult, TransferIn
from ..security import get_current_user, require_owner, user_limit
from ..services.stock import (
    ADJUST_REASONS,
    REMOVAL_REASONS,
    apply_delta,
    build_txn,
    inventory_event,
    load_product_warehouse,
    low_stock_events,
    notify_owners,
    price_fields,
    run_stock_op,
    strip_costs,
    txn_event,
)
from ..utils import AppError, gen_code, jsonable, not_found, now, oid

router = APIRouter(prefix="/stock", tags=["stock"])
IdemKey = Header(default=None, alias="Idempotency-Key")


def _reason_text(codes: dict, code: str, note: Optional[str]) -> str:
    if code == "OTHER":
        if not note or len(note.strip()) < 3:
            raise AppError(422, "REASON_REQUIRED", "Please describe the reason when 'Other' is selected")
        return note.strip()
    return codes[code] + (f" — {note.strip()}" if note and note.strip() else "")


@router.post("/sale", response_model=StockResult, summary="Sell / deduct stock (employee or owner)")
async def sale(body: SaleIn, request: Request, idem: Optional[str] = IdemKey,
               user: dict = Depends(get_current_user), _rl=Depends(user_limit("sale", 60))):
    product, warehouse = await load_product_warehouse(user, body.product_id, body.warehouse_id)
    settings = await get_settings()
    customer = None
    if body.customer_id:
        customer = await db.customers.find_one({"_id": oid(body.customer_id, "customer_id")})
        if not customer or not customer.get("active", True):
            raise AppError(422, "CUSTOMER_INVALID", "Selected customer does not exist or is inactive")
    elif settings.get("require_customer_for_sale", True):
        raise AppError(422, "CUSTOMER_REQUIRED", "Please select or create the customer this was sold to")
    allow_negative = settings.get("allow_negative_stock", False)
    q = body.quantity

    async def fn(s):
        before, after, inv = await apply_delta(s, product, warehouse["_id"], -q, require_available=not allow_negative, extra={"last_sale_at": now()})
        txn = build_txn(
            type_="SALE", product=product, warehouse=warehouse, user=user, change=-q, before=before, after=after,
            customer_id=customer["_id"] if customer else None, customer_name=customer["name"] if customer else None,
            counts_as_sale=True, sales_qty=q, seller_id=user["_id"], seller_name=user.get("full_name") or user["username"], note=body.note, **price_fields(q, body.unit_price, product.get("purchase_price")),
        )
        res = await db.stock_transactions.insert_one(txn, session=s)
        txn["_id"] = res.inserted_id
        sold_to = customer["name"] if customer else "—"
        events = await notify_owners(
            s, ntype="SALE", title="New stock deduction",
            message=f"{txn['user_name']} deducted {q} × {product['name']}",
            meta={"employee": txn["user_name"], "quantity": q, "product_name": product["name"], "warehouse_name": warehouse["name"], "sold_to": sold_to, "previous": before, "new": after, "txn_no": txn["txn_no"]},
            txn=txn, product=product, warehouse=warehouse, exclude=user["_id"],
        )
        events += await low_stock_events(s, inv, before, product, warehouse)
        await write_audit(user, "STOCK_DEDUCTION", "stock_transaction", txn["_id"], before={"quantity": before}, after={"quantity": after, "customer": sold_to},
                          warehouse_id=warehouse["_id"], request=request, session=s, meta={"product_id": str(product["_id"]), "txn_no": txn["txn_no"]})
        events += [inventory_event(inv), txn_event(txn)]
        return {"transaction": jsonable(txn), "related": []}, events

    result = await run_stock_op(user, idem, "sale", body.model_dump(), fn)
    return strip_costs(user, result)


@router.post("/in", response_model=StockResult, summary="Add stock (owner)")
async def stock_in(body: StockInIn, request: Request, idem: Optional[str] = IdemKey, user: dict = Depends(require_owner)):
    product, warehouse = await load_product_warehouse(user, body.product_id, body.warehouse_id)
    q = body.quantity
    unit_cost = body.unit_cost if body.unit_cost is not None else product.get("purchase_price")

    async def fn(s):
        before, after, inv = await apply_delta(s, product, warehouse["_id"], q)
        pf = price_fields(q, None, unit_cost)
        txn = build_txn(type_="STOCK_IN", product=product, warehouse=warehouse, user=user, change=q, before=before, after=after,
                        note=body.note, batch_no=body.batch_no, unit_cost=pf["unit_cost"], total_cost=pf["total_cost"])
        txn["_id"] = (await db.stock_transactions.insert_one(txn, session=s)).inserted_id
        await write_audit(user, "STOCK_ADDITION", "stock_transaction", txn["_id"], before={"quantity": before}, after={"quantity": after},
                          warehouse_id=warehouse["_id"], request=request, session=s, meta={"product_id": str(product["_id"]), "txn_no": txn["txn_no"]})
        return {"transaction": jsonable(txn), "related": []}, [inventory_event(inv), txn_event(txn)]

    return await run_stock_op(user, idem, "stock_in", body.model_dump(), fn)


@router.post("/remove", response_model=StockResult, summary="Remove stock with mandatory reason (owner)")
async def stock_remove(body: StockRemoveIn, request: Request, idem: Optional[str] = IdemKey, user: dict = Depends(require_owner)):
    if not body.confirm:
        raise AppError(422, "CONFIRMATION_REQUIRED", "Please confirm this stock removal")
    reason = _reason_text(REMOVAL_REASONS, body.reason_code, body.reason_note)
    product, warehouse = await load_product_warehouse(user, body.product_id, body.warehouse_id, require_active=False)
    q = body.quantity

    async def fn(s):
        before, after, inv = await apply_delta(s, product, warehouse["_id"], -q)
        txn = build_txn(type_="STOCK_REMOVAL", product=product, warehouse=warehouse, user=user, change=-q, before=before, after=after,
                        reason_code=body.reason_code, reason_note=reason, **price_fields(q, None, product.get("purchase_price")))
        txn["unit_price"] = txn["total_amount"] = txn["profit"] = None
        txn["_id"] = (await db.stock_transactions.insert_one(txn, session=s)).inserted_id
        events = await low_stock_events(s, inv, before, product, warehouse)
        await write_audit(user, "STOCK_REMOVAL", "stock_transaction", txn["_id"], before={"quantity": before}, after={"quantity": after},
                          reason=reason, warehouse_id=warehouse["_id"], request=request, session=s, meta={"product_id": str(product["_id"]), "txn_no": txn["txn_no"]})
        return {"transaction": jsonable(txn), "related": []}, events + [inventory_event(inv), txn_event(txn)]

    return await run_stock_op(user, idem, "stock_remove", body.model_dump(), fn)


@router.post("/adjust", response_model=StockResult, summary="Physical count adjustment (owner, optimistic concurrency)")
async def stock_adjust(body: StockAdjustIn, request: Request, idem: Optional[str] = IdemKey, user: dict = Depends(require_owner)):
    reason = _reason_text(ADJUST_REASONS, body.reason_code, body.reason_note)
    delta = body.physical_quantity - body.expected_quantity
    if delta == 0:
        raise AppError(422, "NO_CHANGE", "Physical quantity matches the system quantity — no adjustment needed")
    product, warehouse = await load_product_warehouse(user, body.product_id, body.warehouse_id, require_active=False)

    async def fn(s):
        before, after, inv = await apply_delta(s, product, warehouse["_id"], delta, expected=body.expected_quantity)
        txn = build_txn(type_="ADJUSTMENT", product=product, warehouse=warehouse, user=user, change=delta, before=before, after=after,
                        reason_code=body.reason_code, reason_note=reason)
        txn["_id"] = (await db.stock_transactions.insert_one(txn, session=s)).inserted_id
        events = await low_stock_events(s, inv, before, product, warehouse)
        await write_audit(user, "STOCK_ADJUSTMENT", "stock_transaction", txn["_id"], before={"quantity": before}, after={"quantity": after},
                          reason=reason, warehouse_id=warehouse["_id"], request=request, session=s, meta={"product_id": str(product["_id"]), "txn_no": txn["txn_no"]})
        return {"transaction": jsonable(txn), "related": []}, events + [inventory_event(inv), txn_event(txn)]

    return await run_stock_op(user, idem, "stock_adjust", body.model_dump(), fn)


@router.post("/transfer", response_model=StockResult, summary="Transfer stock between warehouses (owner, atomic)")
async def stock_transfer(body: TransferIn, request: Request, idem: Optional[str] = IdemKey, user: dict = Depends(require_owner)):
    if body.from_warehouse_id == body.to_warehouse_id:
        raise AppError(422, "SAME_WAREHOUSE", "Source and destination warehouses must be different")
    product, src = await load_product_warehouse(user, body.product_id, body.from_warehouse_id)
    dst = await db.warehouses.find_one({"_id": oid(body.to_warehouse_id, "to_warehouse_id")})
    if not dst:
        raise not_found("Destination warehouse")
    if not dst.get("active", True):
        raise AppError(422, "WAREHOUSE_INACTIVE", "Destination warehouse is inactive")
    q = body.quantity

    async def fn(s):
        transfer_id = ObjectId()
        b1, a1, inv1 = await apply_delta(s, product, src["_id"], -q)
        b2, a2, inv2 = await apply_delta(s, product, dst["_id"], q)
        out_t = build_txn(type_="TRANSFER_OUT", product=product, warehouse=src, user=user, change=-q, before=b1, after=a1,
                          transfer_id=transfer_id, counterpart_warehouse_name=dst["name"], note=body.note)
        in_t = build_txn(type_="TRANSFER_IN", product=product, warehouse=dst, user=user, change=q, before=b2, after=a2,
                         transfer_id=transfer_id, counterpart_warehouse_name=src["name"], note=body.note)
        res = await db.stock_transactions.insert_many([out_t, in_t], session=s)
        out_t["_id"], in_t["_id"] = res.inserted_ids
        await db.stock_transfers.insert_one(
            {"_id": transfer_id, "transfer_no": gen_code("TR"), "product_id": product["_id"], "product_name": product["name"],
             "from_warehouse_id": src["_id"], "to_warehouse_id": dst["_id"], "quantity": q, "out_txn_id": out_t["_id"],
             "in_txn_id": in_t["_id"], "user_id": user["_id"], "note": body.note, "status": "completed", "created_at": now()},
            session=s,
        )
        events = await low_stock_events(s, inv1, b1, product, src)
        await write_audit(user, "STOCK_TRANSFER", "stock_transfer", transfer_id,
                          before={"from_quantity": b1, "to_quantity": b2}, after={"from_quantity": a1, "to_quantity": a2},
                          warehouse_id=src["_id"], request=request, session=s,
                          meta={"product_id": str(product["_id"]), "quantity": q, "from": src["name"], "to": dst["name"]})
        events += [inventory_event(inv1), inventory_event(inv2), txn_event(out_t), txn_event(in_t)]
        return {"transaction": jsonable(out_t), "related": [jsonable(in_t)], "transfer_id": str(transfer_id)}, events

    return await run_stock_op(user, idem, "stock_transfer", body.model_dump(), fn)
