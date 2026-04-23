"""Tests for POST /api/v1/admin/reparse."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.rate_limit import limiter
from app.routers.admin_reparse import MAX_QUEUE, ReparseRequest, ReparseResponse


def test_reparse_request_defaults():
    r = ReparseRequest()
    assert r.item_ids is None
    assert r.force is False


def test_reparse_request_with_ids():
    r = ReparseRequest(item_ids=[1, 2, 3], force=True)
    assert r.item_ids == [1, 2, 3]
    assert r.force is True


def test_reparse_response():
    resp = ReparseResponse(queued=5, skipped=2)
    assert resp.queued == 5
    assert resp.skipped == 2


def test_max_queue_value():
    assert MAX_QUEUE == 200


# ── HTTP-level route tests (mocked DB + user) ────────────────────────


def _make_db_mock(returned_ids: list[int]) -> AsyncMock:
    """Return an AsyncMock DB session whose execute() yields *returned_ids*."""
    scalars_result = MagicMock()
    scalars_result.all.return_value = returned_ids
    execute_result = MagicMock()
    execute_result.scalars.return_value = scalars_result
    db = AsyncMock()
    db.execute.return_value = execute_result
    db.add = MagicMock()
    db.commit = AsyncMock()
    return db


@pytest.mark.asyncio
async def test_admin_reparse_403_non_admin():
    """Non-admin users receive HTTP 403."""
    from fastapi import HTTPException
    from starlette.requests import Request

    from app.models.user import UserRole
    from app.routers.admin_reparse import admin_reparse

    user = MagicMock()
    user.role = UserRole.EDITOR

    with patch.object(limiter, "enabled", False):
        with pytest.raises(HTTPException) as exc_info:
            await admin_reparse(
                request=MagicMock(spec=Request),
                body=ReparseRequest(),
                db=AsyncMock(),
                user=user,
            )

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_admin_reparse_400_exceeds_max_queue():
    """Passing more than MAX_QUEUE item_ids in force mode returns HTTP 400."""
    from fastapi import HTTPException
    from starlette.requests import Request

    from app.models.user import UserRole
    from app.routers.admin_reparse import admin_reparse

    over_limit_ids = list(range(1, MAX_QUEUE + 2))  # MAX_QUEUE + 1 items

    user = MagicMock()
    user.role = UserRole.ADMIN
    user.id = 1

    db = _make_db_mock(over_limit_ids)
    body = ReparseRequest(item_ids=over_limit_ids, force=True)

    with patch.object(limiter, "enabled", False):
        with pytest.raises(HTTPException) as exc_info:
            await admin_reparse(
                request=MagicMock(spec=Request),
                body=body,
                db=db,
                user=user,
            )

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_admin_reparse_202_happy_path_and_celery_delay():
    """202 response with correct counts; parse_document.delay called once per item."""
    from starlette.requests import Request

    from app.models.user import UserRole
    from app.routers.admin_reparse import admin_reparse

    item_ids = [10, 20, 30]

    user = MagicMock()
    user.role = UserRole.ADMIN
    user.id = 1

    db = _make_db_mock(item_ids)
    body = ReparseRequest(item_ids=item_ids, force=True)

    with patch("app.routers.admin_reparse.parse_document") as mock_task:
        with patch.object(limiter, "enabled", False):
            result = await admin_reparse(
                request=MagicMock(spec=Request),
                body=body,
                db=db,
                user=user,
            )

    assert result.queued == 3
    assert result.skipped == 0
    assert result.dispatch_failed == 0
    assert mock_task.delay.call_count == 3
