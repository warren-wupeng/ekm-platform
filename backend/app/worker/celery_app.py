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

    # Write STARTED to result backend when a worker picks up a task.
    # Without this, result backend stays PENDING during execution, making
    # it impossible to distinguish "queued" from "running" (issue #168).
    task_track_started=True,

    # Periodic jobs — requires running `celery beat` alongside the worker:
    #     celery -A app.worker.celery_app beat --loglevel=info
    # See docker-compose.yml `beat` service (profile: worker).
    beat_schedule={
        "sharing-purge-expired-daily": {
            "task": "ekm.sharing.purge_expired",
            "schedule": crontab(hour=3, minute=17),  # 03:17 UTC — off-peak
        },
        # Auto-archive sweep (US-058/059). 03:42 UTC — staggered from
        # sharing-purge so two long-running jobs don't contend for the DB.
        "archive-tick-daily": {
            "task": "ekm.archive.tick",
            "schedule": crontab(hour=3, minute=42),
        },
    },
)
