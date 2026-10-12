"""Push registration & non-blocking dispatch tests.

Endpoint under test: POST /api/register-push (NOT /api/v1/*). In preview
EMERGENT_PUSH_KEY='placeholder' so the upstream relay returns 401 -> we should
surface 500 PUSH_NOT_CONFIGURED, and stock/sale must still return 200 (push
dispatch is fire-and-forget)."""
import os
import uuid

import pytest
import requests

from conftest import API, auth

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://jaykisan-inventory.preview.emergentagent.com").rstrip("/")
PUSH_URL = f"{BASE_URL}/api/register-push"


def _me(token):
    r = requests.get(f"{API}/auth/me", headers=auth(token), timeout=10)
    r.raise_for_status()
    d = r.json()
    return (d.get("user") or d)["id"]


# ---- /api/register-push ----
def test_register_push_no_auth_401():
    r = requests.post(PUSH_URL, json={"user_id": "x", "platform": "android", "device_token": "tok"}, timeout=10)
    assert r.status_code == 401, r.text


def test_register_push_wrong_user_id_403(rahul_token):
    body = {"user_id": "000000000000000000000000", "platform": "android", "device_token": "tok-123"}
    r = requests.post(PUSH_URL, headers=auth(rahul_token), json=body, timeout=10)
    assert r.status_code == 403, r.text
    assert (r.json().get("error") or {}).get("code") == "FORBIDDEN"


def test_register_push_invalid_platform_422(owner_token):
    uid = _me(owner_token)
    body = {"user_id": uid, "platform": "windows", "device_token": "tok-xyz"}
    r = requests.post(PUSH_URL, headers=auth(owner_token), json=body, timeout=10)
    assert r.status_code == 422, r.text


def test_register_push_placeholder_key_returns_500_push_not_configured(owner_token):
    uid = _me(owner_token)
    body = {"user_id": uid, "platform": "android", "device_token": "tok-preview-1"}
    r = requests.post(PUSH_URL, headers=auth(owner_token), json=body, timeout=15)
    assert r.status_code == 500, r.text
    code = (r.json().get("error") or {}).get("code")
    assert code == "PUSH_NOT_CONFIGURED", f"expected PUSH_NOT_CONFIGURED got {code}: {r.text}"


# ---- Non-blocking dispatch: employee sale still 200 even though push relay 401s ----
def _find_ktm_product_with_stock(owner_token, min_qty=1):
    ws = requests.get(f"{API}/warehouses", headers=auth(owner_token)).json()
    ktm = next(w for w in ws if w["code"] == "KTM")
    inv = requests.get(f"{API}/inventory", headers=auth(owner_token),
                       params={"warehouse_id": ktm["id"], "page": 1, "page_size": 50}).json()
    for item in inv["items"]:
        if item.get("quantity", 0) >= min_qty:
            return item, ktm
    return None, ktm


def test_sale_still_succeeds_despite_push_failure(rahul_token, owner_token):
    item, ktm = _find_ktm_product_with_stock(owner_token, 1)
    assert item is not None, "No KTM inventory with stock >= 1"
    pid = item.get("product_id") or item.get("product", {}).get("id")
    cust_list = requests.get(f"{API}/customers", headers=auth(owner_token),
                             params={"page": 1, "page_size": 1}).json().get("items", [])
    assert cust_list, "Need a customer for sale test"
    payload = {"product_id": pid, "warehouse_id": ktm["id"], "quantity": 1, "customer_id": cust_list[0]["id"]}
    headers = {**auth(rahul_token), "Idempotency-Key": f"test-push-nb-{uuid.uuid4().hex}"}
    r = requests.post(f"{API}/stock/sale", headers=headers, json=payload, timeout=20)
    assert r.status_code == 200, f"Sale should succeed even when push relay fails: {r.status_code} {r.text}"
    assert "transaction" in r.json()
