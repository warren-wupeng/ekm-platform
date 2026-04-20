"""Tests for KG incremental update logic (Issue #65).

Verifies the _doc_external_id format and the _clear_document_kg
cleanup algorithm. Uses unittest.mock to stub the heavy import chain
(neo4j / graph_sync) so tests run without external dependencies.
"""
import sys
from unittest.mock import MagicMock, patch

import pytest


# ── Stub heavy deps before importing kg_extract ─────────────────────

_neo4j_stub = MagicMock()
_graph_stub = MagicMock()

sys.modules.setdefault("neo4j", _neo4j_stub)
sys.modules.setdefault("app.core.graph", _graph_stub)
# graph_sync imports from app.core.graph — ensure the attr exists.
_graph_stub.graph = MagicMock()

# Now safe to import — graph_sync.py won't explode on `from neo4j import ...`
from app.services.kg_extract import (  # noqa: E402
    _clear_document_kg,
    _clear_document_neo4j,
    _doc_external_id,
)
from app.models.kg import KGEdge, KGNode  # noqa: E402


# ── external_id format ───────────────────────────────────────────────


class TestDocExternalId:
    def test_format(self):
        assert _doc_external_id(42) == "doc:42"

    def test_format_zero(self):
        assert _doc_external_id(0) == "doc:0"

    def test_format_large(self):
        assert _doc_external_id(999999) == "doc:999999"


# ── Neo4j cleanup with no URL ───────────────────────────────────────


class TestClearDocumentNeo4j:
    def test_noop_when_no_neo4j_url(self):
        """Should return silently when NEO4J_URL is empty."""
        with patch("app.services.kg_extract.settings") as mock_s:
            mock_s.NEO4J_URL = ""
            _clear_document_neo4j(1, "doc:1")  # should not raise


# ── Postgres cleanup ─────────────────────────────────────────────────


def _make_node(id_: int, external_id: str, entity_type: str = "Entity") -> KGNode:
    """Fabricate a KGNode-like object for mock returns."""
    n = MagicMock(spec=KGNode)
    n.id = id_
    n.external_id = external_id
    n.entity_type = entity_type
    return n


def _make_edge(id_: int, source_id: int, target_id: int, rel: str) -> KGEdge:
    """Fabricate a KGEdge-like object for mock returns."""
    e = MagicMock(spec=KGEdge)
    e.id = id_
    e.source_id = source_id
    e.target_id = target_id
    e.relation_type = rel
    return e


class TestClearDocumentKgNoDocNode:
    """When no doc node exists, nothing should be touched."""

    def test_returns_zeros(self):
        db = MagicMock()
        db.execute.return_value.scalar_one_or_none.return_value = None

        result = _clear_document_kg(db, 42)

        assert result == {"edges_deleted": 0, "nodes_deleted": 0}
        db.delete.assert_not_called()


class TestClearDocumentKgExclusiveEntities:
    """Doc has entities mentioned ONLY in this document → full cleanup."""

    @patch("app.services.kg_extract._clear_document_neo4j")
    def test_full_cleanup(self, mock_neo4j):
        db = MagicMock()

        doc_node = _make_node(100, "doc:1", "Document")
        ent_a = _make_node(201, "ent:Person:alice", "Person")
        ent_b = _make_node(202, "ent:Org:acme", "Organization")

        mention_a = _make_edge(301, 201, 100, "MENTIONED_IN")
        mention_b = _make_edge(302, 202, 100, "MENTIONED_IN")
        inter_ab = _make_edge(303, 201, 202, "worksFor")

        call_idx = {"n": 0}

        def execute_side_effect(*args, **kwargs):
            call_idx["n"] += 1
            n = call_idx["n"]
            result = MagicMock()

            if n == 1:
                # select KGNode where external_id = doc:1
                result.scalar_one_or_none.return_value = doc_node
            elif n == 2:
                # select KGEdge MENTIONED_IN edges to doc_node
                result.scalars.return_value.all.return_value = [mention_a, mention_b]
            elif n == 3:
                # check if ent_a has other MENTIONED_IN (none)
                result.scalar_one_or_none.return_value = None
            elif n == 4:
                # check if ent_b has other MENTIONED_IN (none)
                result.scalar_one_or_none.return_value = None
            elif n == 5:
                # inter-entity edges where source in exclusive
                result.scalars.return_value.all.return_value = [inter_ab]
            elif n == 6:
                # inter-entity edges where target in exclusive
                result.scalars.return_value.all.return_value = []
            elif n == 7:
                # orphan check for ent_a — no remaining edges
                result.scalar_one_or_none.return_value = None
            elif n == 8:
                # orphan check for ent_b — no remaining edges
                result.scalar_one_or_none.return_value = None
            else:
                result.scalar_one_or_none.return_value = None
                result.scalars.return_value.all.return_value = []

            return result

        db.execute.side_effect = execute_side_effect
        db.get.side_effect = lambda cls, id_: {201: ent_a, 202: ent_b}.get(id_)

        result = _clear_document_kg(db, 1)

        # 2 MENTIONED_IN + 1 inter-entity = 3 edges deleted
        assert result["edges_deleted"] == 3
        # doc_node + 2 orphan entities = 3 nodes deleted
        assert result["nodes_deleted"] == 3
        # Neo4j cleanup is deferred to after db.commit() (two-phase),
        # so _clear_document_kg does NOT call it directly.
        mock_neo4j.assert_not_called()


class TestClearDocumentKgSharedEntity:
    """One entity shared, one exclusive. Exclusive node + its edges are cleaned."""

    @patch("app.services.kg_extract._clear_document_neo4j")
    def test_exclusive_cleaned_shared_preserved(self, mock_neo4j):
        db = MagicMock()

        doc_node = _make_node(100, "doc:1", "Document")
        ent_a = _make_node(201, "ent:Person:alice", "Person")  # exclusive
        ent_b = _make_node(202, "ent:Org:acme", "Organization")  # shared

        mention_a = _make_edge(301, 201, 100, "MENTIONED_IN")
        mention_b = _make_edge(302, 202, 100, "MENTIONED_IN")
        inter_ab = _make_edge(303, 201, 202, "worksFor")

        call_idx = {"n": 0}

        def execute_side_effect(*args, **kwargs):
            call_idx["n"] += 1
            n = call_idx["n"]
            result = MagicMock()

            if n == 1:
                result.scalar_one_or_none.return_value = doc_node
            elif n == 2:
                result.scalars.return_value.all.return_value = [mention_a, mention_b]
            elif n == 3:
                # ent_a: no other MENTIONED_IN → exclusive
                result.scalar_one_or_none.return_value = None
            elif n == 4:
                # ent_b: HAS another MENTIONED_IN → shared
                result.scalar_one_or_none.return_value = 999  # truthy
            elif n == 5:
                # ALL outgoing edges from exclusive nodes (ent_a)
                result.scalars.return_value.all.return_value = [inter_ab]
            elif n == 6:
                # ALL incoming edges to exclusive nodes — none
                result.scalars.return_value.all.return_value = []
            elif n == 7:
                # orphan check for ent_a: inter_ab WAS deleted (all
                # outgoing edges from exclusive nodes are removed), so
                # ent_a has zero remaining edges → orphan → deleted.
                result.scalar_one_or_none.return_value = None
            else:
                result.scalar_one_or_none.return_value = None
                result.scalars.return_value.all.return_value = []

            return result

        db.execute.side_effect = execute_side_effect
        db.get.side_effect = lambda cls, id_: {201: ent_a}.get(id_)

        result = _clear_document_kg(db, 1)

        # 2 MENTIONED_IN + 1 inter-entity (worksFor) = 3 edges deleted
        assert result["edges_deleted"] == 3
        # doc_node + ent_a (orphan after edge cleanup) = 2 nodes deleted
        # ent_b is shared → survives
        assert result["nodes_deleted"] == 2
