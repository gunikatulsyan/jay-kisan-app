import base64
import hashlib
import json
import re
import secrets
from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from bson import Decimal128, ObjectId

from .config import BUSINESS_TZ

TZ = ZoneInfo(BUSINESS_TZ)
_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


def now() -> datetime:
    return datetime.now(timezone.utc)


class AppError(Exception):
    """Structured API error. Rendered as {"error": {"code", "message", "details"}}."""

    def __init__(self, status: int, code: str, message: str, details=None):
        super().__init__(message)
        self.status, self.code, self.message, self.details = status, code, message, details


def not_found(what: str) -> AppError:
    return AppError(404, "NOT_FOUND", f"{what} not found")


def oid(value, field: str = "id") -> ObjectId:
    if isinstance(value, ObjectId):
        return value
    if value is None or not ObjectId.is_valid(str(value)):
        raise AppError(422, "INVALID_ID", f"Invalid {field}")
    return ObjectId(str(value))


def to_dec(value):
    if value is None:
        return None
    return Decimal128(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def dec_val(value):
    if value is None:
        return None
    if isinstance(value, Decimal128):
        return value.to_decimal()
    return Decimal(str(value))


def jsonable(v):
    if isinstance(v, ObjectId):
        return str(v)
    if isinstance(v, Decimal128):
        return float(v.to_decimal())
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, dict):
        return {("id" if k == "_id" else k): jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [jsonable(x) for x in v]
    return v


def lit(v):
    """Wrap a value so aggregation-pipeline updates never interpret it as an expression."""
    return {"$literal": v}


def norm(s) -> str:
    return (s or "").strip().lower()


def tokens(*parts) -> list:
    words = set()
    for p in parts:
        for w in re.split(r"[^a-z0-9]+", norm(p)):
            if w:
                words.add(w)
    return sorted(words)[:60]


def prefix_regex(q: str) -> dict:
    return {"$regex": "^" + re.escape(q)}


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def gen_code(prefix: str) -> str:
    stamp = now().astimezone(TZ).strftime("%y%m%d")
    return f"{prefix}-{stamp}-{''.join(secrets.choice(_CODE_ALPHABET) for _ in range(6))}"


def encode_cursor(values: list) -> str:
    return base64.urlsafe_b64encode(json.dumps(jsonable(values)).encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> list:
    try:
        pad = "=" * (-len(cursor) % 4)
        vals = json.loads(base64.urlsafe_b64decode(cursor + pad).decode())
        assert isinstance(vals, list) and vals
        return vals
    except Exception:
        raise AppError(422, "INVALID_CURSOR", "Invalid pagination cursor")


async def paginate(coll, filt: dict, *, sort_field="_id", direction=-1, cursor=None, limit=50, projection=None):
    """Keyset pagination on (sort_field, _id) — stable and index-friendly."""
    limit = max(1, min(int(limit), 100))
    f = filt
    if cursor:
        vals = decode_cursor(cursor)
        op = "$gt" if direction == 1 else "$lt"
        if sort_field == "_id":
            f = {"$and": [filt, {"_id": {op: oid(vals[0], "cursor")}}]}
        else:
            if len(vals) != 2:
                raise AppError(422, "INVALID_CURSOR", "Invalid pagination cursor")
            v, last_id = vals[0], oid(vals[1], "cursor")
            f = {"$and": [filt, {"$or": [{sort_field: {op: v}}, {sort_field: v, "_id": {op: last_id}}]}]}
    sort = [("_id", direction)] if sort_field == "_id" else [(sort_field, direction), ("_id", direction)]
    docs = await coll.find(f, projection).sort(sort).limit(limit + 1).to_list(limit + 1)
    next_cursor = None
    if len(docs) > limit:
        docs = docs[:limit]
        last = docs[-1]
        vals = [str(last["_id"])] if sort_field == "_id" else [last.get(sort_field), str(last["_id"])]
        next_cursor = encode_cursor(vals)
    return docs, next_cursor


def parse_day(s: str) -> date:
    try:
        return date.fromisoformat(s)
    except Exception:
        raise AppError(422, "INVALID_DATE", f"Invalid date '{s}'. Use YYYY-MM-DD")


def day_range(date_from=None, date_to=None, default_days=0):
    """Business-timezone inclusive dates -> UTC [start, end)."""
    today = now().astimezone(TZ).date()
    d_to = parse_day(date_to) if date_to else today
    d_from = parse_day(date_from) if date_from else d_to - timedelta(days=default_days)
    if d_from > d_to:
        raise AppError(422, "INVALID_DATE_RANGE", "'from' must be before 'to'")
    start = datetime.combine(d_from, time.min, tzinfo=TZ).astimezone(timezone.utc)
    end = datetime.combine(d_to + timedelta(days=1), time.min, tzinfo=TZ).astimezone(timezone.utc)
    return start, end


def oid_range(start: datetime, end: datetime) -> dict:
    return {"$gte": ObjectId.from_datetime(start), "$lt": ObjectId.from_datetime(end)}
