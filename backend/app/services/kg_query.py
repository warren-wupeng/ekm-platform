"""Safe Cypher builder for the Agent API.

External Agents MUST NOT be allowed to send arbitrary Cypher. Cypher has
write operations (CREATE, DELETE, SET), can invoke APOC procedures, and
can exfiltrate schema. Even for "read-only" claims we can't trust
substring filters like "no CREATE anywhere" — Cypher is too expressive.

So: Agents don't send Cypher. They send a *structured query description*
(labels, property filters, limits), we validate every field against a
known vocabulary, and we build parameterised Cypher on their behalf.
All user-supplied values travel as parameters, never string-interpolated.

What we expose:

1. ``build_match_query``     — MATCH (n:Label) WHERE ... RETURN ... LIMIT n
2. ``build_path_query``      — shortestPath between two entities, bounded hops

Notes:

* Labels / relation types are restricted to the controlled vocabulary in
  `app/models/graph_vocab.py`. An Agent asking for `:User` or `:Secret`
  gets a 422 at the schema layer before we even build Cypher.
* Property filter *keys* are length-checked and regex-validated as
  identifiers (`^[A-Za-z_][A-Za-z0-9_]*$`). Property *values* are passed
  as parameters, so any string — including Cypher syntax — is safe.
* We never interpolate LIMIT via f-string; it's clamped to an int range
  then bound as a parameter too.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.models.graph_vocab import ENTITY_TYPES, RELATION_TYPES

# Reserved label always present on nodes written via graph_sync.upsert_entity.
_BASE_LABEL = "Entity"

# Cypher identifier shape. Stays intentionally conservative — if a
# legitimate use case needs hyphens or dots later, we'll widen explicitly.
_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")

# Limit + hop caps. These are HARD maxima — Pydantic also enforces softer
# defaults at the schema layer, but having them here means even a buggy
# schema can't make us fire a 10,000-hop traversal.
MAX_LIMIT = 200
MAX_HOPS = 5


class KGQueryError(ValueError):
    """Raised when the structured query can't be translated safely.

    Caller (router) should surface as 422, since the problem is always
    with user input — never an internal failure."""


@dataclass(frozen=True)
class BuiltQuery:
    cypher: str
    params: dict


def _validate_entity_type(entity_type: str | None) -> str | None:
    """Return the label or None. Rejects anything outside the vocabulary."""
    if entity_type is None:
        return None
    if entity_type not in ENTITY_TYPES:
        raise KGQueryError(f"Unknown entity_type: {entity_type!r}")
    return entity_type


def _validate_relation_type(relation_type: str | None) -> str | None:
    if relation_type is None:
        return None
    if relation_type not in RELATION_TYPES:
        raise KGQueryError(f"Unknown relation_type: {relation_type!r}")
    return relation_type


def _validate_prop_keys(props: dict | None) -> dict:
    """Ensure every property *key* is a safe identifier.

    Values are arbitrary — they ride as query parameters. Keys, however,
    are interpolated into the Cypher string (Cypher can't parameterise
    property names), so they must be validated against a tight regex.
    """
    if not props:
        return {}
    clean: dict = {}
    for k, v in props.items():
        if not isinstance(k, str) or not _IDENT_RE.match(k):
            raise KGQueryError(f"Invalid property key: {k!r}")
        clean[k] = v
    return clean


def _clamp(n: int | None, *, default: int, maximum: int) -> int:
    if n is None:
        return default
    if n < 1:
        return 1
    if n > maximum:
        return maximum
    return n


def build_match_query(
    *,
    entity_type: str | None = None,
    where_props: dict | None = None,
    limit: int | None = None,
) -> BuiltQuery:
    """Build ``MATCH (n:Entity[:Type]) WHERE n.key = $p0 ... RETURN n LIMIT $lim``.

    Every property key is validated; every property value is a parameter.
    No user string ever reaches the Cypher text directly.
    """
    label = _validate_entity_type(entity_type)
    props = _validate_prop_keys(where_props)
    limit_final = _clamp(limit, default=50, maximum=MAX_LIMIT)

    # Label fragment: always include :Entity so we never accidentally
    # match nodes from other subsystems (e.g. :KnowledgeItem mirror nodes).
    label_frag = f":{_BASE_LABEL}"
    if label and label != _BASE_LABEL:
        label_frag += f":{label}"

    params: dict = {"lim": limit_final}
    where_clauses: list[str] = []
    for i, (k, v) in enumerate(props.items()):
        pname = f"p{i}"
        # `k` was validated by _validate_prop_keys; safe to interpolate.
        where_clauses.append(f"n.{k} = ${pname}")
        params[pname] = v

    cypher = f"MATCH (n{label_frag})"
    if where_clauses:
        cypher += " WHERE " + " AND ".join(where_clauses)
    cypher += (
        " RETURN n.external_id AS external_id, n.label AS label, "
        "labels(n) AS labels, properties(n) AS properties "
        "LIMIT $lim"
    )
    return BuiltQuery(cypher=cypher, params=params)


def build_path_query(
    *,
    source_external_id: str,
    target_external_id: str,
    max_hops: int | None = None,
    relation_type: str | None = None,
) -> BuiltQuery:
    """Shortest path between two entities, bounded hop count.

    ``relation_type`` optionally restricts the edge type walked. When
    omitted, any relationship in the controlled vocabulary is allowed —
    but we still bound length via ``max_hops`` so traversal cost is
    capped regardless of graph size.
    """
    if not isinstance(source_external_id, str) or not source_external_id.strip():
        raise KGQueryError("source_external_id required")
    if not isinstance(target_external_id, str) or not target_external_id.strip():
        raise KGQueryError("target_external_id required")

    hops = _clamp(max_hops, default=3, maximum=MAX_HOPS)
    rel = _validate_relation_type(relation_type)

    # Relationship type can't be parameterised by Cypher. We've already
    # whitelisted it against RELATION_TYPES; safe to interpolate.
    rel_frag = f":{rel}" if rel else ""

    # shortestPath() returns a single path if one exists within bounds,
    # otherwise no rows. `[*1..N]` caps the walk length regardless of
    # neighborhood density.
    cypher = (
        f"MATCH (a:{_BASE_LABEL} {{external_id: $src}}), "
        f"(b:{_BASE_LABEL} {{external_id: $dst}}) "
        f"MATCH p = shortestPath((a)-[{rel_frag}*1..{hops}]-(b)) "
        "RETURN [n IN nodes(p) | n.external_id] AS node_ids, "
        "[r IN relationships(p) | type(r)] AS rel_types, "
        "length(p) AS hops"
    )
    return BuiltQuery(
        cypher=cypher,
        params={
            "src": source_external_id,
            "dst": target_external_id,
        },
    )
