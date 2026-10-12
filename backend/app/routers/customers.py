import re
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request

from ..audit import write_audit
from ..db import db
from ..schemas import CustomerIn, CustomerOut, CustomerUpdate, Page
from ..security import get_current_user, is_owner, require_owner
from ..utils import AppError, norm, not_found, now, oid, paginate, prefix_regex, tokens

router = APIRouter(prefix="/customers", tags=["customers"])


def _phone_norm(p: Optional[str]) -> Optional[str]:
    digits = re.sub(r"\D", "", p or "")
    return digits or None


@router.get("", response_model=Page[CustomerOut])
async def list_customers(q: Optional[str] = None, include_inactive: bool = False, cursor: Optional[str] = None,
                         limit: int = Query(30, ge=1, le=100), user: dict = Depends(get_current_user)):
    filt: dict = {} if (include_inactive and is_owner(user)) else {"active": True}
    if q and q.strip():
        qn = norm(q)
        ors = [{"name_lc": prefix_regex(qn)}]
        words = [w for w in re.split(r"[^a-z0-9]+", qn) if w]
        if words:
            ors.append({"$and": [{"search_tokens": prefix_regex(w)} for w in words[:5]]})
        digits = _phone_norm(q)
        if digits and len(digits) >= 3:
            ors.append({"phone_norm": prefix_regex(digits)})
        filt["$or"] = ors
    docs, nxt = await paginate(db.customers, filt, sort_field="name_lc", direction=1, cursor=cursor, limit=limit)
    return Page[CustomerOut](items=[CustomerOut.from_mongo(d) for d in docs], next_cursor=nxt)


@router.post("", response_model=CustomerOut, status_code=201)
async def create_customer(body: CustomerIn, request: Request, user: dict = Depends(get_current_user)):
    phone_norm = _phone_norm(body.phone)
    if phone_norm:
        existing = await db.customers.find_one({"phone_norm": phone_norm, "active": True})
        if existing:
            raise AppError(409, "DUPLICATE_CUSTOMER", f"A customer with this phone already exists: {existing['name']}",
                           {"customer_id": str(existing["_id"]), "name": existing["name"]})
    t = now()
    doc = {"name": body.name, "name_lc": norm(body.name), "phone": body.phone, "phone_norm": phone_norm, "address": body.address,
           "tax_id": body.tax_id, "search_tokens": tokens(body.name), "active": True, "created_at": t, "updated_at": t, "created_by": user["_id"]}
    doc["_id"] = (await db.customers.insert_one(doc)).inserted_id
    await write_audit(user, "CUSTOMER_CREATE", "customer", doc["_id"], after={"name": body.name, "phone": body.phone}, request=request)
    return CustomerOut.from_mongo(doc)


@router.get("/{customer_id}", response_model=CustomerOut)
async def get_customer(customer_id: str, _user: dict = Depends(get_current_user)):
    doc = await db.customers.find_one({"_id": oid(customer_id)})
    if not doc:
        raise not_found("Customer")
    return CustomerOut.from_mongo(doc)


@router.patch("/{customer_id}", response_model=CustomerOut)
async def update_customer(customer_id: str, body: CustomerUpdate, request: Request, owner: dict = Depends(require_owner)):
    cid = oid(customer_id)
    current = await db.customers.find_one({"_id": cid})
    if not current:
        raise not_found("Customer")
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        return CustomerOut.from_mongo(current)
    if "name" in changes:
        changes["name_lc"], changes["search_tokens"] = norm(changes["name"]), tokens(changes["name"])
    if "phone" in changes:
        changes["phone_norm"] = _phone_norm(changes["phone"])
    changes["updated_at"] = now()
    updated = await db.customers.find_one_and_update({"_id": cid}, {"$set": changes}, return_document=True)
    keys = [k for k in body.model_dump(exclude_unset=True)]
    await write_audit(owner, "CUSTOMER_UPDATE", "customer", cid, before={k: current.get(k) for k in keys}, after={k: updated.get(k) for k in keys}, request=request)
    return CustomerOut.from_mongo(updated)


@router.get("/{customer_id}/summary", summary="Customer purchase history aggregated by product (owner)")
async def customer_summary(customer_id: str, _owner: dict = Depends(require_owner)):
    cid = oid(customer_id)
    rows = await db.stock_transactions.aggregate([
        {"$match": {"customer_id": cid, "counts_as_sale": True}},
        {"$group": {"_id": "$product_id", "product_name": {"$last": "$product_name"}, "unit": {"$last": "$unit"},
                    "units": {"$sum": "$sales_qty"}, "revenue": {"$sum": "$total_amount"}, "priced": {"$sum": {"$cond": [{"$ne": ["$total_amount", None]}, 1, 0]}},
                    "last_at": {"$max": "$created_at"}}},
        {"$sort": {"units": -1}}, {"$limit": 200},
    ]).to_list(200)
    out = []
    for r in rows:
        out.append({"product_id": str(r["_id"]), "product_name": r["product_name"], "unit": r.get("unit"), "units": r["units"],
                    "revenue": float(r["revenue"].to_decimal()) if r["priced"] and hasattr(r["revenue"], "to_decimal") else None,
                    "last_at": r["last_at"].isoformat() if r.get("last_at") else None})
    return {"products": out, "total_units": sum(r["units"] for r in out)}
