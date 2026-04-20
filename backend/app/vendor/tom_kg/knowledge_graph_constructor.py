"""
Knowledge Graph Constructor

Main class for building knowledge graphs from text using Schema.org alignment.
"""

from typing import List, Dict, Any, Optional
import json
import re
import os

import httpx

from .schema_loader import SchemaOrgLoader
from .schemaorg_memory_entry import SchemaOrgEntity, SchemaOrgRelation
from .schemaorg_entity_extractor import SchemaOrgEntityExtractor

# Timeout for LLM calls: 10s connect, 120s read (extraction prompts can
# be large), 10s write, 5s pool.  When hit, httpx.TimeoutException is
# raised — Celery's autoretry_for includes httpx.RequestError (parent
# class) so transient stalls get retried automatically.
_LLM_TIMEOUT = httpx.Timeout(connect=10, read=120, write=10, pool=5)


class LLMClient:
    """Simple LLM client wrapper for OpenAI API."""

    def __init__(self, api_key: str = None, model: str = "gpt-4", base_url: str = None):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self.model = model
        self.base_url = base_url
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                from openai import OpenAI
                self._client = OpenAI(
                    api_key=self.api_key,
                    base_url=self.base_url,
                    timeout=_LLM_TIMEOUT,
                )
            except ImportError:
                raise ImportError("Please install openai: pip install openai")
        return self._client

    def generate(self, prompt: str) -> str:
        """Generate response from LLM."""
        client = self._get_client()
        response = client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1
        )
        return response.choices[0].message.content


class KnowledgeGraphConstructor:
    """
    Automatic Knowledge Graph Constructor using Schema.org
    
    Pipeline:
    1. Ingest text
    2. Extract entities aligned with Schema.org types
    3. Extract relationships using Schema.org properties
    4. Build and output knowledge graph in JSON-LD format
    """
    
    # URI prefix constant - single source of truth
    URI_PREFIX = "urn:kg"
    
    def __init__(self, api_key: str = None, model: str = "gpt-4", base_url: str = None):
        # Initialize LLM client
        self.llm_client = LLMClient(api_key=api_key, model=model, base_url=base_url)
        
        # Load Schema.org definitions
        self.schema_loader = SchemaOrgLoader()
        
        # Entity extractor with Schema.org mapping
        self.entity_extractor = SchemaOrgEntityExtractor(
            llm_client=self.llm_client,
            schema_loader=self.schema_loader
        )
        
        # Knowledge graph storage
        self.entities: Dict[str, SchemaOrgEntity] = {}
        self.relations: List[SchemaOrgRelation] = []
        self.texts: List[str] = []
    
    def _build_uri(self, entity_id: str) -> str:
        """
        Build a consistent URI for an entity.
        Ensures no spaces or invalid characters in the URI.
        """
        clean_id = re.sub(r'\s+', '', entity_id)
        clean_id = re.sub(r'[^a-zA-Z0-9\-_.]', '', clean_id)
        return f"{self.URI_PREFIX}:{clean_id}"
    
    def _sanitize_id(self, text: str) -> str:
        """Sanitize text to create a valid ID."""
        clean = re.sub(r'\s+', '', text)
        clean = re.sub(r'[^a-zA-Z0-9\-_.]', '', clean)
        return clean.lower()
    
    def add_text(self, text: str, speaker: str = "user", timestamp: str = None):
        """
        Add text to the knowledge graph.
        """
        self.texts.append(text)
        
        # Extract entities and relations
        entities, relations = self.entity_extractor.extract_entities_and_relations(text)
        
        # Create Schema.org-aligned entities
        for entity_data in entities:
            entity = SchemaOrgEntity(
                name=entity_data["name"],
                schema_type=entity_data["type"],
                schema_uri=f"https://schema.org/{entity_data['type']}",
                properties=entity_data.get("properties", {})
            )
            entity_key = f"{entity.schema_type}:{self._sanitize_id(entity.name)}"
            if entity_key not in self.entities:
                self.entities[entity_key] = entity
        
        # Create relations
        for rel_data in relations:
            subject_key = self._find_entity_key(rel_data["subject"])
            object_key = self._find_entity_key(rel_data["object"])
            
            if subject_key and object_key:
                relation = SchemaOrgRelation(
                    subject_id=self.entities[subject_key].entity_id,
                    predicate=rel_data["predicate"],
                    predicate_uri=f"https://schema.org/{rel_data['predicate']}",
                    object_id=self.entities[object_key].entity_id
                )
                self.relations.append(relation)
    
    def _find_entity_key(self, name: str) -> Optional[str]:
        """Find entity key by name."""
        sanitized_name = self._sanitize_id(name)
        for key, entity in self.entities.items():
            if self._sanitize_id(entity.name) == sanitized_name:
                return key
        return None
    
    def finalize(self):
        """Finalize the knowledge graph."""
        print(f"Knowledge graph finalized with {len(self.entities)} entities and {len(self.relations)} relations.")
    
    def query(self, question: str) -> str:
        """Query the knowledge graph using LLM."""
        context_parts = []
        for entity in self.entities.values():
            props = ", ".join([f"{k}: {v}" for k, v in entity.properties.items()])
            context_parts.append(f"{entity.name} (type: {entity.schema_type}, {props})")
        
        for relation in self.relations:
            subject = next((e for e in self.entities.values() if e.entity_id == relation.subject_id), None)
            obj = next((e for e in self.entities.values() if e.entity_id == relation.object_id), None)
            if subject and obj:
                context_parts.append(f"{subject.name} {relation.predicate} {obj.name}")
        
        context = "\n".join(context_parts)
        
        prompt = f"""Based on the following knowledge graph, answer the question.

Knowledge Graph:
{context}

Question: {question}

Answer concisely based only on the information in the knowledge graph."""

        return self.llm_client.generate(prompt)
    
    def to_jsonld(self) -> Dict[str, Any]:
        """Export knowledge graph as JSON-LD."""
        graph = []
        
        entity_uri_map: Dict[str, str] = {}
        for entity in self.entities.values():
            entity_uri_map[entity.entity_id] = self._build_uri(entity.entity_id)
        
        for entity in self.entities.values():
            node = {
                "@id": entity_uri_map[entity.entity_id],
                "@type": entity.schema_type,
                "name": entity.name,
                **entity.properties
            }
            graph.append(node)
        
        for relation in self.relations:
            subject_uri = entity_uri_map.get(relation.subject_id)
            object_uri = entity_uri_map.get(relation.object_id)
            
            if subject_uri and object_uri:
                for node in graph:
                    if node["@id"] == subject_uri:
                        node[relation.predicate] = {"@id": object_uri}
                        break
        
        return {
            "@context": "https://schema.org",
            "@graph": graph
        }
    
    def to_rdf(self) -> str:
        """Export as RDF/Turtle format."""
        lines = [
            "@prefix schema: <https://schema.org/> .",
            f"@prefix kg: <{self.URI_PREFIX}:> .",
            ""
        ]
        
        for entity in self.entities.values():
            clean_id = self._sanitize_id(entity.entity_id)
            lines.append(f'kg:{clean_id} a schema:{entity.schema_type} ;')
            lines.append(f'    schema:name "{entity.name}" .')
            lines.append("")
        
        for relation in self.relations:
            subject_id = self._sanitize_id(relation.subject_id)
            object_id = self._sanitize_id(relation.object_id)
            lines.append(f'kg:{subject_id} schema:{relation.predicate} kg:{object_id} .')
        
        return "\n".join(lines)
    
    def get_stats(self) -> Dict[str, int]:
        """Get statistics about the knowledge graph."""
        return {
            "entities": len(self.entities),
            "relations": len(self.relations),
            "texts_processed": len(self.texts)
        }
