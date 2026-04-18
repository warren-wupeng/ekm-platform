"""Notification dispatch.

Produces a single entry point `dispatch(db, user_id, type, payload, title)`
that:
  1. Inserts a row into the `notifications` table (durable — backfills
     on next WS connect if the user is offline).
  2. Pushes the same payload over WebSocket if the user is online.

Errors on step 2 are swallowed — the DB row is authoritative, and the
user will receive it next time they connect. Same degradable pattern as
ES / Neo4j.

The DB insert is done inside the caller's transaction so the event only
lands if the business write (reply create, like, etc.) also succeeded.
Keep this function cheap and side-effect-clean.
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ws import manager
from app.models.notification import Notification, NotificationType

log = logging.getLogger(__name__)


async def dispatch(
    db: AsyncSession,
    *,
    user_id: int,
    type: NotificationType,
    payload: dict[str, Any],
    title: str | None = None,
) -> Notification:
    """Persist one notification and push it live if the recipient is online.

    Caller owns the transaction — we only `db.add` + `flush`, the commit
    lives with the business write (e.g. create_reply).
    """
    n = Notification(
        user_id=user_id,
        type=type,
        payload=payload,
        title=title,
    )
    db.add(n)
    await db.flush()  # populate n.id + n.created_at

    # Live push — cheap if nobody's listening, harmless if it fails.
    try:
        await manager.send_to_user(user_id, {
            "kind": "notification",
            "data": _serialize(n),
        })
    except Exception as exc:  # noqa: BLE001
        log.warning("live push failed for user=%s: %s", user_id, exc)

    return n


def _serialize(n: Notification) -> dict[str, Any]:
    return {
        "id": n.id,
        "type": n.type.value,
        "title": n.title,
        "payload": n.payload,
        "read": n.read_at is not None,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }
