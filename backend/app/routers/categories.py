"""Unlimited-depth categories: parent_id + materialised ancestors array."""
from fastapi import APIRouter, Depends, Request
from pymongo.errors import DuplicateKeyError

from ..audit import write_audit
from ..db import db, run_atomic
from ..schemas import CategoryIn, CategoryMove, CategoryOut, CategoryRename
from ..security import get_current_user, require_owner
from ..utils import AppError, lit, norm, not_found, now, oid

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategoryOut])
async def list_categories(include_inactive: bool = False, _user: dict = Depends(get_current_user)):
    filt = {} if include_inactive else {"active": True}
    docs = await db.categories.find(filt).sort([("depth", 1), ("name_lc", 1)]).to_list(20000)
    return [CategoryOut.from_mongo(d) for d in docs]


@router.post("", response_model=CategoryOut, status_code=201)
async def create_category(body: CategoryIn, request: Request, owner: dict = Depends(require_owner)):
    ancestors, parent_id = [], None
    if body.parent_id:
        parent = await db.categories.find_one({"_id": oid(body.parent_id, "parent_id"), "active": True})
        if not parent:
            raise not_found("Parent category")
        parent_id, ancestors = parent["_id"], parent.get("ancestors", []) + [parent["_id"]]
    t = now()
    doc = {"name": body.name, "name_lc": norm(body.name), "parent_id": parent_id, "ancestors": ancestors, "depth": len(ancestors),
           "active": True, "created_at": t, "updated_at": t}
    try:
        doc["_id"] = (await db.categories.insert_one(doc)).inserted_id
    except DuplicateKeyError:
        raise AppError(409, "CATEGORY_EXISTS", "A category with this name already exists at this level")
    await write_audit(owner, "CATEGORY_CREATE", "category", doc["_id"], after={"name": body.name, "parent_id": str(parent_id) if parent_id else None}, request=request)
    return CategoryOut.from_mongo(doc)


@router.patch("/{category_id}", response_model=CategoryOut)
async def rename_category(category_id: str, body: CategoryRename, request: Request, owner: dict = Depends(require_owner)):
    cid = oid(category_id)
    cat = await db.categories.find_one({"_id": cid})
    if not cat:
        raise not_found("Category")
    try:
        updated = await db.categories.find_one_and_update({"_id": cid}, {"$set": {"name": body.name, "name_lc": norm(body.name), "updated_at": now()}}, return_document=True)
    except DuplicateKeyError:
        raise AppError(409, "CATEGORY_EXISTS", "A category with this name already exists at this level")
    await write_audit(owner, "CATEGORY_RENAME", "category", cid, before={"name": cat["name"]}, after={"name": body.name}, request=request)
    return CategoryOut.from_mongo(updated)


@router.post("/{category_id}/move", response_model=CategoryOut)
async def move_category(category_id: str, body: CategoryMove, request: Request, owner: dict = Depends(require_owner)):
    cid = oid(category_id)
    cat = await db.categories.find_one({"_id": cid})
    if not cat:
        raise not_found("Category")
    new_ancestors, new_parent = [], None
    if body.parent_id:
        parent = await db.categories.find_one({"_id": oid(body.parent_id, "parent_id"), "active": True})
        if not parent:
            raise not_found("New parent category")
        if parent["_id"] == cid or cid in parent.get("ancestors", []):
            raise AppError(422, "CATEGORY_CYCLE", "A category cannot be moved inside itself or its own subcategory")
        new_parent, new_ancestors = parent["_id"], parent.get("ancestors", []) + [parent["_id"]]
    old_len = len(cat.get("ancestors", []))

    async def fn(s):
        await db.categories.update_one({"_id": cid}, {"$set": {"parent_id": new_parent, "ancestors": new_ancestors, "depth": len(new_ancestors), "updated_at": now()}}, session=s)
        rebased = {"$concatArrays": [lit(new_ancestors), {"$slice": ["$ancestors", old_len, 100000]}]}
        await db.categories.update_many({"ancestors": cid}, [{"$set": {"ancestors": rebased}}, {"$set": {"depth": {"$size": "$ancestors"}}}], session=s)
        rebased_ids = {"$concatArrays": [lit(new_ancestors), {"$slice": ["$category_ids", old_len, 100000]}]}
        await db.products.update_many({"category_ids": cid}, [{"$set": {"category_ids": rebased_ids}}], session=s)
        await db.inventory.update_many({"category_ids": cid}, [{"$set": {"category_ids": rebased_ids}}], session=s)

    try:
        await run_atomic(fn)
    except DuplicateKeyError:
        raise AppError(409, "CATEGORY_EXISTS", "A category with this name already exists under the new parent")
    await write_audit(owner, "CATEGORY_MOVE", "category", cid, before={"parent_id": str(cat.get("parent_id")) if cat.get("parent_id") else None},
                      after={"parent_id": str(new_parent) if new_parent else None}, request=request)
    return CategoryOut.from_mongo(await db.categories.find_one({"_id": cid}))


@router.post("/{category_id}/deactivate", response_model=CategoryOut)
async def deactivate_category(category_id: str, request: Request, owner: dict = Depends(require_owner)):
    cid = oid(category_id)
    if await db.categories.find_one({"ancestors": cid, "active": True}, {"_id": 1}):
        raise AppError(422, "HAS_ACTIVE_CHILDREN", "Deactivate or move its subcategories first")
    updated = await db.categories.find_one_and_update({"_id": cid}, {"$set": {"active": False, "updated_at": now()}}, return_document=True)
    if not updated:
        raise not_found("Category")
    await write_audit(owner, "CATEGORY_DEACTIVATE", "category", cid, request=request)
    return CategoryOut.from_mongo(updated)


@router.post("/{category_id}/activate", response_model=CategoryOut)
async def activate_category(category_id: str, request: Request, owner: dict = Depends(require_owner)):
    cid = oid(category_id)
    updated = await db.categories.find_one_and_update({"_id": cid}, {"$set": {"active": True, "updated_at": now()}}, return_document=True)
    if not updated:
        raise not_found("Category")
    await write_audit(owner, "CATEGORY_ACTIVATE", "category", cid, request=request)
    return CategoryOut.from_mongo(updated)
