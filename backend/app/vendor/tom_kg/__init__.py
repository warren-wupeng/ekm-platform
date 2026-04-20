"""Vendored copy of Tom's Schema.org KG constructor.

Source:    https://github.com/imadcat/simplemem_schemaorg-kg-constructor
Commit:    320610ef95ff5e1b5dc71eeeed195ebf00b80878
License:   MIT (see ./LICENSE)

Why vendored: avoids a git-URL dependency in production (Docker/Fly builds
pinning-by-hash is brittle) and keeps review surface visible in-tree. The
only local modification is changing the 3 cross-imports in
`knowledge_graph_constructor.py` from `from schema_loader import ...` to
relative (`from .schema_loader import ...`) so the modules can live inside
a package — the upstream repo is a flat module layout that can't be
packaged without that tweak. No logic changes.

Public surface re-exported here for the rest of the app to import without
reaching into vendor internals:

    from app.vendor.tom_kg import KnowledgeGraphConstructor, SchemaOrgEntity, SchemaOrgRelation
"""
from .knowledge_graph_constructor import KnowledgeGraphConstructor, LLMClient
from .schemaorg_memory_entry import SchemaOrgEntity, SchemaOrgRelation

__all__ = [
    "KnowledgeGraphConstructor",
    "LLMClient",
    "SchemaOrgEntity",
    "SchemaOrgRelation",
]
