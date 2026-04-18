"""Controlled vocabulary for knowledge-graph entities and relations.

The Postgres `kg_nodes.entity_type` and `kg_edges.relation_type` columns
are plain strings — extensible but error-prone. These enums are the
*recommended* set that the NER/extraction pipeline and the UI are built
against. New types can still be written to the DB (we don't enforce at
the schema layer), but anything outside this list is treated as "Other"
in the frontend.

Kept deliberately small at this stage — 6 entity types + 5 relation
types covers the common KM patterns (concept maps, people graphs, doc
cross-references). Expand as real corpora drive demand, not preemptively.
"""
from __future__ import annotations

import enum


class EntityType(str, enum.Enum):
    ENTITY      = "Entity"       # generic named entity fallback
    CONCEPT     = "Concept"      # abstract idea or topic
    PERSON      = "Person"
    ORGANIZATION = "Organization"
    LOCATION    = "Location"
    DOCUMENT    = "Document"     # mirrors a KnowledgeItem in Postgres


class RelationType(str, enum.Enum):
    # Concept/ontology edges.
    RELATED_TO   = "RELATED_TO"
    PART_OF      = "PART_OF"
    INSTANCE_OF  = "INSTANCE_OF"
    # Provenance — ties a concept back to where it was extracted from.
    MENTIONED_IN = "MENTIONED_IN"
    # Cross-document linkage (e.g. follow-up, supersedes, cites).
    REFERENCES   = "REFERENCES"


# Convenience sets for quick validation in services/graph_sync.py.
ENTITY_TYPES   = {e.value for e in EntityType}
RELATION_TYPES = {r.value for r in RelationType}
