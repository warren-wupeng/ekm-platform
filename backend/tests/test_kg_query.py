"""Tests for the safe Cypher builder (services/kg_query.py).

These are pure-logic unit tests — no DB, no Neo4j, no async. They verify
that the builder produces correct parameterised Cypher and rejects
malicious or malformed input before anything reaches the graph.
"""
import pytest

from app.services.kg_query import (
    KGQueryError,
    BuiltQuery,
    MAX_HOPS,
    MAX_LIMIT,
    build_match_query,
    build_path_query,
)


# ── build_match_query ─────────────────────────────────────────────


class TestBuildMatchQuery:
    def test_basic_match_no_filters(self):
        """No entity_type, no where → MATCH (n:Entity) RETURN … LIMIT $lim."""
        q = build_match_query()
        assert "MATCH (n:Entity)" in q.cypher
        assert "LIMIT $lim" in q.cypher
        assert q.params["lim"] == 50  # default

    def test_entity_type_adds_label(self):
        """entity_type='Person' → MATCH (n:Entity:Person)."""
        q = build_match_query(entity_type="Person")
        assert ":Entity:Person" in q.cypher

    def test_unknown_entity_type_raises(self):
        with pytest.raises(KGQueryError, match="Unknown entity_type"):
            build_match_query(entity_type="Secret")

    def test_where_props_become_params(self):
        """Property values ride as parameters, keys in Cypher text."""
        q = build_match_query(where_props={"name": "Alice", "age": 30})
        assert "n.name = $p0" in q.cypher
        assert "n.age = $p1" in q.cypher
        assert q.params["p0"] == "Alice"
        assert q.params["p1"] == 30

    def test_injection_via_property_key_rejected(self):
        """Keys like '}); DROP' must not pass the identifier regex."""
        with pytest.raises(KGQueryError, match="Invalid property key"):
            build_match_query(where_props={"}); DROP (n)--": "x"})

    def test_injection_via_property_key_with_dots(self):
        """Dotted keys (n.x.y) are invalid identifiers."""
        with pytest.raises(KGQueryError, match="Invalid property key"):
            build_match_query(where_props={"a.b": "val"})

    def test_limit_clamped_to_max(self):
        q = build_match_query(limit=9999)
        assert q.params["lim"] == MAX_LIMIT

    def test_limit_clamped_to_min(self):
        q = build_match_query(limit=-5)
        assert q.params["lim"] == 1

    def test_property_value_with_cypher_syntax_safe(self):
        """Cypher syntax in a VALUE is safe because it's a parameter."""
        q = build_match_query(where_props={"name": "'; DROP (n)--"})
        assert q.params["p0"] == "'; DROP (n)--"
        # The value never appears in the cypher text itself.
        assert "DROP" not in q.cypher


# ── build_path_query ──────────────────────────────────────────────


class TestBuildPathQuery:
    def test_basic_path(self):
        q = build_path_query(
            source_external_id="ent:Person:alice",
            target_external_id="ent:Person:bob",
        )
        assert "shortestPath" in q.cypher
        assert q.params["src"] == "ent:Person:alice"
        assert q.params["dst"] == "ent:Person:bob"

    def test_relation_type_in_cypher(self):
        q = build_path_query(
            source_external_id="a",
            target_external_id="b",
            relation_type="RELATED_TO",
        )
        assert ":RELATED_TO" in q.cypher

    def test_unknown_relation_type_raises(self):
        with pytest.raises(KGQueryError, match="Unknown relation_type"):
            build_path_query(
                source_external_id="a",
                target_external_id="b",
                relation_type="DROP_ALL",
            )

    def test_empty_source_raises(self):
        with pytest.raises(KGQueryError, match="source_external_id"):
            build_path_query(source_external_id="", target_external_id="b")

    def test_empty_target_raises(self):
        with pytest.raises(KGQueryError, match="target_external_id"):
            build_path_query(source_external_id="a", target_external_id="  ")

    def test_max_hops_clamped(self):
        q = build_path_query(
            source_external_id="a",
            target_external_id="b",
            max_hops=999,
        )
        assert f"*1..{MAX_HOPS}" in q.cypher

    def test_injection_via_relation_type_blocked(self):
        """Relation type is validated against a whitelist."""
        with pytest.raises(KGQueryError, match="Unknown relation_type"):
            build_path_query(
                source_external_id="a",
                target_external_id="b",
                relation_type="]->(x) DETACH DELETE x WITH x MATCH (n)-[",
            )

    def test_source_target_as_params_not_interpolated(self):
        """Even if source/target contain Cypher syntax, they're parameters."""
        q = build_path_query(
            source_external_id="'}); MATCH (n) DELETE n--",
            target_external_id="normal",
        )
        assert "DELETE" not in q.cypher
        assert q.params["src"] == "'}); MATCH (n) DELETE n--"
