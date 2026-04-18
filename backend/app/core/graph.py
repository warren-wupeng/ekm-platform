"""Neo4j async driver singleton.

The Postgres `kg_nodes` / `kg_edges` tables are our *canonical* graph store
(we want transactional guarantees alongside knowledge items + users).
Neo4j is the *traversal engine* — same data, projected into a graph-native
shape so Cypher queries (k-hop, pattern matching, shortest-path) run fast.

This module only owns the connection and low-level helpers. Sync from
Postgres → Neo4j lives in services/graph_sync.py.

Health is lazy: we never call the DB at import time. The first call opens
the driver; subsequent calls reuse it. Failed sessions are swallowed with a
warning — the platform must stay up if the graph is down; graph features
just degrade.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from neo4j import AsyncDriver, AsyncGraphDatabase, AsyncSession

from app.core.config import settings

log = logging.getLogger(__name__)


class Neo4jClient:
    def __init__(self) -> None:
        self._driver: AsyncDriver | None = None

    def _ensure_driver(self) -> AsyncDriver:
        if self._driver is None:
            self._driver = AsyncGraphDatabase.driver(
                settings.NEO4J_URL,
                auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
                # Conservative pool — this is an internal tool, not web-scale.
                max_connection_pool_size=20,
                connection_acquisition_timeout=10,
            )
        return self._driver

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        driver = self._ensure_driver()
        async with driver.session() as s:
            yield s

    async def run(
        self,
        cypher: str,
        params: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Run a Cypher statement and return all records as dicts.

        Good for small result sets (entity fetch, single relationship walk).
        For larger traversals open a session via `session()` and iterate.
        """
        async with self.session() as s:
            result = await s.run(cypher, params or {})
            records = [r.data() async for r in result]
            return records

    async def healthcheck(self) -> bool:
        """Return True if Neo4j responds to a trivial Cypher ping."""
        try:
            rows = await self.run("RETURN 1 AS ok")
            return bool(rows) and rows[0].get("ok") == 1
        except Exception as exc:  # noqa: BLE001 — degradation, not crash
            log.warning("Neo4j healthcheck failed: %s", exc)
            return False

    async def ensure_constraints(self) -> None:
        """Idempotent: create the uniqueness constraints we rely on.

        Called at startup; safe to re-run because Cypher uses IF NOT EXISTS.
        """
        statements = [
            # Entities are identified by external_id (matches kg_nodes.external_id
            # in Postgres — same string, different engine).
            "CREATE CONSTRAINT entity_external_id IF NOT EXISTS "
            "FOR (n:Entity) REQUIRE n.external_id IS UNIQUE",
            # KnowledgeItem nodes are indexed by their Postgres primary key.
            "CREATE CONSTRAINT knowledge_item_id IF NOT EXISTS "
            "FOR (n:KnowledgeItem) REQUIRE n.id IS UNIQUE",
        ]
        for stmt in statements:
            try:
                await self.run(stmt)
            except Exception as exc:  # noqa: BLE001
                log.warning("Failed to apply constraint: %s (%s)", stmt, exc)

    async def close(self) -> None:
        if self._driver is not None:
            await self._driver.close()
            self._driver = None


# Module-level singleton. Threadsafe — the driver itself is.
graph = Neo4jClient()
