"""Notifications — REST + WebSocket.

REST (under Bearer auth):
  GET    /api/v1/notifications                list (paginated; filter unread)
  GET    /api/v1/notifications/unread-count   int
  PATCH  /api/v1/notifications/{id}/read      mark one read
  PATCH  /api/v1/notifications/read-all       mark everything read

WebSocket:
  WS     /api/v1/ws/notifications?token=<access_token>

Auth on WS: the browser EventSource/WebSocket API can't easily set the
Authorization header for raw ws:// upgrades, so we accept the access
token via query param. Same token, same validator, just a different
carrier. We resolve the user *before* ws.accept() so an invalid token
gets a clean 1008 close.

On connect:
  1. validate token → user
  2. accept socket + register with ConnectionManager
  3. flush any unread notifications created before now (offline backlog)
  4. idle — live pushes come via notify.dispatch()
  5. read client frames for heartbeat ping + client-originated `ack:{id}`
     that marks a notification read without a REST roundtrip.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from sqlalchemy import func, select, update

from app.core.database import AsyncSessionLocal
from app.core.deps import DB, CurrentUser
from app.core.ws import manager
from app.models.notification import Notification
from app.services.auth import AuthError, get_current_user

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["notifications"])


# ─── REST endpoints ────────────────────────────────────────────────────────
@router.get("/notifications")
async def list_notifications(
    db: DB,
    user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    unread_only: bool = False,
):
    q = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        q = q.where(Notification.read_at.is_(None))

    total_q = select(func.count()).select_from(Notification).where(Notification.user_id == user.id)
    if unread_only:
        total_q = total_q.where(Notification.read_at.is_(None))
    total = (await db.execute(total_q)).scalar_one()

    rows = (
        (
            await db.execute(
                q.order_by(Notification.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        .scalars()
        .all()
    )

    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "notifications": [n.to_dict() for n in rows],
    }


@router.get("/notifications/unread-count")
async def unread_count(db: DB, user: CurrentUser):
    total = (
        await db.execute(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        )
    ).scalar_one()
    return {"unread": total}


@router.patch("/notifications/{notification_id}/read")
async def mark_read(notification_id: int, db: DB, user: CurrentUser):
    n = (
        await db.execute(
            select(Notification).where(
                Notification.id == notification_id,
                Notification.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if n is None:
        raise HTTPException(status_code=404, detail="notification not found")
    if n.read_at is None:
        n.read_at = datetime.now(UTC)
        await db.flush()
    return n.to_dict()


@router.patch("/notifications/read-all")
async def mark_all_read(db: DB, user: CurrentUser):
    # Single UPDATE — avoids loading every row.
    result = await db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(UTC))
    )
    return {"updated": result.rowcount or 0}


# ─── WebSocket endpoint ────────────────────────────────────────────────────
@router.websocket("/ws/notifications")
async def ws_notifications(websocket: WebSocket, token: str = Query(...)):
    # 1. Auth before accept — invalid tokens get closed cleanly.
    async with AsyncSessionLocal() as session:
        try:
            user = await get_current_user(session, token)
        except AuthError:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    # 2. Accept + register.
    await websocket.accept()
    await manager.connect(user.id, websocket)
    log.info("WS connected: user=%s online=%d", user.id, manager.online_count())

    try:
        # 3. Offline backlog — flush unread notifications the user missed.
        async with AsyncSessionLocal() as session:
            rows = (
                (
                    await session.execute(
                        select(Notification)
                        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
                        .order_by(Notification.created_at.asc())
                        .limit(200)  # cap — if they've accumulated more, list API fills the rest
                    )
                )
                .scalars()
                .all()
            )

        if rows:
            backlog = {
                "kind": "backlog",
                "notifications": [n.to_dict() for n in rows],
            }
            await websocket.send_text(json.dumps(backlog, ensure_ascii=False, default=str))

        # 4. Main loop — read client frames for heartbeat + ack.
        while True:
            raw = await websocket.receive_text()
            msg = _parse_client_frame(raw)
            if msg is None:
                continue
            op = msg.get("op")
            if op == "ping":
                await websocket.send_text(json.dumps({"kind": "pong"}))
            elif op == "ack":
                # Client-originated mark-read — saves a REST roundtrip.
                nid = msg.get("id")
                if isinstance(nid, int):
                    await _mark_read_background(user.id, nid)

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.info("WS closing for user=%s: %s", user.id, exc)
    finally:
        await manager.disconnect(user.id, websocket)
        log.info("WS disconnected: user=%s online=%d", user.id, manager.online_count())


def _parse_client_frame(raw: str) -> dict | None:
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


async def _mark_read_background(user_id: int, notification_id: int) -> None:
    """Mark one notification as read without touching the WS session.

    Fire-and-forget from the WS loop; errors are swallowed (the REST
    endpoint exists as a fallback).
    """
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(
                update(Notification)
                .where(
                    Notification.id == notification_id,
                    Notification.user_id == user_id,
                    Notification.read_at.is_(None),
                )
                .values(read_at=datetime.now(UTC))
            )
            await session.commit()
    except Exception as exc:
        log.info("WS-ack mark_read failed: %s", exc)
