"""
Configuration settings for the Knowledge Graph Constructor.
"""

# Default LLM settings
DEFAULT_MODEL = "gpt-4"
DEFAULT_TEMPERATURE = 0.1

# URI settings
URI_PREFIX = "urn:kg"

# Common Schema.org types
COMMON_ENTITY_TYPES = [
    "Person", "Organization", "Place", "Event", "Product",
    "CreativeWork", "LocalBusiness", "Article", "Book", 
    "Movie", "Restaurant", "Hotel", "City", "Country",
    "Corporation", "SoftwareApplication"
]

# Common Schema.org properties
COMMON_RELATION_PROPERTIES = [
    "worksFor", "location", "knows", "memberOf", "author",
    "creator", "attendee", "manufacturer", "founder",
    "employee", "alumni", "parentOrganization", "subOrganization",
    "jobTitle", "description", "name", "url"
]
