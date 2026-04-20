"""Tests for POST /api/v1/admin/reparse."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

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
