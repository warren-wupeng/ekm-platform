"""FastAPI dependency: authenticate an Agent Bearer token + scope-check.

Usage in a router::

    from app.core.agent_deps import require_agent_scope, AgentCaller

    @router.get("/kg/query")
    async def kg_query(
        agent: AgentCaller = Depends(require_agent_scope("kg:read")),
        ...
    ):
        ...

Design notes:

* Separate dependency chain from user auth — an Agent token must NOT be
  accepted on user endpoints and vice versa. We return an `AgentCaller`
  dataclass (not a `User`) so the type system catches accidental mixing
  in the router signatures.
* `last_used_at` is bumped on every successful authentication. The flush
  is deferred to the normal request-commit path (AsyncSession transaction)
  to keep the hot path on a single DB round-trip.
* Scope check is substring-free string equality. If we need hierarchy
  later (e.g. `kg:*`) we'll extend here, not at call sites.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.agent_security import extract_prefix, verify_agent_token
from app.core.database import get_db
from app.models.agent import AgentToken


# Known scopes. New entries here must be documented in the API docs.
KNOWN_SCOPES: frozenset[str] = frozenset({
    "knowledge:read",   # vector + ES search
    "kg:read",          # Neo4j read (query, path)
    "kg:write",         # KG node upsert
})


@dataclass(frozen=True)
class AgentCaller:
    """Authenticated Agent — the request-scoped view of an AgentToken.

    Frozen so handlers can't mutate credentials mid-request. We pass the
    DB row's primary key (not the row itself) to make it obvious this
    isn't a session-attached entity — side-effects like auditing should
    go through a fresh query, not this object.
    """
    token_id: int
    name: str
    scopes: frozenset[str]


_bearer = HTTPBearer(auto_error=False)


def _unauthorized(detail: str) -> HTTPException:
    # Uniform 401 — we don't reveal whether it's the prefix, the hash,
    # or the scope that failed. Returning different messages for
    # "wrong scope" vs "no such token" leaks info to an attacker probing.
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": "AGENT_UNAUTHORIZED", "message": detail},
        headers={"WWW-Authenticate": "Bearer"},
    )


async def _resolve_agent(
    credentials: HTTPAuthorizationCredentials | None,
    db: AsyncSession,
) -> AgentCaller:
    if credentials is None:
        raise _unauthorized("Missing Bearer token")

    plaintext = credentials.credentials
    prefix = extract_prefix(plaintext)
    if prefix is None:
        # Don't even hit the DB if the shape is obviously wrong.
        raise _unauthorized("Invalid Agent token")

    stmt = select(AgentToken).where(
        AgentToken.token_prefix == prefix,
        AgentToken.is_active.is_(True),
    )
    row: AgentToken | None = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise _unauthorized("Invalid Agent token")

    if row.expires_at is not None and row.expires_at < datetime.now(timezone.utc):
        raise _unauthorized("Agent token expired")

    if not verify_agent_token(plaintext, row.token_hash):
        # Prefix collision (or someone guessing) — hash mismatch is the
        # real auth check. Log nothing here to avoid noise; DB-layer
        # metrics will catch brute-force attempts.
        raise _unauthorized("Invalid Agent token")

    # Bump last_used_at. Part of the same AsyncSession so it lands on
    # the request's commit — one fewer round-trip than a separate write.
    row.last_used_at = datetime.now(timezone.utc)
    await db.flush()

    # Validate scopes against KNOWN_SCOPES — silently drop anything
    # unknown so stale DB rows don't leak privileges if we rename a scope.
    raw_scopes = row.scopes or []
    clean_scopes = frozenset(s for s in raw_scopes if s in KNOWN_SCOPES)
    return AgentCaller(token_id=row.id, name=row.name, scopes=clean_scopes)


def require_agent_scope(*required: str):
    """Build a dependency that enforces the given scope(s).

    All listed scopes must be present on the token. Multiple scopes are
    AND-combined; for OR semantics, pick one and document at the route."""
    missing_sentinel = set(required) - KNOWN_SCOPES
    if missing_sentinel:
        raise ValueError(
            f"require_agent_scope called with unknown scope(s): {missing_sentinel}"
        )

    async def _dep(
        credentials: Annotated[
            HTTPAuthorizationCredentials | None, Depends(_bearer)
        ],
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> AgentCaller:
        agent = await _resolve_agent(credentials, db)
        if not set(required).issubset(agent.scopes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "AGENT_SCOPE_FORBIDDEN",
                    "message": "Token lacks required scope",
                    # Echoing required scopes is intentional — lets the
                    # caller fix their provisioning. Unlike the 401 path,
                    # here we already know the token is valid.
                    "required": sorted(required),
                },
            )
        return agent

    return _dep
