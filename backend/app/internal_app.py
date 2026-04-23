"""Internal-only ASGI application.

Runs on port 8001 — bound to all interfaces but NOT listed in Fly.io's
[[services]] mapping, so it is only reachable over the Fly private
network (6PN / fdaa::/8) at http://ekm-backend.internal:8001.

This separation means that /api/v1/internal/* routes are never reachable
from the public internet regardless of header values, providing
defence-in-depth on top of the X-Service-Key guard.
"""

from fastapi import FastAPI

from app.routers import internal as internal_router

internal_app = FastAPI(
    title="EKM Internal API",
    # No public docs — this app is not reachable from the internet.
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

internal_app.include_router(internal_router.router)
