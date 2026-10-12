import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://jaykisan-inventory.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api/v1"

OWNER = {"username": "owner", "password": "JayKisan@2026"}
RAHUL = {"username": "rahul", "password": "Rahul@2026"}   # KTM only
SITA = {"username": "sita", "password": "Rahul@2026"}     # KTM + PKR


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def api():
    return API


@pytest.fixture(scope="session")
def owner_token():
    return _login(OWNER)


@pytest.fixture(scope="session")
def rahul_token():
    return _login(RAHUL)


@pytest.fixture(scope="session")
def sita_token():
    return _login(SITA)


def auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
