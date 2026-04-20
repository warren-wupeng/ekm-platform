"""Normalize enum column values to lowercase.

Revision ID: 0012
Revises: 0011
Create Date: 2026-04-20

PR #99 fixed the SQLAlchemy Enum mapping (values_callable) so *new*
rows write lowercase values. But rows written before that fix — or via
raw SQL seed scripts — may carry uppercase enum names ("DOCUMENT"
instead of "document").  This data migration normalises them in-place.

The Postgres enum types (filetype, parsestatus, feedback_rating) only
accept the lowercase variants, so if the column is a true PG enum the
uppercase rows can't exist.  However, some test / staging environments
may have used VARCHAR columns or bypassed constraints.  Running
LOWER() on already-lowercase text is a no-op, so this migration is
always safe.
"""
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Cast to text, lowercase, cast back.  For true Postgres enum
    # columns this is effectively a no-op (values are already lowercase
    # in the type definition).  For VARCHAR-backed columns it normalises
    # any uppercase leftovers.
    #
    # We use text casts to avoid "invalid input value" errors on enum
    # columns that reject uppercase at the type level.
    op.execute(
        "UPDATE knowledge_items "
        "SET file_type = LOWER(file_type::text)::filetype "
        "WHERE file_type::text <> LOWER(file_type::text)"
    )
    op.execute(
        "UPDATE document_parse_records "
        "SET status = LOWER(status::text)::parsestatus "
        "WHERE status::text <> LOWER(status::text)"
    )
    op.execute(
        "UPDATE chat_feedback "
        "SET rating = LOWER(rating::text)::feedback_rating "
        "WHERE rating::text <> LOWER(rating::text)"
    )


def downgrade() -> None:
    # Intentional no-op.  We don't want to reintroduce uppercase values.
    pass
