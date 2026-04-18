"""document_chunks + document_parse_records

Adds the two tables introduced by the RAG pipeline work:
- document_chunks: per-paragraph parsed text + Qdrant point ids (source of
  truth so ES/Qdrant can be rebuilt)
- document_parse_records: async parse lifecycle + last Celery task id, so
  the API can refuse duplicate parse requests and surface errors

Both tables CASCADE off knowledge_items — deleting a file cleans up its
chunks and parse record in one shot.

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── document_chunks ──────────────────────────────────────────────────────
    op.create_table(
        "document_chunks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "knowledge_item_id",
            sa.Integer(),
            sa.ForeignKey("knowledge_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Ordinal position within the document — lets us re-assemble or cite
        # "paragraph 3" in answers.
        sa.Column("chunk_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=False, server_default="0"),
        # Qdrant point ID; nullable until the embedding job populates it.
        sa.Column("vector_id", sa.String(100), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_document_chunks_id", "document_chunks", ["id"])
    op.create_index(
        "ix_document_chunks_knowledge_item_id",
        "document_chunks",
        ["knowledge_item_id"],
    )

    # ── document_parse_records ───────────────────────────────────────────────
    parse_status = sa.Enum(
        "pending", "parsing", "parsed", "failed", name="parsestatus",
    )
    parse_status.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "document_parse_records",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "knowledge_item_id",
            sa.Integer(),
            sa.ForeignKey("knowledge_items.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "status",
            parse_status,
            nullable=False,
            server_default="pending",
        ),
        sa.Column("task_id", sa.String(100), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        # JSON-serialized extracted metadata (title, author, page_count, …).
        # Stored as Text to avoid jsonb dialect coupling — we rarely query
        # into it, so a string column keeps the migration portable.
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_document_parse_records_knowledge_item_id",
        "document_parse_records",
        ["knowledge_item_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_document_parse_records_knowledge_item_id",
        table_name="document_parse_records",
    )
    op.drop_table("document_parse_records")
    op.execute("DROP TYPE IF EXISTS parsestatus")

    op.drop_index(
        "ix_document_chunks_knowledge_item_id",
        table_name="document_chunks",
    )
    op.drop_index("ix_document_chunks_id", table_name="document_chunks")
    op.drop_table("document_chunks")
