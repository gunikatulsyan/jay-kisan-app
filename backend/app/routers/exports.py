"""CSV / Excel / PDF exports via short-lived single-use download tickets (works on web + native browsers)."""
import csv
import io
import json
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response, StreamingResponse

from ..audit import write_audit
from ..db import db
from ..schemas import ExportTicketIn
from ..security import require_owner, user_limit
from ..utils import TZ, AppError, day_range, jsonable, now, oid, oid_range
from .reports import sales_report_data

router = APIRouter(prefix="/exports", tags=["exports"])
LIMITS = {"csv": 500_000, "xlsx": 200_000, "pdf": 3_000}


def _dt(v):
    return v.astimezone(TZ).strftime("%Y-%m-%d %H:%M") if v else ""


def _m(v):
    j = jsonable(v)
    return "" if j is None else j


def _inv_filter(p: dict) -> dict:
    f: dict = {"product_active": {"$ne": False}}
    if p.get("warehouse_id"):
        f["warehouse_id"] = oid(p["warehouse_id"], "warehouse_id")
    if p.get("status"):
        f["stock_status"] = {"$in": p["status"].split(",")}
    if p.get("category_id"):
        f["category_ids"] = oid(p["category_id"], "category_id")
    return f


async def build_report(report: str, p: dict, cap: int):
    """Returns (title, headers, async row iterator)."""
    if report in ("inventory", "low_stock"):
        f = _inv_filter(p)
        if report == "low_stock":
            f["stock_status"] = {"$in": ["low", "out"]}
        wh = {w["_id"]: w["name"] for w in await db.warehouses.find({}, {"name": 1}).to_list(1000)}
        headers = ["Warehouse", "SKU", "Product", "Unit", "Quantity", "Min stock", "Status", "Purchase price (Rs.)", "Selling price (Rs.)", "Stock value (Rs.)"]

        async def rows():
            async for d in db.inventory.find(f).sort([("warehouse_id", 1), ("product_name_lc", 1)]).limit(cap):
                pp = jsonable(d.get("purchase_price"))
                m = d.get("min_stock") if d.get("min_stock") is not None else d.get("product_min_stock", 0)
                yield [wh.get(d["warehouse_id"], ""), d["sku"], d["product_name"], d.get("unit") or "", d["quantity"], m, (d.get("stock_status") or "").upper(),
                       "" if pp is None else pp, _m(d.get("selling_price")), "" if pp is None else round(pp * d["quantity"], 2)]
        return ("Low stock" if report == "low_stock" else "Warehouse stock"), headers, rows()

    if report == "products":
        cats = {c["_id"]: c["name"] for c in await db.categories.find({}, {"name": 1}).to_list(20000)}
        headers = ["SKU", "Name", "Category", "Brand", "Unit", "Barcode", "Supplier", "Purchase price", "Selling price", "Min stock", "Batch", "Expiry", "Active"]
        f = {} if p.get("include_inactive") == "true" else {"active": True}

        async def rows():
            async for d in db.products.find(f).sort("name_lc", 1).limit(cap):
                path = " > ".join(cats.get(c, "") for c in d.get("category_ids", []))
                yield [d["sku"], d["name"], path, d.get("brand") or "", d.get("unit") or "", d.get("barcode") or "", d.get("supplier") or "",
                       _m(d.get("purchase_price")), _m(d.get("selling_price")), d.get("min_stock", 0), d.get("batch_no") or "", d.get("expiry_date") or "", "Yes" if d.get("active") else "No"]
        return "Products", headers, rows()

    if report == "transactions":
        f: dict = {}
        for k in ("warehouse_id", "product_id", "customer_id", "user_id"):
            if p.get(k):
                f[k] = oid(p[k], k)
        if p.get("type"):
            f["type"] = {"$in": p["type"].upper().split(",")}
        if p.get("from") or p.get("to"):
            f["_id"] = oid_range(*day_range(p.get("from"), p.get("to")))
        headers = ["Txn No", "Date", "Type", "Product", "SKU", "Warehouse", "Change", "Before", "After", "User", "Customer",
                   "Unit price", "Total", "Unit cost", "Profit", "Reason", "Correction of"]

        async def rows():
            async for d in db.stock_transactions.find(f).sort("_id", -1).limit(cap):
                yield [d["txn_no"], _dt(d["created_at"]), d["type"], d["product_name"], d.get("sku") or "", d.get("warehouse_name") or "",
                       d["quantity_change"], d["quantity_before"], d["quantity_after"], d.get("user_name") or "", d.get("customer_name") or "",
                       _m(d.get("unit_price")), _m(d.get("total_amount")), _m(d.get("unit_cost")), _m(d.get("profit")),
                       d.get("reason_note") or "", d.get("corrects_txn_no") or ""]
        return "Stock transactions", headers, rows()

    if report == "sales":
        data = await sales_report_data(p.get("group_by", "product"), p.get("from"), p.get("to"),
                                       warehouse_id=p.get("warehouse_id"), category_id=p.get("category_id"), product_id=p.get("product_id"),
                                       employee_id=p.get("employee_id"), customer_id=p.get("customer_id"))
        headers = [data["group_by"].title(), "Units sold", "Sales", "Revenue (Rs.)", "Cost (Rs.)", "Profit (Rs.)", "Units without price", "Units without profit data"]

        async def rows():
            for r in data["rows"] + [{"label": "TOTAL", **data["totals"]}]:
                yield [r["label"], r["units"], r["txns"], _m(r["revenue"]) if r["revenue"] is not None else "N/A",
                       _m(r["cost"]) if r["cost"] is not None else "N/A", _m(r["profit"]) if r["profit"] is not None else "N/A",
                       r["unpriced_units"], r["profit_unavailable_units"]]
        return f"Sales by {data['group_by']}", headers, rows()

    if report == "customers":
        headers = ["Name", "Phone", "Address", "PAN/VAT", "Active", "Created"]

        async def rows():
            async for d in db.customers.find({}).sort("name_lc", 1).limit(cap):
                yield [d["name"], d.get("phone") or "", d.get("address") or "", d.get("tax_id") or "", "Yes" if d.get("active") else "No", _dt(d.get("created_at"))]
        return "Customers", headers, rows()

    if report == "audit":
        f = {}
        if p.get("from") or p.get("to"):
            f["_id"] = oid_range(*day_range(p.get("from"), p.get("to")))
        headers = ["Date", "User", "Role", "Action", "Entity", "Entity ID", "Reason", "Before", "After", "IP"]

        async def rows():
            async for d in db.audit_logs.find(f).sort("_id", -1).limit(cap):
                yield [_dt(d["created_at"]), d.get("user_name") or "", d.get("role") or "", d["action"], d.get("entity_type") or "", d.get("entity_id") or "",
                       d.get("reason") or "", json.dumps(jsonable(d.get("before"))) if d.get("before") else "",
                       json.dumps(jsonable(d.get("after"))) if d.get("after") else "", d.get("ip") or ""]
        return "Audit log", headers, rows()
    raise AppError(422, "INVALID_REPORT", "Unknown report")


@router.post("/ticket", dependencies=[Depends(user_limit("export", 20))])
async def create_ticket(body: ExportTicketIn, owner: dict = Depends(require_owner)):
    token = secrets.token_urlsafe(32)
    await db.download_tickets.insert_one({"_id": token, "user_id": owner["_id"], "report": body.report, "format": body.format,
                                          "params": body.params, "used": False, "expires_at": now() + timedelta(minutes=2)})
    return {"url": f"/api/v1/exports/download?ticket={token}", "expires_in": 120}


@router.get("/download", summary="Download an export using a single-use ticket")
async def download(request: Request, ticket: str = Query(min_length=20, max_length=100)):
    t = await db.download_tickets.find_one_and_update({"_id": ticket, "used": False, "expires_at": {"$gt": now()}}, {"$set": {"used": True}})
    if not t:
        raise AppError(410, "TICKET_EXPIRED", "This download link has expired. Please export again.")
    user = await db.users.find_one({"_id": t["user_id"], "active": True, "role": "owner"})
    if not user:
        raise AppError(403, "FORBIDDEN", "Owner access required")
    fmt, cap = t["format"], LIMITS[t["format"]]
    title, headers, rows = await build_report(t["report"], t["params"], cap)
    stamp = now().astimezone(TZ).strftime("%Y%m%d_%H%M")
    filename = f"jaykisan_{t['report']}_{stamp}.{fmt}"
    await write_audit(user, "DATA_EXPORT", "export", t["report"], request=request, meta={"format": fmt, "params": t["params"]})
    disp = {"Content-Disposition": f'attachment; filename="{filename}"'}

    if fmt == "csv":
        async def gen():
            buf = io.StringIO()
            w = csv.writer(buf)
            buf.write("\ufeff")
            w.writerow(headers)
            n = 0
            async for r in rows:
                w.writerow(r)
                n += 1
                if n % 500 == 0:
                    yield buf.getvalue()
                    buf.seek(0)
                    buf.truncate(0)
            yield buf.getvalue()
        return StreamingResponse(gen(), media_type="text/csv; charset=utf-8", headers=disp)

    data = [r async for r in rows]
    if fmt == "xlsx":
        from openpyxl import Workbook

        wb = Workbook(write_only=True)
        ws = wb.create_sheet(title[:30])
        ws.append(headers)
        for r in data:
            ws.append(r)
        out = io.BytesIO()
        wb.save(out)
        return Response(out.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=disp)

    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    out = io.BytesIO()
    doc = SimpleDocTemplate(out, pagesize=landscape(A4), leftMargin=24, rightMargin=24, topMargin=24, bottomMargin=24)
    styles = getSampleStyleSheet()
    cell = styles["BodyText"].clone("cell", fontSize=7, leading=8)
    table_data = [[Paragraph(str(h), cell) for h in headers]] + [[Paragraph(str(c), cell) for c in r] for r in data]
    table = Table(table_data, repeatRows=1)
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#166534")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                               ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D1D5DB")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    note = f" (first {cap} rows)" if len(data) >= cap else ""
    doc.build([Paragraph(f"Jay Kisan — {title}", styles["Title"]),
               Paragraph(f"Generated {now().astimezone(TZ).strftime('%Y-%m-%d %H:%M')} (Asia/Kathmandu){note}", styles["Normal"]),
               Spacer(1, 8), table])
    return Response(out.getvalue(), media_type="application/pdf", headers=disp)
