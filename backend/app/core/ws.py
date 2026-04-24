"""Per-user WebSocket connection registry.

A single process holds a mapping `user_id → set[WebSocket]`. Publishing
to a user fans out to every live socket that user has open (multiple
tabs, desktop + phone, etc.).

Multi-process note: in a single-replica dev deployment this is fine.
When we scale to >1 backend replica, swap the in-memory `_peers` for a
Redis pub/sub bridge — the public interface (`connect`/`disconnect`/
`send_to_user`) stays the same. Until then, keep it simple.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

log = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._peers: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, user_id: int, ws: WebSocket) -> None:
        """Register an already-accepted WebSocket for `user_id`.

        Caller is responsible for ws.accept() (so auth can deny BEFORE
        registering).
        """
        async with self._lock:
            self._peers[user_id].add(ws)

    async def disconnect(self, user_id: int, ws: WebSocket) -> None:
        async with self._lock:
            peers = self._peers.get(user_id)
            if peers is None:
                return
            peers.discard(ws)
            if not peers:
                self._peers.pop(user_id, None)

    async def send_to_user(self, user_id: int, payload: dict[str, Any]) -> int:
        """Fan out `payload` to every live socket for `user_id`.

        Returns the count of sockets successfully written to. Dead sockets
        are dropped silently — they'll clean themselves up next heartbeat.
        """
        peers = list(self._peers.get(user_id, ()))
        if not peers:
            return 0

        text = json.dumps(payload, ensure_ascii=False, default=str)
        ok = 0
        for ws in peers:
            try:
                await ws.send_text(text)
                ok += 1
            except Exception as exc:
                log.info("WS send failed for user=%s: %s — dropping", user_id, exc)
                # Best-effort cleanup; the endpoint's finally-block also unregisters.
                await self.disconnect(user_id, ws)
        return ok

    def online_count(self) -> int:
        return len(self._peers)


# Module-level singleton. Process-local — see docstring for scaling note.
manager = ConnectionManager()
