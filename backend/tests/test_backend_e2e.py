import os
import uuid
import pytest
import requests
from conftest import API, auth


# --- Health ---
def test_health():
    r = requests.get(f"{API}/health", timeout=10)
    assert r.status_code == 200


# --- Auth ---
def test_login_wrong_password():
    r = requests.post(f"{API}/auth/login", json={"username": "owner", "password": "WRONG"}, timeout=10)
    assert r.status_code == 401


def test_login_owner_success(owner_token):
    assert owner_token and isinstance(owner_token, str)


def test_me_owner(owner_token):
    r = requests.get(f"{API}/auth/me", headers=auth(owner_token), timeout=10)
    assert r.status_code == 200
    d = r.json()
    u = d.get("user") or d
    assert u.get("role") == "owner"
    assert u.get("username") == "owner"


def test_me_employee(rahul_token):
    r = requests.get(f"{API}/auth/me", headers=auth(rahul_token), timeout=10)
    assert r.status_code == 200
    d = r.json()
    u = d.get("user") or d
    assert u.get("role") == "employee"
    wh = d.get("warehouses") or []
    assert wh, "Rahul should have at least one assigned warehouse"


# --- Warehouses ---
def test_warehouses_owner_sees_all(owner_token):
    r = requests.get(f"{API}/warehouses", headers=auth(owner_token), timeout=10)
    assert r.status_code == 200
    ws = r.json()
    assert isinstance(ws, list) and len(ws) >= 2
    codes = [w.get("code") for w in ws]
    assert "KTM" in codes


def test_warehouses_rahul_limited(rahul_token):
    r = requests.get(f"{API}/warehouses", headers=auth(rahul_token), timeout=10)
    assert r.status_code == 200
    ws = r.json()
    codes = [w.get("code") for w in ws]
    # Rahul: KTM only
    assert "KTM" in codes
    assert "PKR" not in codes, f"Rahul should not see PKR, got: {codes}"


def test_warehouses_sita_two(sita_token):
    r = requests.get(f"{API}/warehouses", headers=auth(sita_token), timeout=10)
    assert r.status_code == 200
    codes = sorted([w.get("code") for w in r.json()])
    assert set(codes) >= {"KTM", "PKR"}, f"Sita should see KTM+PKR, got: {codes}"


# --- Products lookup / list ---
def test_product_lookup_by_barcode(owner_token):
    r = requests.get(f"{API}/products/lookup", headers=auth(owner_token),
                     params={"code": "8901000000011"}, timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("product") is not None


def test_products_list_pagination(owner_token):
    r = requests.get(f"{API}/products", headers=auth(owner_token),
                     params={"limit": 5}, timeout=10)
    assert r.status_code == 200
    d = r.json()
    assert "items" in d
    assert len(d["items"]) <= 5


def test_products_search(owner_token):
    r = requests.get(f"{API}/products", headers=auth(owner_token),
                     params={"search": "Urea", "limit": 10}, timeout=10)
    assert r.status_code == 200
    d = r.json()
    assert len(d["items"]) >= 1
    names = " ".join([p["name"] for p in d["items"]]).lower()
    assert "urea" in names


# --- RBAC: employee cannot access owner endpoints ---
def test_employee_cannot_stock_in(rahul_token, owner_token):
    # First get a valid product/warehouse
    p = requests.get(f"{API}/products", headers=auth(owner_token), params={"limit": 1}).json()["items"][0]
    w = requests.get(f"{API}/warehouses", headers=auth(rahul_token)).json()[0]
    headers = {**auth(rahul_token), "Idempotency-Key": f"test-si-{uuid.uuid4().hex}"}
    r = requests.post(f"{API}/stock/in", headers=headers,
                      json={"product_id": p["id"], "warehouse_id": w["id"], "quantity": 1}, timeout=10)
    assert r.status_code in (401, 403), f"Employee stock_in should be forbidden, got {r.status_code}"


def test_employee_cannot_view_reports(rahul_token):
    r = requests.get(f"{API}/reports/dashboard", headers=auth(rahul_token), timeout=10)
    assert r.status_code in (401, 403)


def test_employee_cannot_list_users(rahul_token):
    r = requests.get(f"{API}/users", headers=auth(rahul_token), timeout=10)
    assert r.status_code in (401, 403)


# --- Owner dashboard ---
def test_dashboard_loads(owner_token):
    r = requests.get(f"{API}/reports/dashboard", headers=auth(owner_token), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    # Must include product / stock / revenue KPIs
    keys = set(d.keys())
    assert any(k in keys for k in ["products", "product_count", "total_products", "kpis"])


# --- Inventory ---
def test_inventory_list(owner_token):
    r = requests.get(f"{API}/inventory", headers=auth(owner_token),
                     params={"page": 1, "page_size": 20}, timeout=10)
    assert r.status_code == 200
    assert "items" in r.json()


# --- Notifications ---
def test_notifications_unread_count(owner_token):
    r = requests.get(f"{API}/notifications/unread-count", headers=auth(owner_token), timeout=10)
    assert r.status_code == 200
    assert "count" in r.json() or "unread" in r.json() or isinstance(r.json(), dict)


def test_notifications_list(owner_token):
    r = requests.get(f"{API}/notifications", headers=auth(owner_token),
                     params={"page": 1, "page_size": 10}, timeout=10)
    assert r.status_code == 200
    assert "items" in r.json()


# --- Employee sale flow (rahul, KTM) ---
def _find_ktm_product_with_stock(owner_token, min_qty=5):
    """Find a product+warehouse where KTM has stock."""
    ws = requests.get(f"{API}/warehouses", headers=auth(owner_token)).json()
    ktm = next(w for w in ws if w["code"] == "KTM")
    inv = requests.get(f"{API}/inventory", headers=auth(owner_token),
                       params={"warehouse_id": ktm["id"], "page": 1, "page_size": 50}).json()
    for item in inv["items"]:
        if item.get("quantity", 0) >= min_qty:
            return item, ktm
    return None, ktm


def test_rahul_sale_success(rahul_token, owner_token):
    item, ktm = _find_ktm_product_with_stock(owner_token, 5)
    assert item is not None, "No KTM inventory with stock >= 5"
    pid = item.get("product_id") or item.get("product", {}).get("id")
    before_qty = item["quantity"]
    # Grab a customer (setting: require_customer_for_sale=true by default)
    cust_list = requests.get(f"{API}/customers", headers=auth(owner_token),
                             params={"page": 1, "page_size": 1}).json().get("items", [])
    assert cust_list, "Need at least one customer for sale test"
    customer_id = cust_list[0]["id"]
    payload = {"product_id": pid, "warehouse_id": ktm["id"], "quantity": 1, "customer_id": customer_id}
    headers = {**auth(rahul_token), "Idempotency-Key": f"test-sale-{uuid.uuid4().hex}"}
    r = requests.post(f"{API}/stock/sale", headers=headers, json=payload, timeout=15)
    assert r.status_code == 200, f"Sale failed: {r.status_code} {r.text}"
    d = r.json()
    assert "transaction" in d
    # Verify stock decreased
    inv2 = requests.get(f"{API}/inventory", headers=auth(owner_token),
                        params={"warehouse_id": ktm["id"], "product_id": pid, "page": 1, "page_size": 5}).json()
    match = [i for i in inv2["items"] if (i.get("product_id") or i.get("product", {}).get("id")) == pid]
    if match:
        assert match[0]["quantity"] == before_qty - 1, "Stock did not decrement by 1"


def test_rahul_sale_over_available_rejected(rahul_token, owner_token):
    item, ktm = _find_ktm_product_with_stock(owner_token, 1)
    assert item is not None
    pid = item.get("product_id") or item.get("product", {}).get("id")
    cust = requests.get(f"{API}/customers", headers=auth(owner_token), params={"page": 1, "page_size": 1}).json()["items"][0]
    headers = {**auth(rahul_token), "Idempotency-Key": f"test-over-{uuid.uuid4().hex}"}
    r = requests.post(f"{API}/stock/sale", headers=headers,
                      json={"product_id": pid, "warehouse_id": ktm["id"], "quantity": 99999999,
                            "customer_id": cust["id"]}, timeout=15)
    assert r.status_code in (400, 409, 422), f"Should reject over-sale, got {r.status_code}: {r.text}"


def test_rahul_cannot_sell_from_pokhara(rahul_token, owner_token):
    ws = requests.get(f"{API}/warehouses", headers=auth(owner_token)).json()
    pkr = next((w for w in ws if w["code"] == "PKR"), None)
    assert pkr is not None
    p = requests.get(f"{API}/products", headers=auth(owner_token), params={"limit": 1}).json()["items"][0]
    cust = requests.get(f"{API}/customers", headers=auth(owner_token), params={"page": 1, "page_size": 1}).json()["items"][0]
    headers = {**auth(rahul_token), "Idempotency-Key": f"test-pkr-{uuid.uuid4().hex}"}
    r = requests.post(f"{API}/stock/sale", headers=headers,
                      json={"product_id": p["id"], "warehouse_id": pkr["id"], "quantity": 1,
                            "customer_id": cust["id"]}, timeout=15)
    assert r.status_code in (401, 403, 404, 422), f"Rahul should not sell from PKR, got {r.status_code}"


# --- Transactions list ---
def test_transactions_list_owner(owner_token):
    r = requests.get(f"{API}/transactions", headers=auth(owner_token),
                     params={"page": 1, "page_size": 10}, timeout=10)
    assert r.status_code == 200
    assert "items" in r.json()


# --- Categories / Customers ---
def test_categories_list(owner_token):
    r = requests.get(f"{API}/categories", headers=auth(owner_token), timeout=10)
    assert r.status_code == 200


def test_customers_list(owner_token):
    r = requests.get(f"{API}/customers", headers=auth(owner_token),
                     params={"page": 1, "page_size": 10}, timeout=10)
    assert r.status_code == 200
    assert "items" in r.json()


# --- Audit (owner-only) ---
def test_audit_owner(owner_token):
    r = requests.get(f"{API}/audit", headers=auth(owner_token),
                     params={"page": 1, "page_size": 10}, timeout=10)
    assert r.status_code == 200
