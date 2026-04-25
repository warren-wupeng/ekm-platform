"""Task status endpoint.

Front-end polls this after kicking off an async parse / index / embed job.
Celery's AsyncResult is thin — state + optional result payload — which is
exactly what the UI progress bar needs.
"""

from __future__ import annotations

from typing import Any

from celery.result import AsyncResult
from fastapi import APIRouter, HTTPException

from app.worker.celery_app import celery_app

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])


@router.get("/{task_id}")
def get_task_status(task_id: str) -> dict[str, Any]:
    """Return Celery task state + result (if finished).

    States: PENDING | STARTED | RETRY | FAILURE | SUCCESS
    """
    if not task_id:
        raise HTTPException(status_code=400, detail="task_id required")

    res = AsyncResult(task_id, app=celery_app)
    payload: dict[str, Any] = {"task_id": task_id, "state": res.state}

    if res.successful():
        payload["result"] = res.result
    elif res.failed():
        # Expose the error message but not the traceback — traceback stays in logs.
        payload["error"] = str(res.result) if res.result else "task failed"

    return payload
