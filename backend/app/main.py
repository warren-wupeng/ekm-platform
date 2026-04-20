from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.config import settings
from app.core.rate_limit import limiter
from app.routers import health
from app.routers import auth
from app.routers import files
from app.routers import sharing
from app.routers import tasks
from app.routers import documents
from app.routers import search
from app.routers import chat
from app.routers import categories
from app.routers import tags
from app.routers import versions
from app.routers import community
from app.routers import ai
from app.routers import feedback
from app.routers import graph as graph_router
from app.routers import notifications
from app.routers import archive as archive_router
from app.routers import restore as restore_router
from app.routers import batch as batch_router
from app.routers import agent as agent_router
from app.routers import kg as kg_router
from app.routers import chunk_history as chunk_history_router
from app.routers import kg_review as kg_review_router
from app.routers import admin_reparse as admin_reparse_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure ES indexes exist (idempotent).
    import logging
    log = logging.getLogger(__name__)
    try:
        from app.services.es_client import es
        await es.ensure_indexes()
    except Exception as e:
        # Don't block startup if ES is temporarily down — search degrades
        # gracefully, and the next restart will retry index creation.
        log.warning("ES index bootstrap skipped: %s", e)
    try:
        from app.core.graph import graph
        await graph.ensure_constraints()
        from app.routers.kg import ensure_fulltext_index
        await ensure_fulltext_index()
    except Exception as e:
        # Same principle as ES: graph is a degradable feature.
        log.warning("Neo4j bootstrap skipped: %s", e)
    yield
    # Shutdown: clean up connections
    from app.core.database import engine
    await engine.dispose()
    try:
        from app.services.es_client import es
        await es.close()
    except Exception:
        pass
    try:
        from app.core.graph import graph
        await graph.close()
    except Exception:
        pass


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# Rate limiting (Agent API)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(files.router)
app.include_router(sharing.router)
app.include_router(tasks.router)
app.include_router(documents.router)
app.include_router(search.router)
app.include_router(chat.router)
app.include_router(categories.router)
app.include_router(tags.router)
app.include_router(versions.router)
for _r in community.routers:
    app.include_router(_r)
app.include_router(ai.router)
for _r in feedback.routers:
    app.include_router(_r)
app.include_router(graph_router.router)
app.include_router(notifications.router)
app.include_router(archive_router.router)
app.include_router(restore_router.router)
app.include_router(batch_router.router)
app.include_router(agent_router.router)
app.include_router(kg_router.router)
app.include_router(chunk_history_router.router)
app.include_router(kg_review_router.router)
app.include_router(admin_reparse_router.router)

# Placeholder stubs — will be filled in as each feature issue is implemented
# app.include_router(users.router,      prefix="/api/v1/users",     tags=["users"])
# app.include_router(knowledge.router,  prefix="/api/v1/knowledge", tags=["knowledge"])


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": {"code": "INTERNAL_ERROR", "message": str(exc)}},
    )
