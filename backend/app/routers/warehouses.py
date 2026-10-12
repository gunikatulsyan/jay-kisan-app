from fastapi import APIRouter, Depends, Request
from pymongo.errors import DuplicateKeyError

from ..audit import write_audit
from ..db import db
from ..schemas import WarehouseIn, WarehouseOut, WarehouseUpdate
from ..security import get_current_user, is_owner, require_owner
from ..utils import AppError, norm, not_found, now, oid

router = APIRouter(prefix="/warehouses", tags=["warehouses"])


@router.get("", response_model=list[WarehouseOut])
async def list_warehouses(include_inactive: bool = False, user: dict = Depends(get_current_user)):
    filt: dict = {} if (include_inactive and is_owner(user)) else {"active": True}
    if not is_owner(user):
        filt["_id"] = {"$in": user.get("warehouse_ids") or []}
    return [WarehouseOut.from_mongo(d) for d in await db.warehouses.find(filt).sort("name", 1).to_list(1000)]


@router.post("", response_model=WarehouseOut, status_code=201)
async def create_warehouse(body: WarehouseIn, request: Request, owner: dict = Depends(require_owner)):
    t = now()
    doc = {"name": body.name, "name_lc": norm(body.name), "code": body.code.upper(), "address": body.address, "phone": body.phone,
           "active": True, "created_at": t, "updated_at": t, "created_by": owner["_id"]}
    try:
        doc["_id"] = (await db.warehouses.insert_one(doc)).inserted_id
    except DuplicateKeyError:
        raise AppError(409, "WAREHOUSE_EXISTS", "A warehouse with this name or code already exists")
    await write_audit(owner, "WAREHOUSE_CREATE", "warehouse", doc["_id"], after={"name": body.name, "code": doc["code"]}, request=request)
    return WarehouseOut.from_mongo(doc)


@router.patch("/{warehouse_id}", response_model=WarehouseOut)
async def update_warehouse(warehouse_id: str, body: WarehouseUpdate, request: Request, owner: dict = Depends(require_owner)):
    wid = oid(warehouse_id)
    current = await db.warehouses.find_one({"_id": wid})
    if not current:
        raise not_found("Warehouse")
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        return WarehouseOut.from_mongo(current)
    if "name" in changes:
        changes["name_lc"] = norm(changes["name"])
    changes["updated_at"] = now()
    try:
        updated = await db.warehouses.find_one_and_update({"_id": wid}, {"$set": changes}, return_document=True)
    except DuplicateKeyError:
        raise AppError(409, "WAREHOUSE_EXISTS", "A warehouse with this name already exists")
    if "name" in changes:
        await db.inventory.update_many({"warehouse_id": wid}, {"$set": {"warehouse_name": changes["name"]}})
    action = "WAREHOUSE_DEACTIVATE" if changes.get("active") is False else "WAREHOUSE_UPDATE"
    await write_audit(owner, action, "warehouse", wid, before={k: current.get(k) for k in changes if k not in ("updated_at", "name_lc")},
                      after={k: v for k, v in changes.items() if k not in ("updated_at", "name_lc")}, request=request)
    return WarehouseOut.from_mongo(updated)
