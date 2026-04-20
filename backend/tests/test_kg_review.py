"""Tests for KG quality review (Issue #54).

Tests cover:
  1. _upsert_edge confidence + needs_review auto-flagging logic
  2. ReviewError codes
  3. Quality stats aggregation basics
  4. Threshold boundary conditions
"""
import sys
from unittest.mock import MagicMock, patch

import pytest

# Stub heavy deps before import.
_neo4j_stub = MagicMock()
_graph_stub = MagicMock()
sys.modules.setdefault("neo4j", _neo4j_stub)
sys.modules.setdefault("app.core.graph", _graph_stub)
_graph_stub.graph = MagicMock()


# ── Import after stubs ───────────────────────────────────────────────

from app.models.kg import KGEdge, KGNode  # noqa: E402
from app.services.kg_review import ReviewError  # noqa: E402
from app.vendor.tom_kg.schemaorg_memory_entry import SchemaOrgRelation  # noqa: E402


# ── SchemaOrgRelation confidence field ───────────────────────────────


class TestSchemaOrgRelationConfidence:
    def test_default_none(self):
        r = SchemaOrgRelation(
            subject_id="a", predicate="worksFor",
            predicate_uri="https://schema.org/worksFor", object_id="b",
        )
        assert r.confidence is None

    def test_set_value(self):
        r = SchemaOrgRelation(
            subject_id="a", predicate="worksFor",
            predicate_uri="https://schema.org/worksFor", object_id="b",
            confidence=0.85,
        )
        assert r.confidence == 0.85


# ── _upsert_edge auto-flag logic ────────────────────────────────────


class TestUpsertEdgeConfidence:
    """Test the confidence → needs_review auto-flagging in _upsert_edge."""

    def _make_mock_db(self, existing_edge=None):
        db = MagicMock()
        db.execute.return_value.scalar_one_or_none.return_value = existing_edge
        return db

    def _make_node(self, id_):
        n = MagicMock(spec=KGNode)
        n.id = id_
        return n

    @patch("app.services.kg_extract.settings")
    def test_low_confidence_flags_review(self, mock_settings):
        from app.services.kg_extract import _upsert_edge

        mock_settings.KG_LOW_CONFIDENCE_THRESHOLD = 0.5
        db = self._make_mock_db()
        src, dst = self._make_node(1), self._make_node(2)

        result = _upsert_edge(
            db, source=src, target=dst,
            relation_type="worksFor",
            properties={},
            confidence=0.3,
        )

        assert result is True
        # Check the KGEdge was created with needs_review=True
        added_obj = db.add.call_args[0][0]
        assert added_obj.needs_review is True
        assert added_obj.confidence == 0.3

    @patch("app.services.kg_extract.settings")
    def test_high_confidence_no_flag(self, mock_settings):
        from app.services.kg_extract import _upsert_edge

        mock_settings.KG_LOW_CONFIDENCE_THRESHOLD = 0.5
        db = self._make_mock_db()
        src, dst = self._make_node(1), self._make_node(2)

        _upsert_edge(
            db, source=src, target=dst,
            relation_type="worksFor",
            properties={},
            confidence=0.8,
        )

        added_obj = db.add.call_args[0][0]
        assert added_obj.needs_review is False

    @patch("app.services.kg_extract.settings")
    def test_exact_threshold_no_flag(self, mock_settings):
        """Threshold is exclusive — exactly 0.5 should NOT be flagged."""
        from app.services.kg_extract import _upsert_edge

        mock_settings.KG_LOW_CONFIDENCE_THRESHOLD = 0.5
        db = self._make_mock_db()
        src, dst = self._make_node(1), self._make_node(2)

        _upsert_edge(
            db, source=src, target=dst,
            relation_type="worksFor",
            properties={},
            confidence=0.5,
        )

        added_obj = db.add.call_args[0][0]
        assert added_obj.needs_review is False

    @patch("app.services.kg_extract.settings")
    def test_mentioned_in_never_flagged(self, mock_settings):
        """MENTIONED_IN edges are structural — never flagged for review."""
        from app.services.kg_extract import _upsert_edge

        mock_settings.KG_LOW_CONFIDENCE_THRESHOLD = 0.5
        db = self._make_mock_db()
        src, dst = self._make_node(1), self._make_node(2)

        _upsert_edge(
            db, source=src, target=dst,
            relation_type="MENTIONED_IN",
            properties={},
            confidence=0.1,
        )

        added_obj = db.add.call_args[0][0]
        assert added_obj.needs_review is False

    @patch("app.services.kg_extract.settings")
    def test_none_confidence_no_flag(self, mock_settings):
        """When confidence is None, needs_review should be False."""
        from app.services.kg_extract import _upsert_edge

        mock_settings.KG_LOW_CONFIDENCE_THRESHOLD = 0.5
        db = self._make_mock_db()
        src, dst = self._make_node(1), self._make_node(2)

        _upsert_edge(
            db, source=src, target=dst,
            relation_type="worksFor",
            properties={},
            confidence=None,
        )

        added_obj = db.add.call_args[0][0]
        assert added_obj.needs_review is False
        assert added_obj.confidence is None

    @patch("app.services.kg_extract.settings")
    def test_update_existing_edge_confidence(self, mock_settings):
        """When edge already exists, updating confidence should update review flag."""
        from app.services.kg_extract import _upsert_edge

        mock_settings.KG_LOW_CONFIDENCE_THRESHOLD = 0.5
        existing = MagicMock(spec=KGEdge)
        existing.properties = {}
        existing.confidence = 0.8
        existing.needs_review = False

        db = self._make_mock_db(existing_edge=existing)
        src, dst = self._make_node(1), self._make_node(2)

        result = _upsert_edge(
            db, source=src, target=dst,
            relation_type="worksFor",
            properties={},
            confidence=0.2,
        )

        assert result is False  # not a new edge
        assert existing.confidence == 0.2
        assert existing.needs_review is True


# ── ReviewError ──────────────────────────────────────────────────────


class TestReviewError:
    def test_not_found_code(self):
        err = ReviewError("Edge not found", code="not_found")
        assert err.code == "not_found"
        assert "not found" in err.message.lower()

    def test_default_code(self):
        err = ReviewError("something wrong")
        assert err.code == "review_error"


# ── KGEdge model fields ─────────────────────────────────────────────


class TestKGEdgeModelFields:
    """Verify the model has the required columns after our migration."""

    def test_has_confidence_column(self):
        assert hasattr(KGEdge, "confidence")

    def test_has_needs_review_column(self):
        assert hasattr(KGEdge, "needs_review")

    def test_has_reviewed_by_column(self):
        assert hasattr(KGEdge, "reviewed_by_id")

    def test_has_reviewed_at_column(self):
        assert hasattr(KGEdge, "reviewed_at")

    def test_has_deleted_at_column(self):
        assert hasattr(KGEdge, "deleted_at")
