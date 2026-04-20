from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # App
    APP_NAME: str = "EKM API"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://ekm:ekm@localhost:5432/ekm"
    DATABASE_SSL: bool = False  # Set True when using external Postgres with SSL

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # Celery
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    # Search / Vector / Graph
    ELASTICSEARCH_URL: str = "http://localhost:9200"
    QDRANT_URL: str = "http://localhost:6333"
    NEO4J_URL: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = "ekm_neo4j_pw"

    # Document parsing
    TIKA_URL: str = "http://localhost:9998"

    # LLM (LiteLLM)
    LLM_MODEL: str = "claude-sonnet-4-6"
    LLM_BASE_URL: str = "https://ai-gateway.happycapy.ai/api/v1"
    LLM_API_KEY: str = ""
    LLM_MAX_TOKENS: int = 2048
    LLM_TEMPERATURE: float = 0.3

    # Embeddings (LiteLLM)
    EMBEDDING_MODEL: str = "text-embedding-3-small"
    EMBEDDING_DIM: int = 1536

    # Qdrant
    QDRANT_COLLECTION: str = "ekm_chunks"
    RAG_TOP_K: int = 5

    # JWT
    SECRET_KEY: str = "change-me-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # File storage — S3-compatible object storage (Fly Tigris, MinIO, AWS S3).
    # Leave S3_BUCKET empty to fall back to local disk (dev mode).
    S3_BUCKET: str = ""
    S3_ENDPOINT_URL: str = ""          # e.g. https://fly.storage.tigris.dev
    S3_ACCESS_KEY_ID: str = ""
    S3_SECRET_ACCESS_KEY: str = ""
    S3_REGION: str = "auto"
    # Local fallback (dev / tests only when S3_BUCKET is empty)
    UPLOAD_DIR: str = "/tmp/ekm_uploads"
    MAX_UPLOAD_SIZE_MB: int = 100

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:3001"]

    # SMTP (optional — leave SMTP_HOST empty to disable email side of alerts).
    # Mailer degrades gracefully: if unset, in-app notifications still fire,
    # only email is skipped (logged at INFO). Same pattern as ES/Neo4j.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_USE_TLS: bool = True
    SMTP_FROM: str = "ekm@localhost"
    # Public base URL used to build links inside archive-reminder emails.
    PUBLIC_BASE_URL: str = "http://localhost:3000"

    # Archive / retention — daily sweep defaults.
    ARCHIVE_REMINDER_DAYS_BEFORE: int = 7  # send reminder when threshold - N days

    # KG quality — edges below this confidence are flagged needs_review=True.
    KG_LOW_CONFIDENCE_THRESHOLD: float = 0.5


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
