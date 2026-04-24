"""Rate limiting for the Agent API.

Uses slowapi with an in-memory backend (sufficient for single-instance
deployments). If we scale horizontally, swap to the Redis backend via
``Limiter(storage_uri=settings.REDIS_URL)``.

Key function: extracts the Agent Bearer token prefix from the
Authorization header so each provisioned token has its own rate bucket.
Falls back to client IP when no Bearer token is present (pre-auth
rejection still gets rate-limited to prevent brute-force probing).
"""

from __future__ import annotations

from slowapi import Limiter
from starlette.requests import Request

from app.core.agent_security import TOKEN_PREFIX_SIGIL


def _agent_key(request: Request) -> str:
    """Extract rate-limit key: token prefix or client IP."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        # Token format: ekmat_<48 hex>. Prefix = first 12 chars.
        if token.startswith(TOKEN_PREFIX_SIGIL) and len(token) >= 12:
            return f"agent:{token[:12]}"
    return f"ip:{request.client.host if request.client else 'unknown'}"


limiter = Limiter(key_func=_agent_key)

# Default rate for all agent endpoints. Individual routes can override.
AGENT_RATE = "60/minute"
