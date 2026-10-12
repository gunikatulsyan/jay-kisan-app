"""Jay Kisan Inventory API — standalone FastAPI application (deployable without Emergent)."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.cors import CORSMiddleware

from . import config, push
from .bootstrap import bootstrap_owner
from .db import client, detect_transactions, ensure_schema
from .realtime import router as ws_router
from .routers import (
    audit,
    auth,
    categories,
    customers,
    exports,
    health,
    imports,
    inventory,
    notifications,
    products,
    reports,
    settings,
    stock,
    transactions,
    users,
    warehouses,
)
from .utils import AppError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("jaykisan")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await ensure_schema()
    await detect_transactions()
    await bootstrap_owner()
    yield
    client.close()


app = FastAPI(
    title="Jay Kisan Inventory API",
    version="1.0.0",
    description="Inventory, sales, transfers and audit API for Jay Kisan. All endpoints are versioned under /api/v1.",
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)


def _err(status: int, code: str, message: str, details=None):
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "details": details}})


@app.exception_handler(AppError)
async def app_error_handler(_req: Request, exc: AppError):
    return _err(exc.status, exc.code, exc.message, exc.details)


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_req: Request, exc: StarletteHTTPException):
    return _err(exc.status_code, "HTTP_ERROR", str(exc.detail))


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_req: Request, exc: RequestValidationError):
    fields = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
    first = fields[0] if fields else {"field": "", "message": "Invalid request"}
    msg = f"{first['field']}: {first['message']}" if first["field"] else first["message"]
    return _err(422, "VALIDATION_ERROR", msg, {"fields": fields})


@app.exception_handler(Exception)
async def unhandled_error_handler(_req: Request, exc: Exception):
    log.exception("Unhandled error: %s", exc)
    return _err(500, "INTERNAL_ERROR", "Something went wrong. Please try again.")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


for module in (auth, users, warehouses, categories, products, inventory, stock, transactions, customers,
               notifications, audit, reports, exports, imports, settings):
    app.include_router(module.router, prefix="/api/v1")
app.include_router(ws_router, prefix="/api/v1")
app.include_router(push.router)
app.include_router(health.router)

origins = config.CORS_ORIGINS
if config.IS_PRODUCTION and "*" in origins:
    raise RuntimeError("CORS_ORIGINS must list explicit origins in production (no '*').")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
)
