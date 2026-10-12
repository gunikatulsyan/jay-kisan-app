"""MongoDB client, transaction runner, collections, validators and indexes."""
import logging

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING as A
from pymongo import DESCENDING as D
from pymongo import IndexModel
from pymongo.read_concern import ReadConcern
from pymongo.write_concern import WriteConcern

from . import config
from .utils import AppError

log = logging.getLogger("jaykisan.db")

client = AsyncIOMotorClient(
    config.MONGO_URL, tz_aware=True, serverSelectionTimeoutMS=10000, maxPoolSize=100, retryWrites=True, appname="jaykisan-api"
)
db = client[config.DB_NAME]
state = {"tx_supported": False, "non_tx_mode": False}


async def detect_transactions():
    hello = await client.admin.command("hello")
    state["tx_supported"] = bool(hello.get("setName")) or hello.get("msg") == "isdbgrid"
    state["non_tx_mode"] = (not state["tx_supported"]) and config.ALLOW_NON_TRANSACTIONAL_DEV
    if state["tx_supported"]:
        log.info("MongoDB supports multi-document transactions (replica set / Atlas).")
    elif state["non_tx_mode"]:
        log.warning(
            "DEVELOPMENT MODE: MongoDB is standalone (no transactions). Single-document stock updates remain "
            "atomic and can never go negative, but multi-document consistency is NOT guaranteed. "
            "Never use this mode in production."
        )
    else:
        log.error("MongoDB does not support transactions — stock-changing endpoints will return 503.")


async def run_atomic(fn):
    """Run fn(session) inside a MongoDB transaction (retries transient errors automatically)."""
    if state["tx_supported"]:
        async with await client.start_session() as s:
            return await s.with_transaction(
                fn, read_concern=ReadConcern("snapshot"), write_concern=WriteConcern("majority")
            )
    if state["non_tx_mode"]:
        return await fn(None)
    raise AppError(
        503,
        "TRANSACTIONS_UNAVAILABLE",
        "Stock changes are disabled: the database does not support transactions. Connect the backend to a MongoDB Atlas / replica-set cluster.",
    )


TXN_TYPES = ["STOCK_IN", "SALE", "STOCK_REMOVAL", "ADJUSTMENT", "TRANSFER_OUT", "TRANSFER_IN", "CORRECTION"]

VALIDATORS = {
    "inventory": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["product_id", "warehouse_id", "quantity"],
            "properties": {
                "product_id": {"bsonType": "objectId"},
                "warehouse_id": {"bsonType": "objectId"},
                "quantity": {"bsonType": ["int", "long"]},
            },
        }
    },
    "stock_transactions": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["txn_no", "type", "product_id", "warehouse_id", "quantity_change", "quantity_before", "quantity_after", "user_id", "created_at"],
            "properties": {
                "type": {"enum": TXN_TYPES},
                "product_id": {"bsonType": "objectId"},
                "warehouse_id": {"bsonType": "objectId"},
                "user_id": {"bsonType": "objectId"},
                "quantity_change": {"bsonType": ["int", "long"]},
                "unit_price": {"bsonType": ["decimal", "null"]},
                "unit_cost": {"bsonType": ["decimal", "null"]},
                "created_at": {"bsonType": "date"},
            },
        }
    },
    "products": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["sku", "sku_norm", "name", "name_lc", "active"],
            "properties": {
                "purchase_price": {"bsonType": ["decimal", "null"]},
                "selling_price": {"bsonType": ["decimal", "null"]},
                "min_stock": {"bsonType": ["int", "long"]},
                "active": {"bsonType": "bool"},
            },
        }
    },
}

INDEXES = {
    "users": [IndexModel([("username", A)], unique=True), IndexModel([("role", A), ("active", A)]), IndexModel([("warehouse_ids", A)])],
    "refresh_tokens": [
        IndexModel([("token_hash", A)], unique=True),
        IndexModel([("user_id", A)]),
        IndexModel([("expires_at", A)], expireAfterSeconds=0),
    ],
    "revoked_tokens": [IndexModel([("expires_at", A)], expireAfterSeconds=0)],
    "login_attempts": [IndexModel([("expires_at", A)], expireAfterSeconds=0)],
    "reset_codes": [IndexModel([("user_id", A)]), IndexModel([("expires_at", A)], expireAfterSeconds=0)],
    "warehouses": [IndexModel([("code", A)], unique=True), IndexModel([("name_lc", A)], unique=True)],
    "categories": [
        IndexModel([("parent_id", A), ("name_lc", A)], unique=True),
        IndexModel([("ancestors", A)]),
    ],
    "products": [
        IndexModel([("sku_norm", A)], unique=True),
        IndexModel([("barcode", A)], unique=True, partialFilterExpression={"barcode": {"$type": "string"}}),
        IndexModel([("name_lc", A), ("_id", A)]),
        IndexModel([("active", A), ("name_lc", A), ("_id", A)]),
        IndexModel([("category_ids", A), ("name_lc", A), ("_id", A)]),
        IndexModel([("search_tokens", A)]),
    ],
    "inventory": [
        IndexModel([("product_id", A), ("warehouse_id", A)], unique=True),
        IndexModel([("warehouse_id", A), ("product_name_lc", A), ("_id", A)]),
        IndexModel([("product_name_lc", A), ("_id", A)]),
        IndexModel([("warehouse_id", A), ("stock_status", A), ("product_name_lc", A)]),
        IndexModel([("stock_status", A), ("product_name_lc", A)]),
        IndexModel([("warehouse_id", A), ("category_ids", A), ("product_name_lc", A)]),
        IndexModel([("warehouse_id", A), ("search_tokens", A)]),
        IndexModel([("warehouse_id", A), ("last_sale_at", A)]),
        IndexModel([("last_sale_at", A)]),
        IndexModel([("barcode", A)]),
    ],
    "customers": [
        IndexModel([("name_lc", A), ("_id", A)]),
        IndexModel([("phone_norm", A)]),
        IndexModel([("search_tokens", A)]),
    ],
    "stock_transactions": [
        IndexModel([("txn_no", A)], unique=True),
        IndexModel([("warehouse_id", A), ("_id", D)]),
        IndexModel([("product_id", A), ("_id", D)]),
        IndexModel([("user_id", A), ("_id", D)]),
        IndexModel([("customer_id", A), ("_id", D)]),
        IndexModel([("type", A), ("_id", D)]),
        IndexModel([("counts_as_sale", A), ("created_at", D)]),
        IndexModel([("seller_id", A), ("created_at", D)], sparse=True),
        IndexModel([("warehouse_id", A), ("counts_as_sale", A), ("created_at", D)]),
        IndexModel([("corrects_txn_id", A)], sparse=True),
        IndexModel([("transfer_id", A)], sparse=True),
        IndexModel([("created_at", D)]),
    ],
    "stock_transfers": [
        IndexModel([("transfer_no", A)], unique=True),
        IndexModel([("from_warehouse_id", A), ("_id", D)]),
        IndexModel([("to_warehouse_id", A), ("_id", D)]),
        IndexModel([("product_id", A), ("_id", D)]),
    ],
    "notifications": [
        IndexModel([("recipient_id", A), ("read", A), ("_id", D)]),
        IndexModel([("recipient_id", A), ("_id", D)]),
    ],
    "audit_logs": [
        IndexModel([("user_id", A), ("_id", D)]),
        IndexModel([("entity_type", A), ("entity_id", A), ("_id", D)]),
        IndexModel([("action", A), ("_id", D)]),
        IndexModel([("created_at", D)]),
    ],
    "idempotency_keys": [IndexModel([("expires_at", A)], expireAfterSeconds=0)],
    "download_tickets": [IndexModel([("expires_at", A)], expireAfterSeconds=0)],
    "import_jobs": [IndexModel([("expires_at", A)], expireAfterSeconds=0)],
    "import_rows": [IndexModel([("job_id", A), ("row_no", A)]), IndexModel([("expires_at", A)], expireAfterSeconds=0)],
    "settings": [],
}


async def ensure_schema():
    existing = set(await db.list_collection_names())
    for name in INDEXES:
        if name not in existing:
            if name in VALIDATORS:
                await db.create_collection(name, validator=VALIDATORS[name], validationLevel="strict")
            else:
                await db.create_collection(name)
        elif name in VALIDATORS:
            await db.command({"collMod": name, "validator": VALIDATORS[name], "validationLevel": "strict"})
    for name, models in INDEXES.items():
        if models:
            await db[name].create_indexes(models)
    await db.settings.update_one(
        {"_id": "global"},
        {"$setOnInsert": {"allow_negative_stock": False, "require_customer_for_sale": True}},
        upsert=True,
    )


async def get_settings() -> dict:
    return await db.settings.find_one({"_id": "global"}) or {"allow_negative_stock": False, "require_customer_for_sale": True}
