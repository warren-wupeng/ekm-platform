# EKM Database ERD

## Schema Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           EKM Core Schema                               │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐          ┌──────────────────────────┐
│      users       │          │      knowledge_items     │
├──────────────────┤          ├──────────────────────────┤
│ id (PK)          │◄────┐    │ id (PK)                  │
│ email (UQ)       │     │    │ name                     │
│ username (UQ)    │     │    │ description              │
│ display_name     │     │    │ file_path                │
│ hashed_password  │     │    │ file_type (enum)         │
│ avatar_url       │     │    │ mime_type                │
│ department       │     │    │ size                     │
│ bio              │     │    │ download_count           │
│ role (enum)      │     │    │ view_count               │
│ is_active        │     │    │ is_archived              │
│ last_login_at    │     └────│ uploader_id (FK→users)   │
│ created_at       │          │ category_id (FK→cats)    │
│ updated_at       │          │ created_at               │
└──────────────────┘          │ updated_at               │
        │                     └──────────────────────────┘
        │                                │
        │                       ┌────────┴──────────┐
        │                       │                   │
        │              ┌────────────────┐   ┌───────────────────┐
        │              │ tag_assignments│   │    categories     │
        │              ├────────────────┤   ├───────────────────┤
        │              │ id (PK)        │   │ id (PK)           │
        │              │ knowledge_item_│   │ name              │
        │              │   id (FK)      │   │ slug (UQ)         │
        │              │ tag_id (FK)    │   │ parent_id (FK→self│
        │              │ created_at     │   │ description       │
        │              └───────┬────────┘   │ sort_order        │
        │                      │            │ created_at        │
        │              ┌───────▼────────┐   └───────────────────┘
        │              │      tags      │
        │              ├────────────────┤
        │              │ id (PK)        │
        │              │ name (UQ)      │
        │              │ color          │
        │              │ usage_count    │
        │              │ created_at     │
        │              └────────────────┘
        │
        │    ┌──────────────────────────┐
        └───►│     sharing_records      │
             ├──────────────────────────┤
             │ id (PK)                  │
             │ knowledge_item_id (FK)   │
             │ shared_by_id (FK→users)  │
             │ shared_to_user_id (FK)   │
             │ shared_to_department     │
             │ permission (enum)        │
             │ token (UQ)               │
             │ expires_at               │
             │ created_at               │
             └──────────────────────────┘

        ┌──────────────────────────┐
        │       audit_logs         │
        ├──────────────────────────┤
        │ id (PK)                  │
        │ actor_id (FK→users)      │
        │ action (enum)            │
        │ resource_type            │
        │ resource_id              │
        │ detail (JSON)            │
        │ ip_address               │
        │ user_agent               │
        │ created_at (indexed)     │
        └──────────────────────────┘

┌──────────────────────────┐     ┌──────────────────────────┐
│        kg_nodes          │     │        kg_edges           │
├──────────────────────────┤     ├──────────────────────────┤
│ id (PK)                  │◄───►│ id (PK)                  │
│ external_id (UQ)         │     │ source_id (FK→kg_nodes)  │
│ label (indexed)          │     │ target_id (FK→kg_nodes)  │
│ entity_type (indexed)    │     │ relation_type            │
│ properties (JSON)        │     │ properties (JSON)        │
│ created_by_id (FK→users) │     │ created_at               │
│ created_at               │     │ UQ(source,target,rel)    │
│ updated_at               │     └──────────────────────────┘
└──────────────────────────┘
```

## Enums

| Enum | Values |
|------|--------|
| `userrole` | `admin`, `editor`, `viewer` |
| `filetype` | `document`, `image`, `archive`, `audio`, `video`, `other` |
| `sharepermission` | `view`, `download`, `edit` |
| `auditaction` | `upload`, `download`, `delete`, `share`, `login`, `logout`, `update`, `view` |

## Key Design Decisions

- **`users.hashed_password` nullable** — SSO users (Keycloak/ADFS) have no local password
- **`knowledge_items.uploader_id` ON DELETE SET DEFAULT** — files persist when user is deleted
- **`sharing_records.token`** — public link sharing; null = private/user share only
- **`kg_nodes.external_id`** — decoupled from internal PK for frontend compatibility (e.g. `"n1"`)
- **`audit_logs.detail` JSON** — flexible metadata per action type; no strict schema needed
- **Self-referencing `categories.parent_id`** — unlimited nesting depth for category tree

## Migration

```bash
cd backend
alembic upgrade head   # apply all migrations
alembic downgrade -1   # roll back one step
alembic revision --autogenerate -m "description"  # generate new migration
```
