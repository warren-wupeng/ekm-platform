from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.routers import health


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: could run DB migrations, warm caches, etc.
    yield
    # Shutdown: clean up connections
    from app.core.database import engine
    await engine.dispose()


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

# Placeholder stubs — will be filled in as each feature issue is implemented
# app.include_router(auth.router,       prefix="/api/v1/auth",      tags=["auth"])
# app.include_router(users.router,      prefix="/api/v1/users",     tags=["users"])
# app.include_router(knowledge.router,  prefix="/api/v1/knowledge", tags=["knowledge"])
# app.include_router(sharing.router,    prefix="/api/v1/sharing",   tags=["sharing"])
# app.include_router(kg.router,         prefix="/api/v1/kg",        tags=["knowledge-graph"])


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": {"code": "INTERNAL_ERROR", "message": str(exc)}},
    )
