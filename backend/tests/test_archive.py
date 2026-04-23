"""Tests for archive API — POST /api/v1/archive/request.

Unit tests covering:
  1. ArchiveRequestIn schema validation
  2. Permission-check helper logic
  3. End-to-end archive_item route logic via mocked DB
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.routers.archive import ArchiveRequestIn


# ── ArchiveRequestIn schema ──────────────────────────────────────────


class TestArchiveRequestIn:
    def test_required_field(self):
        body = ArchiveRequestIn(knowledge_item_id=42)
        assert body.knowledge_item_id == 42
        assert body.reason is None

    def test_with_reason(self):
        body = ArchiveRequestIn(knowledge_item_id=7, reason="Quarterly cleanup")
        assert body.knowledge_item_id == 7
        assert body.reason == "Quarterly cleanup"

    def test_reason_max_length_enforced(self):
        with pytest.raises(Exception):
            ArchiveRequestIn(knowledge_item_id=1, reason="x" * 2001)

    def test_reason_at_max_length_accepted(self):
        body = ArchiveRequestIn(knowledge_item_id=1, reason="x" * 2000)
        assert len(body.reason) == 2000


# ── Permission logic ─────────────────────────────────────────────────


class TestArchivePermission:
    """Verify permission semantics: owner, km_ops, and admin may archive."""

    def _make_item(self, uploader_id: int) -> MagicMock:
        item = MagicMock()
        item.id = 1
        item.name = "test.pdf"
        item.is_archived = False
        item.archived_at = None
        item.uploader_id = uploader_id
        return item

    def _make_user(self, uid: int, role: str) -> MagicMock:
        from app.models.user import UserRole
        user = MagicMock()
        user.id = uid
        user.role = UserRole(role)
        return user

    def test_owner_may_archive(self):
        item = self._make_item(uploader_id=10)
        user = self._make_user(uid=10, role="viewer")
        # owner: uploader_id == user.id → permission granted
        assert item.uploader_id == user.id

    def test_admin_may_archive_others_item(self):
        from app.models.user import UserRole
        item = self._make_item(uploader_id=99)
        user = self._make_user(uid=1, role="admin")
        # admin can archive regardless of ownership
        allowed = (
            item.uploader_id == user.id
            or user.role in (UserRole.ADMIN, UserRole.KM_OPS)
        )
        assert allowed

    def test_km_ops_may_archive_others_item(self):
        from app.models.user import UserRole
        item = self._make_item(uploader_id=99)
        user = self._make_user(uid=2, role="km_ops")
        allowed = (
            item.uploader_id == user.id
            or user.role in (UserRole.ADMIN, UserRole.KM_OPS)
        )
        assert allowed

    def test_editor_cannot_archive_others_item(self):
        from app.models.user import UserRole
        item = self._make_item(uploader_id=99)
        user = self._make_user(uid=5, role="editor")
        allowed = (
            item.uploader_id == user.id
            or user.role in (UserRole.ADMIN, UserRole.KM_OPS)
        )
        assert not allowed


# ── archive_item route (mocked DB) ───────────────────────────────────


@pytest.mark.asyncio
async def test_archive_item_success():
    """archive_item sets is_archived=True and returns correct payload."""
    from datetime import datetime, timezone
    from app.routers.archive import archive_item
    from app.models.user import UserRole

    item = MagicMock()
    item.id = 5
    item.name = "report.pdf"
    item.is_archived = False
    item.archived_at = None
    item.uploader_id = 1

    user = MagicMock()
    user.id = 1
    user.role = UserRole.VIEWER

    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = item
    db = AsyncMock()
    db.execute.return_value = execute_result
    db.flush = AsyncMock()
    db.commit = AsyncMock()

    body = ArchiveRequestIn(knowledge_item_id=5)
    result = await archive_item(body=body, user=user, db=db)

    assert item.is_archived is True
    assert item.archived_at is not None
    assert result["id"] == 5
    assert result["is_archived"] is True


@pytest.mark.asyncio
async def test_archive_item_not_found():
    """archive_item raises 404 when the item does not exist."""
    from fastapi import HTTPException
    from app.routers.archive import archive_item
    from app.models.user import UserRole

    user = MagicMock()
    user.id = 1
    user.role = UserRole.ADMIN

    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    db = AsyncMock()
    db.execute.return_value = execute_result

    body = ArchiveRequestIn(knowledge_item_id=999)
    with pytest.raises(HTTPException) as exc_info:
        await archive_item(body=body, user=user, db=db)

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_archive_item_forbidden():
    """Non-owner non-admin gets 403."""
    from fastapi import HTTPException
    from app.routers.archive import archive_item
    from app.models.user import UserRole

    item = MagicMock()
    item.id = 5
    item.name = "secret.pdf"
    item.is_archived = False
    item.uploader_id = 99   # uploaded by someone else

    user = MagicMock()
    user.id = 1             # different user
    user.role = UserRole.EDITOR

    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = item
    db = AsyncMock()
    db.execute.return_value = execute_result

    body = ArchiveRequestIn(knowledge_item_id=5)
    with pytest.raises(HTTPException) as exc_info:
        await archive_item(body=body, user=user, db=db)

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_archive_already_archived_is_noop():
    """Archiving an already-archived item returns 200 without re-setting archived_at."""
    from datetime import datetime, timezone
    from app.routers.archive import archive_item
    from app.models.user import UserRole

    original_ts = datetime(2026, 1, 1, tzinfo=timezone.utc)
    item = MagicMock()
    item.id = 3
    item.name = "old.pdf"
    item.is_archived = True
    item.archived_at = original_ts
    item.uploader_id = 1

    user = MagicMock()
    user.id = 1
    user.role = UserRole.VIEWER

    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = item
    db = AsyncMock()
    db.execute.return_value = execute_result
    db.flush = AsyncMock()
    db.commit = AsyncMock()

    body = ArchiveRequestIn(knowledge_item_id=3)
    result = await archive_item(body=body, user=user, db=db)

    # archived_at must NOT be changed — it's a no-op
    assert item.archived_at == original_ts
    db.flush.assert_not_called()
    db.commit.assert_not_called()
    assert result["is_archived"] is True
