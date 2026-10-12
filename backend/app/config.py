"""Central configuration. Every secret/URL comes from environment variables only."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _bool(name: str, default: str = "false") -> bool:
    return str(os.environ.get(name, default)).strip().lower() in ("1", "true", "yes", "on")


# Database — MONGODB_URI preferred (Atlas), MONGO_URL supported for platform-injected configs.
MONGO_URL = os.environ.get("MONGODB_URI") or _required("MONGO_URL")
DB_NAME = _required("DB_NAME")

# Auth
JWT_SECRET = _required("JWT_SECRET")
JWT_ISSUER = os.environ.get("JWT_ISSUER", "jaykisan-api")
JWT_AUDIENCE = os.environ.get("JWT_AUDIENCE", "jaykisan-clients")
ACCESS_TOKEN_MINUTES = int(os.environ.get("ACCESS_TOKEN_MINUTES", "30"))
REFRESH_TOKEN_DAYS = int(os.environ.get("REFRESH_TOKEN_DAYS", "7"))

# Runtime
APP_ENV = os.environ.get("APP_ENV", "development")
IS_PRODUCTION = APP_ENV == "production"
BUSINESS_TZ = os.environ.get("BUSINESS_TZ", "Asia/Kathmandu")
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
TRUST_PROXY_HEADERS = _bool("TRUST_PROXY_HEADERS", "true")
# Development-only escape hatch for standalone MongoDB (no replica set). Ignored in production.
ALLOW_NON_TRANSACTIONAL_DEV = _bool("ALLOW_NON_TRANSACTIONAL_DEV")

if IS_PRODUCTION and ALLOW_NON_TRANSACTIONAL_DEV:
    raise RuntimeError(
        "ALLOW_NON_TRANSACTIONAL_DEV must be false in production."
    )
# Optional MongoDB Atlas Search index name for products (see docs/ARCHITECTURE.md).
ATLAS_SEARCH_INDEX = os.environ.get("ATLAS_SEARCH_INDEX", "")

# Emergent-managed push relay key (set by the deployment pipeline; "placeholder" in preview).
EMERGENT_PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")

# One-time owner bootstrap (only used when no owner exists). Remove after first start.
BOOTSTRAP_OWNER_USERNAME = os.environ.get("BOOTSTRAP_OWNER_USERNAME", "")
BOOTSTRAP_OWNER_PASSWORD = os.environ.get("BOOTSTRAP_OWNER_PASSWORD", "")
BOOTSTRAP_OWNER_NAME = os.environ.get("BOOTSTRAP_OWNER_NAME", "Owner")
BOOTSTRAP_OWNER_MUST_CHANGE = _bool("BOOTSTRAP_OWNER_MUST_CHANGE", "true")
