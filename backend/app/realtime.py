"""WebSocket real-time delivery. Events are emitted only AFTER the database commit succeeds.
MongoDB stays the source of truth: clients re-sync via REST on (re)connect.
Single-instance fan-out; for multiple replicas use Redis pub/sub or MongoDB change streams (see docs)."""
import asyncio
import json
import logging
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .utils import AppError

log = logging.getLogger("jaykisan.realtime")
router = APIRouter()

MAX_PER_USER = 5
MAX_TOTAL = 2000


class Conn:
    __slots__ = ("ws", "user_id", "role", "warehouse_ids", "exp")

    def __init__(self, ws, user, exp):
        self.ws = ws
        self.user_id = str(user["_id"])
        self.role = user["role"]
        self.warehouse_ids = {str(w) for w in user.get("warehouse_ids") or []}
        self.exp = exp


class Manager:
    def __init__(self):
        self.conns: set[Conn] = set()

    def count_user(self, uid: str) -> int:
        return sum(1 for c in self.conns if c.user_id == uid)

    def _targets(self, event: dict):
        scope = event["scope"]
        for c in list(self.conns):
            if scope == "user" and c.user_id == event["user_id"]:
                yield c
            elif scope == "owners" and c.role == "owner":
                yield c
            elif scope == "warehouse" and (c.role == "owner" or event["warehouse_id"] in c.warehouse_ids):
                yield c

    async def emit(self, events: list):
        for event in events or []:
            text = json.dumps(event["payload"])
            for c in self._targets(event):
                try:
                    await c.ws.send_text(text)
                except Exception:
                    self.conns.discard(c)


manager = Manager()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    from .security import load_user_from_token

    await ws.accept()
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=10)
        msg = json.loads(raw)
        if msg.get("type") != "auth" or not msg.get("token"):
            raise AppError(401, "UNAUTHENTICATED", "auth required")
        user, payload = await load_user_from_token(msg["token"])
    except Exception:
        await ws.close(code=4401)
        return
    if manager.count_user(str(user["_id"])) >= MAX_PER_USER or len(manager.conns) >= MAX_TOTAL:
        await ws.send_text(json.dumps({"type": "error", "code": "TOO_MANY_CONNECTIONS"}))
        await ws.close(code=4429)
        return
    conn = Conn(ws, user, payload["exp"])
    manager.conns.add(conn)
    await ws.send_text(json.dumps({"type": "ready"}))
    try:
        while True:
            remaining = conn.exp - time.time()
            if remaining <= 0:
                await ws.close(code=4001)  # token expired -> client refreshes and reconnects
                break
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=min(remaining, 60))
            except asyncio.TimeoutError:
                continue
            if raw == "ping" or '"ping"' in raw:
                await ws.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        pass
    except Exception as e:  # noqa: BLE001
        log.debug("ws closed: %s", e)
    finally:
        manager.conns.discard(conn)
