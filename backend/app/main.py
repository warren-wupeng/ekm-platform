from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
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
    yield
    # Shutdown: clean up connections
    from app.core.database import engine
    await engine.dispose()
    try:
        from app.services.es_client import es
        await es.close()
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

# Placeholder stubs — will be filled in as each feature issue is implemented
# app.include_router(users.router,      prefix="/api/v1/users",     tags=["users"])
# app.include_router(knowledge.router,  prefix="/api/v1/knowledge", tags=["knowledge"])
# app.include_router(kg.router,         prefix="/api/v1/kg",        tags=["knowledge-graph"])


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": {"code": "INTERNAL_ERROR", "message": str(exc)}},
    )
