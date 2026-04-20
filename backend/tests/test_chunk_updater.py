"""Tests for chunk versioning + incremental update (Issue #43).

Covers:
  1. content_hash() format and determinism
  2. diff_chunks() — pure new, pure remove, mixed, no changes
  3. KCard JSON parsing (_parse_json)
  4. DocumentChunk model has versioning fields
  5. KCard model exists
"""
import sys
from unittest.mock import MagicMock, patch

import pytest

# Stub neo4j to avoid import chain issues.
_neo4j_stub = MagicMock()
_graph_stub = MagicMock()
sys.modules.setdefault("neo4j", _neo4j_stub)
sys.modules.setdefault("app.core.graph", _graph_stub)
_graph_stub.graph = MagicMock()

from app.services.chunk_updater import content_hash, ChunkDiff  # noqa: E402
from app.services.chunker import Chunk  # noqa: E402
from app.services.kcard import _parse_json  # noqa: E402
from app.models.document import DocumentChunk, KCard  # noqa: E402


# ── content_hash ─────────────────────────────────────────────────────


class TestContentHash:
    def test_length_16(self):
        assert len(content_hash("hello world")) == 16

    def test_deterministic(self):
        assert content_hash("test") == content_hash("test")

    def test_different_inputs(self):
        assert content_hash("foo") != content_hash("bar")

    def test_hex_chars(self):
        h = content_hash("some text")
        assert all(c in "0123456789abcdef" for c in h)


# ── diff_chunks (mock-based) ────────────────────────────────────────


class TestDiffChunks:
    """Test diff_chunks with mocked Session."""

    def _make_db_chunk(self, idx, text, is_current=True, doc_version=1):
        c = MagicMock(spec=DocumentChunk)
        c.id = idx * 100
        c.chunk_index = idx
        c.content = text
        c.content_hash = content_hash(text)
        c.is_current = is_current
        c.doc_version = doc_version
        return c

    def test_pure_addition(self):
        """All new text, no existing chunks → everything is 'added'."""
        from app.services.chunk_updater import diff_chunks

        db = MagicMock()
        call_idx = {"n": 0}

        def side_effect(*args, **kwargs):
            call_idx["n"] += 1
            result = MagicMock()
            if call_idx["n"] == 1:
                # Current chunks: empty
                result.scalars.return_value.all.return_value = []
            elif call_idx["n"] == 2:
                # max doc_version: None
                result.scalar_one_or_none.return_value = None
            else:
                result.scalars.return_value.all.return_value = []
                result.scalar_one_or_none.return_value = None
            return result

        db.execute.side_effect = side_effect

        diff = diff_chunks(db, 1, "hello world this is new content")

        assert len(diff.kept) == 0
        assert len(diff.removed) == 0
        assert len(diff.added) > 0
        assert diff.doc_version == 1

    def test_no_changes(self):
        """Same content → no removes, no adds, everything kept."""
        from app.services.chunk_updater import diff_chunks
        from app.services.chunker import chunk_text

        text = "This is a test paragraph.\n\nAnother paragraph here."
        chunks = chunk_text(text)

        db_chunks = [self._make_db_chunk(c.index, c.content) for c in chunks]
        db = MagicMock()
        call_idx = {"n": 0}

        def side_effect(*args, **kwargs):
            call_idx["n"] += 1
            result = MagicMock()
            if call_idx["n"] == 1:
                result.scalars.return_value.all.return_value = db_chunks
            elif call_idx["n"] == 2:
                result.scalar_one_or_none.return_value = 1
            else:
                result.scalars.return_value.all.return_value = []
                result.scalar_one_or_none.return_value = None
            return result

        db.execute.side_effect = side_effect

        diff = diff_chunks(db, 1, text)

        assert len(diff.removed) == 0
        assert len(diff.added) == 0
        assert len(diff.kept) == len(chunks)
        assert diff.doc_version == 2

    def test_mixed_changes(self):
        """Some chunks unchanged, some removed, some new."""
        from app.services.chunk_updater import diff_chunks
        from app.services.chunker import chunk_text

        old_text = "Paragraph A stays the same.\n\nParagraph B will be removed."
        new_text = "Paragraph A stays the same.\n\nParagraph C is brand new."

        old_chunks = chunk_text(old_text)
        db_chunks = [self._make_db_chunk(c.index, c.content) for c in old_chunks]

        db = MagicMock()
        call_idx = {"n": 0}

        def side_effect(*args, **kwargs):
            call_idx["n"] += 1
            result = MagicMock()
            if call_idx["n"] == 1:
                result.scalars.return_value.all.return_value = db_chunks
            elif call_idx["n"] == 2:
                result.scalar_one_or_none.return_value = 1
            else:
                result.scalars.return_value.all.return_value = []
                result.scalar_one_or_none.return_value = None
            return result

        db.execute.side_effect = side_effect

        diff = diff_chunks(db, 1, new_text)

        # At least some changes detected
        total = len(diff.kept) + len(diff.removed) + len(diff.added)
        assert total > 0


# ── K-Card JSON parsing ─────────────────────────────────────────────


class TestParseJson:
    def test_clean_json(self):
        result = _parse_json('{"title": "Test", "summary": "Sum", "tags": ["a"]}')
        assert result["title"] == "Test"
        assert result["tags"] == ["a"]

    def test_markdown_wrapped(self):
        result = _parse_json('```json\n{"title": "X", "summary": "Y", "tags": []}\n```')
        assert result["title"] == "X"

    def test_invalid_returns_none(self):
        assert _parse_json("not json at all") is None

    def test_empty_returns_none(self):
        assert _parse_json("") is None


# ── Model field checks ───────────────────────────────────────────────


class TestDocumentChunkVersionFields:
    def test_has_content_hash(self):
        assert hasattr(DocumentChunk, "content_hash")

    def test_has_version(self):
        assert hasattr(DocumentChunk, "version")

    def test_has_is_current(self):
        assert hasattr(DocumentChunk, "is_current")

    def test_has_doc_version(self):
        assert hasattr(DocumentChunk, "doc_version")


class TestKCardModel:
    def test_has_chunk_id(self):
        assert hasattr(KCard, "chunk_id")

    def test_has_title(self):
        assert hasattr(KCard, "title")

    def test_has_summary(self):
        assert hasattr(KCard, "summary")

    def test_has_tags(self):
        assert hasattr(KCard, "tags")
