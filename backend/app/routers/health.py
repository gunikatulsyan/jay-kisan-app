from fastapi import APIRouter
from fastapi.responses import JSONResponse

from .. import config
from ..db import client, state

router = APIRouter(tags=["health"])


@router.get("/api/health", summary="Liveness probe")
@router.get("/api/v1/health", include_in_schema=False)
async def health():
    return {"status": "ok", "service": "jaykisan-api", "version": "1.0.0"}


@router.get("/api/v1/ready", summary="Readiness probe (database + transaction support)")
async def ready():
    try:
        await client.admin.command("ping")
        db_ok = True
    except Exception:
        db_ok = False
    body = {
        "status": "ready" if db_ok else "unavailable",
        "database": "ok" if db_ok else "unreachable",
        "transactions_supported": state["tx_supported"],
        "non_transactional_dev_mode": state["non_tx_mode"],
        "environment": config.APP_ENV,
        "stock_writes_enabled": state["tx_supported"] or state["non_tx_mode"],
    }
    return JSONResponse(body, status_code=200 if db_ok else 503)
