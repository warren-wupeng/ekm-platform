"""
Schema.org Entity Extractor

LLM-based entity extraction with Schema.org type mapping.
"""

from typing import List, Dict, Tuple
import json


class SchemaOrgEntityExtractor:
    """Extract entities from text and map to Schema.org types."""
    
    # Mapping from entity categories to Schema.org types
    TYPE_MAPPING = {
        "person": "Person",
        "people": "Person",
        "company": "Organization",
        "organization": "Organization",
        "corporation": "Corporation",
        "startup": "Organization",
        "location": "Place",
        "place": "Place",
        "city": "City",
        "country": "Country",
        "address": "PostalAddress",
        "event": "Event",
        "conference": "Event",
        "meeting": "Event",
        "product": "Product",
        "software": "SoftwareApplication",
        "service": "Service",
        "article": "Article",
        "book": "Book",
        "movie": "Movie",
        "restaurant": "Restaurant",
        "hotel": "Hotel",
    }
    
    # Relationship mapping to Schema.org properties
    RELATION_MAPPING = {
        "works_for": "worksFor",
        "works_at": "worksFor",
        "employed_by": "worksFor",
        "employee_of": "worksFor",
        "located_in": "location",
        "located_at": "location",
        "based_in": "location",
        "headquarters": "location",
        "knows": "knows",
        "met": "knows",
        "colleague": "colleague",
        "member_of": "memberOf",
        "part_of": "memberOf",
        "created": "creator",
        "author_of": "author",
        "founded": "founder",
        "manufacturer": "manufacturer",
        "produces": "manufacturer",
        "made_by": "manufacturer",
        "attended": "attendee",
        "participated_in": "attendee",
        "spoke_at": "performer",
        "ceo_of": "employee",
        "leads": "employee",
        "subsidiary_of": "parentOrganization",
        "owns": "ownerOf",
    }
    
    def __init__(self, llm_client, schema_loader=None):
        self.llm_client = llm_client
        self.schema_loader = schema_loader
        
    def extract_entities_and_relations(self, text: str) -> Tuple[List[Dict], List[Dict]]:
        """Use LLM to extract entities and relations aligned with Schema.org."""
        
        common_types = ["Person", "Organization", "Place", "Event", "Product", "CreativeWork"]
        
        prompt = f"""Analyze the following text and extract ALL entities and relationships.

Text: "{text}"

Instructions:
1. Extract EVERY named entity (people, organizations, places, events, products, etc.)
2. Extract ALL relationships between entities, including implicit ones
3. Resolve coreferences (e.g., "She" -> "Alice", "Their" -> the company mentioned)
4. For job titles like "CEO", "engineer", extract as a property AND as a relationship

Entity Types to use: {', '.join(common_types)}

Relationship predicates to use:
- worksFor (person works at organization)
- location (thing is located at place)
- knows (person knows person)
- attendee (person attended event)
- manufacturer (organization makes product)
- founder (person founded organization)
- jobTitle (person's role - as property)

Respond ONLY with valid JSON:
{{
    "entities": [
        {{
            "name": "exact name from text",
            "type": "Person|Organization|Place|Event|Product",
            "properties": {{"jobTitle": "...", "description": "..."}}
        }}
    ],
    "relations": [
        {{
            "subject": "entity name",
            "predicate": "worksFor|location|knows|attendee|manufacturer",
            "object": "entity name"
        }}
    ]
}}

Be thorough - extract every entity and relationship mentioned or implied."""

        response = self.llm_client.generate(prompt)
        return self._parse_response(response)
    
    def _parse_response(self, response: str) -> Tuple[List[Dict], List[Dict]]:
        """Parse LLM response into entities and relations."""
        try:
            # Handle markdown code blocks if present
            if "```json" in response:
                response = response.split("```json")[1].split("```")[0]
            elif "```" in response:
                response = response.split("```")[1].split("```")[0]
            
            data = json.loads(response.strip())
            return data.get("entities", []), data.get("relations", [])
        except json.JSONDecodeError as e:
            print(f"Warning: Failed to parse LLM response: {e}")
            return [], []
    
    def map_to_schemaorg(self, entity_type: str) -> str:
        """Map extracted entity type to Schema.org URI."""
        schema_type = self.TYPE_MAPPING.get(entity_type.lower(), "Thing")
        return f"https://schema.org/{schema_type}"
