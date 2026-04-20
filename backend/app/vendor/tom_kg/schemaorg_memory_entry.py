"""
Schema.org Memory Entry Models

Pydantic models for entities, relations, and knowledge graph entries
aligned with Schema.org types.
"""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
import uuid


class SchemaOrgEntity(BaseModel):
    """An entity aligned with Schema.org types."""
    entity_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    schema_type: str  # e.g., "Person", "Organization", "Place"
    schema_uri: str   # e.g., "https://schema.org/Person"
    properties: Dict[str, Any] = Field(default_factory=dict)


class SchemaOrgRelation(BaseModel):
    """A relationship between entities using Schema.org properties."""
    subject_id: str
    predicate: str      # Schema.org property, e.g., "worksFor", "location"
    predicate_uri: str  # e.g., "https://schema.org/worksFor"
    object_id: str


class KnowledgeGraphEntry(BaseModel):
    """Extended memory entry with Schema.org alignment."""
    entry_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    
    # Original text fields
    lossless_restatement: str
    keywords: List[str] = Field(default_factory=list)
    timestamp: Optional[str] = None
    location: Optional[str] = None
    
    # Schema.org-aligned entities
    entities: List[SchemaOrgEntity] = Field(default_factory=list)
    relations: List[SchemaOrgRelation] = Field(default_factory=list)
    
    def to_jsonld(self) -> Dict[str, Any]:
        """Convert to JSON-LD format."""
        graph = []
        for entity in self.entities:
            node = {
                "@id": f"urn:kg:{entity.entity_id}",
                "@type": entity.schema_type,
                "name": entity.name,
                **entity.properties
            }
            graph.append(node)
        
        return {
            "@context": "https://schema.org",
            "@graph": graph
        }
