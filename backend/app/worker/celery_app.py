"""Celery application factory.

The worker is a separate process driven by Redis. Keep task discovery
centralised here via `include=[...]`; each feature module (#15 parsing,
#16 indexing, #22 embedding) appends its task module to that list.

Start locally:
    celery -A app.worker.celery_app worker --loglevel=info

Or via compose:
    docker compose --profile worker up -d worker
"""
from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.core.config import settings


celery_app = Celery(
    "ekm",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[
        "app.worker.tasks",
    ],
)

# Beat schedule — runs in the dedicated `beat` process (see docker-compose).
# Do NOT spin up a beat process inside a worker — multiple beats will
# dispatch duplicates. Exactly one beat per deployment.
celery_app.conf.beat_schedule = {
    # Daily at 03:42 UTC — middle of the night everywhere relevant, off
    # the top of the hour so we don't collide with other infra cron jobs.
    "archive-tick-daily": {
        "task": "ekm.archive.tick",
        "schedule": crontab(hour=3, minute=42),
    },
}

celery_app.conf.update(
    # Sensible defaults for a document-processing workload:
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,

    # Don't hold results forever — 24h is enough for the UI to poll status.
    result_expires=60 * 60 * 24,

    # Long documents / LLM calls — give tasks room but cap runaway jobs.
    task_soft_time_limit=60 * 10,     # 10 min soft
    task_time_limit=60 * 15,          # 15 min hard

    # Prefetch 1 so a slow parse doesn't starve other workers.
    worker_prefetch_multiplier=1,
    task_acks_late=True,
)
