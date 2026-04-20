"""
Schema.org Type Loader

Loads and queries Schema.org type definitions for entity alignment.
"""

import rdflib
from typing import Dict, List, Optional


class SchemaOrgLoader:
    """Load and query Schema.org type definitions."""
    
    def __init__(self, schema_path: str = None):
        self.graph = rdflib.Graph()
        self.types: Dict[str, dict] = {}
        self.properties: Dict[str, dict] = {}
        if schema_path:
            self._load_schema(schema_path)
    
    def _load_schema(self, path: str):
        """Load schema.org definitions from JSON-LD."""
        self.graph.parse(path, format="json-ld")
        
        # Extract types (Classes)
        for s, p, o in self.graph.triples((None, rdflib.RDF.type, rdflib.RDFS.Class)):
            type_id = str(s).replace("http://schema.org/", "").replace("https://schema.org/", "")
            self.types[type_id] = {
                "uri": str(s),
                "label": type_id,
                "supertypes": self._get_supertypes(s),
                "properties": []
            }
        
        # Extract properties
        for s, p, o in self.graph.triples((None, rdflib.RDF.type, rdflib.RDF.Property)):
            prop_id = str(s).replace("http://schema.org/", "").replace("https://schema.org/", "")
            self.properties[prop_id] = {
                "uri": str(s),
                "label": prop_id,
                "domain_includes": self._get_domain(s),
                "range_includes": self._get_range(s)
            }
    
    def _get_supertypes(self, uri) -> List[str]:
        """Get parent types."""
        supers = []
        for _, _, o in self.graph.triples((uri, rdflib.RDFS.subClassOf, None)):
            supers.append(str(o).replace("http://schema.org/", "").replace("https://schema.org/", ""))
        return supers
    
    def _get_domain(self, uri) -> List[str]:
        """Get domain types for a property."""
        domain_uri = rdflib.URIRef("http://schema.org/domainIncludes")
        return [str(o).replace("http://schema.org/", "").replace("https://schema.org/", "") 
                for _, _, o in self.graph.triples((uri, domain_uri, None))]
    
    def _get_range(self, uri) -> List[str]:
        """Get range types for a property."""
        range_uri = rdflib.URIRef("http://schema.org/rangeIncludes")
        return [str(o).replace("http://schema.org/", "").replace("https://schema.org/", "") 
                for _, _, o in self.graph.triples((uri, range_uri, None))]
    
    def get_common_types(self) -> List[str]:
        """Get commonly used entity types for extraction."""
        return [
            "Person", "Organization", "Place", "Event", "Product",
            "CreativeWork", "LocalBusiness", "Article", "Book", 
            "Movie", "Restaurant", "Hotel", "MedicalEntity",
            "City", "Country", "Corporation", "SoftwareApplication"
        ]
    
    def get_common_properties(self) -> List[str]:
        """Get commonly used properties for relationships."""
        return [
            "worksFor", "location", "knows", "memberOf", "author",
            "creator", "attendee", "manufacturer", "founder",
            "employee", "alumni", "parentOrganization", "subOrganization",
            "jobTitle", "description", "name", "url"
        ]
