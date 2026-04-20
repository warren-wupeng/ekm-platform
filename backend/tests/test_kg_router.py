"""Tests for the KG search helpers (services/kg_search.py).

Pure-logic unit tests for Lucene escaping and ID validation.
No DB, no Neo4j, no async, no FastAPI dependency chain.
"""
import pytest

from app.services.kg_search import (
    LuceneEscapeError,
    SAFE_ID_RE,
    MAX_HOPS,
    MAX_LIMIT,
    escape_lucene,
)


# ── Lucene escaping ──────────────────────────────────────────────────


class TestEscapeLucene:
    def test_bare_wildcard_star_rejected(self):
        """q='*' should be rejected — it enumerates the entire index."""
        with pytest.raises(LuceneEscapeError):
            escape_lucene("*")

    def test_bare_wildcard_question_rejected(self):
        with pytest.raises(LuceneEscapeError):
            escape_lucene("?")

    def test_empty_string_rejected(self):
        with pytest.raises(LuceneEscapeError):
            escape_lucene("")

    def test_whitespace_only_rejected(self):
        with pytest.raises(LuceneEscapeError):
            escape_lucene("   ")

    def test_normal_keyword_unchanged(self):
        assert escape_lucene("hello") == "hello"

    def test_chinese_keyword_unchanged(self):
        assert escape_lucene("知识图谱") == "知识图谱"

    def test_special_chars_escaped(self):
        """Lucene specials are backslash-escaped."""
        result = escape_lucene("name:value")
        assert "\\:" in result
        assert "name" in result

    def test_wildcard_in_phrase_escaped(self):
        """A '*' inside a normal query is escaped, not rejected."""
        result = escape_lucene("hello*world")
        assert "\\*" in result

    def test_parentheses_escaped(self):
        result = escape_lucene("(test)")
        assert "\\(" in result
        assert "\\)" in result

    def test_multiple_specials(self):
        result = escape_lucene('foo+"bar"')
        assert "\\+" in result
        assert '\\"' in result

    def test_ampersand_escaped(self):
        result = escape_lucene("A&B")
        assert "\\&" in result

    def test_pipe_escaped(self):
        result = escape_lucene("A|B")
        assert "\\|" in result


# ── Entity ID validation ─────────────────────────────────────────────


class TestEntityIdRegex:
    def test_valid_simple_id(self):
        assert SAFE_ID_RE.match("ent:Person:john-doe")

    def test_valid_doc_id(self):
        assert SAFE_ID_RE.match("doc:123")

    def test_valid_uuid_style(self):
        assert SAFE_ID_RE.match("ent:Concept:machine-learning")

    def test_invalid_empty(self):
        assert not SAFE_ID_RE.match("")

    def test_invalid_space(self):
        assert not SAFE_ID_RE.match("ent: Person")

    def test_invalid_semicolon(self):
        """Semicolons could be Cypher injection vectors."""
        assert not SAFE_ID_RE.match("ent;DROP")

    def test_invalid_curly_braces(self):
        assert not SAFE_ID_RE.match("ent:{injected}")

    def test_invalid_backtick(self):
        assert not SAFE_ID_RE.match("ent`DROP")


# ── Constants ────────────────────────────────────────────────────────


class TestConstants:
    def test_max_hops(self):
        assert MAX_HOPS == 5

    def test_max_limit(self):
        assert MAX_LIMIT == 100
