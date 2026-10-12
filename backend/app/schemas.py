"""Explicit request/response schemas. Mongo documents are converted via BaseDocument.from_mongo."""
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Dict, Generic, List, Literal, Optional, TypeVar

from bson import Decimal128, ObjectId
from pydantic import AliasChoices, BaseModel, BeforeValidator, ConfigDict, Field

from .utils import jsonable


def _oid_str(v):
    return str(v) if isinstance(v, ObjectId) else v


def _money(v):
    if v is None:
        return None
    if isinstance(v, Decimal128):
        return float(v.to_decimal())
    return float(v)


PyObjectId = Annotated[str, BeforeValidator(_oid_str)]
OptObjectId = Annotated[Optional[str], BeforeValidator(_oid_str)]
ObjectIdList = Annotated[List[str], BeforeValidator(lambda v: [str(x) for x in (v or [])])]
Money = Annotated[Optional[float], BeforeValidator(_money)]
JsonAny = Annotated[Any, BeforeValidator(jsonable)]


class BaseDocument(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)
    id: PyObjectId = Field(validation_alias=AliasChoices("_id", "id"))

    @classmethod
    def from_mongo(cls, doc: dict):
        return cls.model_validate(doc)


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: List[T]
    next_cursor: Optional[str] = None


class In(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


Qty = Annotated[int, Field(gt=0, le=10_000_000)]
Price = Annotated[Optional[Decimal], Field(default=None, ge=0, max_digits=14, decimal_places=2)]
Role = Literal["owner", "employee"]


# ---------------- Auth ----------------
class LoginIn(In):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class RefreshIn(In):
    refresh_token: str = Field(min_length=10, max_length=256)


class LogoutIn(In):
    refresh_token: Optional[str] = Field(default=None, max_length=256)


class ChangePasswordIn(In):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=72)


class ResetWithCodeIn(In):
    username: str = Field(min_length=1, max_length=64)
    code: str = Field(min_length=6, max_length=16)
    new_password: str = Field(min_length=8, max_length=72)


# ---------------- Users ----------------
class UserOut(BaseDocument):
    username: str
    full_name: str
    role: Role
    phone: Optional[str] = None
    warehouse_ids: ObjectIdList = []
    active: bool = True
    must_change_password: bool = False
    created_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class UserCreate(In):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9._-]+$")
    full_name: str = Field(min_length=1, max_length=100)
    phone: Optional[str] = Field(default=None, max_length=30)
    role: Role = "employee"
    password: str = Field(min_length=8, max_length=72)
    warehouse_ids: List[str] = []


class UserUpdate(In):
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    phone: Optional[str] = Field(default=None, max_length=30)
    role: Optional[Role] = None
    warehouse_ids: Optional[List[str]] = None
    active: Optional[bool] = None


class TempPasswordIn(In):
    password: str = Field(min_length=8, max_length=72)


class ResetCodeOut(BaseModel):
    code: str
    expires_at: datetime


# ---------------- Warehouses ----------------
class WarehouseIn(In):
    name: str = Field(min_length=2, max_length=80)
    code: str = Field(min_length=2, max_length=10, pattern=r"^[A-Za-z0-9-]+$")
    address: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=30)


class WarehouseUpdate(In):
    name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    address: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=30)
    active: Optional[bool] = None


class WarehouseOut(BaseDocument):
    name: str
    code: str
    address: Optional[str] = None
    phone: Optional[str] = None
    active: bool = True
    created_at: Optional[datetime] = None


# ---------------- Categories ----------------
class CategoryIn(In):
    name: str = Field(min_length=1, max_length=80)
    parent_id: Optional[str] = None


class CategoryRename(In):
    name: str = Field(min_length=1, max_length=80)


class CategoryMove(In):
    parent_id: Optional[str] = None


class CategoryOut(BaseDocument):
    name: str
    parent_id: OptObjectId = None
    ancestors: ObjectIdList = []
    depth: int = 0
    active: bool = True


# ---------------- Products ----------------
class ProductIn(In):
    sku: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    category_id: Optional[str] = None
    brand: Optional[str] = Field(default=None, max_length=100)
    description: Optional[str] = Field(default=None, max_length=2000)
    unit: str = Field(default="pcs", min_length=1, max_length=20)
    barcode: Optional[str] = Field(default=None, max_length=64)
    supplier: Optional[str] = Field(default=None, max_length=150)
    purchase_price: Price = None
    selling_price: Price = None
    min_stock: int = Field(default=0, ge=0, le=100_000_000)
    batch_no: Optional[str] = Field(default=None, max_length=64)
    expiry_date: Optional[date] = None


class ProductUpdate(In):
    sku: Optional[str] = Field(default=None, min_length=1, max_length=64)
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    category_id: Optional[str] = None
    brand: Optional[str] = Field(default=None, max_length=100)
    description: Optional[str] = Field(default=None, max_length=2000)
    unit: Optional[str] = Field(default=None, min_length=1, max_length=20)
    barcode: Optional[str] = Field(default=None, max_length=64)
    supplier: Optional[str] = Field(default=None, max_length=150)
    purchase_price: Price = None
    selling_price: Price = None
    min_stock: Optional[int] = Field(default=None, ge=0, le=100_000_000)
    batch_no: Optional[str] = Field(default=None, max_length=64)
    expiry_date: Optional[date] = None


class ReasonIn(In):
    reason: str = Field(min_length=3, max_length=500)


class InventoryBrief(BaseModel):
    warehouse_id: PyObjectId
    warehouse_name: Optional[str] = None
    quantity: int
    min_stock: Optional[int] = None
    effective_min: int = 0
    stock_status: Optional[str] = None


class ProductOut(BaseDocument):
    sku: str
    name: str
    category_id: OptObjectId = None
    category_ids: ObjectIdList = []
    brand: Optional[str] = None
    description: Optional[str] = None
    unit: str = "pcs"
    barcode: Optional[str] = None
    supplier: Optional[str] = None
    purchase_price: Money = None
    selling_price: Money = None
    min_stock: int = 0
    batch_no: Optional[str] = None
    expiry_date: Optional[str] = None
    active: bool = True
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    stock_total: Optional[int] = None
    stock_status: Optional[str] = None
    inventory: Optional[List[InventoryBrief]] = None


class LookupOut(BaseModel):
    product: ProductOut
    warehouse_id: Optional[str] = None
    quantity: Optional[int] = None
    stock_status: Optional[str] = None


# ---------------- Inventory ----------------
class InventoryOut(BaseDocument):
    product_id: PyObjectId
    warehouse_id: PyObjectId
    warehouse_name: Optional[str] = None
    product_name: str
    sku: str
    barcode: Optional[str] = None
    unit: Optional[str] = None
    quantity: int
    min_stock: Optional[int] = None
    product_min_stock: int = 0
    stock_status: Optional[str] = None
    purchase_price: Money = None
    selling_price: Money = None
    last_sale_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ThresholdIn(In):
    product_id: str
    warehouse_id: str
    min_stock: Optional[int] = Field(default=None, ge=0, le=100_000_000)


# ---------------- Stock operations ----------------
RemovalReason = Literal["DAMAGED", "EXPIRED", "COUNT_DISCREPANCY", "LOST", "RETURNED_TO_SUPPLIER", "OTHER"]
AdjustReason = Literal["COUNT_DISCREPANCY", "DAMAGED", "EXPIRED", "LOST", "FOUND", "DATA_ENTRY_ERROR", "OTHER"]


class StockInIn(In):
    product_id: str
    warehouse_id: str
    quantity: Qty
    unit_cost: Price = None
    batch_no: Optional[str] = Field(default=None, max_length=64)
    note: Optional[str] = Field(default=None, max_length=500)


class StockRemoveIn(In):
    product_id: str
    warehouse_id: str
    quantity: Qty
    reason_code: RemovalReason
    reason_note: Optional[str] = Field(default=None, max_length=500)
    confirm: bool


class StockAdjustIn(In):
    product_id: str
    warehouse_id: str
    expected_quantity: int = Field(ge=-100_000_000, le=100_000_000)
    physical_quantity: int = Field(ge=0, le=100_000_000)
    reason_code: AdjustReason
    reason_note: Optional[str] = Field(default=None, max_length=500)


class SaleIn(In):
    product_id: str
    warehouse_id: str
    quantity: Qty
    customer_id: Optional[str] = None
    unit_price: Price = None
    note: Optional[str] = Field(default=None, max_length=500)


class TransferIn(In):
    product_id: str
    from_warehouse_id: str
    to_warehouse_id: str
    quantity: Qty
    note: Optional[str] = Field(default=None, max_length=500)


class CorrectionIn(In):
    corrected_quantity: int = Field(ge=0, le=10_000_000)
    reason: str = Field(min_length=3, max_length=500)


class TransactionOut(BaseDocument):
    txn_no: str
    type: str
    product_id: PyObjectId
    product_name: str
    sku: Optional[str] = None
    unit: Optional[str] = None
    warehouse_id: PyObjectId
    warehouse_name: Optional[str] = None
    quantity_change: int
    quantity_before: int
    quantity_after: int
    user_id: PyObjectId
    user_name: Optional[str] = None
    user_role: Optional[str] = None
    customer_id: OptObjectId = None
    customer_name: Optional[str] = None
    unit_price: Money = None
    unit_cost: Money = None
    total_amount: Money = None
    total_cost: Money = None
    profit: Money = None
    sales_qty: Optional[int] = None
    reason_code: Optional[str] = None
    reason_note: Optional[str] = None
    note: Optional[str] = None
    transfer_id: OptObjectId = None
    counterpart_warehouse_name: Optional[str] = None
    corrects_txn_id: OptObjectId = None
    corrects_txn_no: Optional[str] = None
    original_type: Optional[str] = None
    created_at: datetime


class StockResult(BaseModel):
    transaction: TransactionOut
    related: List[TransactionOut] = []
    transfer_id: Optional[str] = None
    idempotent_replay: bool = False


class TransactionDetail(BaseModel):
    transaction: TransactionOut
    corrections: List[TransactionOut] = []
    related: List[TransactionOut] = []
    effective_quantity: Optional[int] = None
    correctable: bool = False


# ---------------- Customers ----------------
class CustomerIn(In):
    name: str = Field(min_length=1, max_length=150)
    phone: Optional[str] = Field(default=None, max_length=30)
    address: Optional[str] = Field(default=None, max_length=300)
    tax_id: Optional[str] = Field(default=None, max_length=40)


class CustomerUpdate(In):
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    phone: Optional[str] = Field(default=None, max_length=30)
    address: Optional[str] = Field(default=None, max_length=300)
    tax_id: Optional[str] = Field(default=None, max_length=40)
    active: Optional[bool] = None


class CustomerOut(BaseDocument):
    name: str
    phone: Optional[str] = None
    address: Optional[str] = None
    tax_id: Optional[str] = None
    active: bool = True
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ---------------- Notifications / Audit ----------------
class NotificationOut(BaseDocument):
    recipient_id: PyObjectId
    type: str
    title: str
    message: str
    transaction_id: OptObjectId = None
    product_id: OptObjectId = None
    warehouse_id: OptObjectId = None
    meta: JsonAny = None
    read: bool = False
    read_at: Optional[datetime] = None
    created_at: datetime


class AuditOut(BaseDocument):
    user_id: OptObjectId = None
    user_name: Optional[str] = None
    role: Optional[str] = None
    action: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    warehouse_id: OptObjectId = None
    before: JsonAny = None
    after: JsonAny = None
    reason: Optional[str] = None
    meta: JsonAny = None
    ip: Optional[str] = None
    created_at: datetime


class SettingsOut(BaseModel):
    allow_negative_stock: bool = False
    require_customer_for_sale: bool = True


class SettingsUpdate(In):
    allow_negative_stock: Optional[bool] = None
    require_customer_for_sale: Optional[bool] = None


class ExportTicketIn(In):
    report: Literal["inventory", "products", "transactions", "sales", "customers", "audit", "low_stock"]
    format: Literal["csv", "xlsx", "pdf"]
    params: Dict[str, str] = {}


class Message(BaseModel):
    message: str
