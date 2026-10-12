"""Seed DEMO data through the public API (so every stock movement is a real audited transaction).
Usage: python -m scripts.seed_demo --base http://localhost:8001 --owner owner --password '...'
Never run against production."""
import argparse
import sys
import uuid

import requests

CATS = {"Agricultural Products": {"Fertilizers": ["Urea", "DAP", "NPK"], "Seeds": ["Rice", "Wheat", "Vegetable Seeds"],
                                  "Pesticides": ["Insecticides", "Fungicides", "Herbicides"]}}
PRODUCTS = [
    ("URE-50", "Urea 50kg", "Urea", "Sajha", "bag", "8901000000011", 1650, 1850, 200),
    ("URE-25", "Urea 25kg", "Urea", "Sajha", "bag", "8901000000028", 850, 960, 100),
    ("DAP-50", "DAP 50kg", "DAP", "IFFCO", "bag", "8901000000035", 3100, 3450, 150),
    ("NPK-50", "NPK 20:20:0 50kg", "NPK", "Coromandel", "bag", "8901000000042", 2600, None, 80),
    ("SED-RICE-HY", "Hybrid Rice Seed 5kg", "Rice", "Bayer", "pack", "8901000000059", None, None, 40),
    ("SED-WHT-01", "Wheat Seed WK-1204 10kg", "Wheat", "NARC", "pack", "8901000000066", 1200, 1450, 30),
    ("SED-TOM-01", "Tomato Seed Srijana 10g", "Vegetable Seeds", "Syngenta", "packet", "8901000000073", 180, 250, 50),
    ("INS-CHL-1L", "Chlorpyrifos 20% EC 1L", "Insecticides", "Dhanuka", "bottle", "8901000000080", 720, 890, 25),
    ("FUN-MAN-1K", "Mancozeb 75% WP 1kg", "Fungicides", "UPL", "pack", "8901000000097", 650, 780, 25),
    ("HER-GLY-1L", "Glyphosate 41% SL 1L", "Herbicides", "Bayer", "bottle", "8901000000103", 980, 1150, 20),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8001")
    ap.add_argument("--owner", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--employee-password", default="Rahul@2026")
    a = ap.parse_args()
    api = a.base.rstrip("/") + "/api/v1"
    s = requests.Session()

    def call(method, path, token=None, idem=False, **kw):
        h = {"Authorization": f"Bearer {token or TOKEN}"}
        if idem:
            h["Idempotency-Key"] = str(uuid.uuid4())
        r = s.request(method, api + path, headers=h, timeout=30, **kw)
        if r.status_code >= 400:
            print("!!", method, path, r.status_code, r.text[:200])
            return None
        return r.json()

    r = s.post(api + "/auth/login", json={"username": a.owner, "password": a.password}, timeout=30)
    if r.status_code != 200:
        sys.exit(f"login failed: {r.text}")
    TOKEN = r.json()["access_token"]  # noqa: N806
    globals()["TOKEN"] = TOKEN

    wh = {}
    for name, code in [("Kathmandu Warehouse", "KTM"), ("Pokhara Warehouse", "PKR"), ("Biratnagar Warehouse", "BRT")]:
        w = call("POST", "/warehouses", json={"name": name, "code": code, "address": name.split()[0] + ", Nepal"})
        wh[code] = w["id"] if w else next(x["id"] for x in call("GET", "/warehouses") if x["code"] == code)

    cat_ids = {}
    def mk(name, parent=None):
        c = call("POST", "/categories", json={"name": name, "parent_id": parent})
        if c:
            cat_ids[name] = c["id"]
        return cat_ids.get(name)
    for root, subs in CATS.items():
        rid = mk(root)
        for sub, leaves in subs.items():
            sid = mk(sub, rid)
            for leaf in leaves:
                mk(leaf, sid)

    prods = {}
    for sku, name, cat, brand, unit, bc, pp, sp, mn in PRODUCTS:
        p = call("POST", "/products", json={"sku": sku, "name": name, "category_id": cat_ids.get(cat), "brand": brand, "unit": unit,
                                            "barcode": bc, "purchase_price": pp, "selling_price": sp, "min_stock": mn, "supplier": brand + " Nepal"})
        if p:
            prods[sku] = p["id"]

    stock = {"KTM": [1250, 400, 620, 150, 60, 45, 180, 90, 12, 40], "PKR": [450, 120, 210, 0, 25, 10, 60, 30, 20, 15], "BRT": [300, 80, 0, 60, 10, 0, 40, 18, 22, 8]}
    for code, qtys in stock.items():
        for (sku, *_), q in zip(PRODUCTS, qtys):
            if q and sku in prods:
                call("POST", "/stock/in", idem=True, json={"product_id": prods[sku], "warehouse_id": wh[code], "quantity": q, "note": "Opening stock"})

    for username, full, whs in [("rahul", "Rahul Shrestha", ["KTM"]), ("sita", "Sita Gurung", ["KTM", "PKR"])]:
        call("POST", "/users", json={"username": username, "full_name": full, "role": "employee", "password": "TempPass123",
                                     "warehouse_ids": [wh[c] for c in whs]})
        lr = s.post(api + "/auth/login", json={"username": username, "password": "TempPass123"}, timeout=30)
        if lr.status_code == 200:
            s.post(api + "/auth/change-password", headers={"Authorization": f"Bearer {lr.json()['access_token']}"},
                   json={"current_password": "TempPass123", "new_password": a.employee_password}, timeout=30)

    customers = {}
    for name, phone, addr, tax in [("ABC Agro Pvt Ltd", "9801234567", "Kalanki, Kathmandu", "PAN 601234567"),
                                   ("Himalayan Farmers Cooperative", "9812345678", "Lekhnath, Pokhara", None),
                                   ("Green Valley Traders", "9823456789", "Biratnagar-5", "VAT 305678912")]:
        c = call("POST", "/customers", json={"name": name, "phone": phone, "address": addr, "tax_id": tax})
        if c:
            customers[name] = c["id"]

    lr = s.post(api + "/auth/login", json={"username": "rahul", "password": a.employee_password}, timeout=30)
    if lr.status_code == 200 and customers:
        et = lr.json()["access_token"]
        for sku, q, cust, price in [("URE-50", 20, "ABC Agro Pvt Ltd", 1850), ("DAP-50", 10, "ABC Agro Pvt Ltd", 3400), ("SED-RICE-HY", 5, "Himalayan Farmers Cooperative", None)]:
            call("POST", "/stock/sale", token=et, idem=True, json={"product_id": prods[sku], "warehouse_id": wh["KTM"], "quantity": q,
                                                                  "customer_id": customers[cust], "unit_price": price})
    print("Demo data seeded:", {"warehouses": len(wh), "categories": len(cat_ids), "products": len(prods), "customers": len(customers)})


if __name__ == "__main__":
    main()
