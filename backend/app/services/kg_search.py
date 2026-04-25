"""KG search helpers — pure functions, no framework dependencies.

Extracted from routers/kg.py so they can be unit-tested without pulling
in FastAPI's dependency chain (auth → jose → …).
"""

import re

# Lucene special characters that must be escaped before passing to
# Neo4j's fulltext queryNodes.  Without this, `q=*` enumerates the
# entire graph and `q=name:*` enables field-targeted scans.
LUCENE_SPECIAL = re.compile(r'([+\-!(){}[\]^"~*?:\\/|&])')

# Entity external_id format — blocks Cypher injection via label interpolation.
SAFE_ID_RE = re.compile(r"^[\w:.\-]{1,255}$", re.UNICODE)

MAX_LIMIT = 100
MAX_HOPS = 5


class LuceneEscapeError(ValueError):
    """Raised when the search query is a bare wildcard or empty."""


def escape_lucene(q: str) -> str:
    """Escape Lucene special chars in user query.

    Rejects bare wildcards that would enumerate the entire index.
    Raises LuceneEscapeError on invalid input.
    """
    q = q.strip()
    if not q or q in ("*", "?"):
        raise LuceneEscapeError("search query must not be a bare wildcard")
    return LUCENE_SPECIAL.sub(r"\\\1", q)
