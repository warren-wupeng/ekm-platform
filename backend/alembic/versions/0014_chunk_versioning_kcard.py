"""Chunk versioning + KCard table (Issue #43).

Revision ID: 0014
Revises: 0013
Create Date: 2026-04-21

Adds version, is_current, content_hash, doc_version to document_chunks.
Creates kcards table for chunk-level knowledge cards.
"""
from alembic import op
import sqlalchemy as sa


revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Chunk versioning columns.
    op.add_column("document_chunks", sa.Column("content_hash", sa.String(16), nullable=True))
    op.add_column("document_chunks", sa.Column("version", sa.Integer(), server_default="1", nullable=False))
    op.add_column("document_chunks", sa.Column("is_current", sa.Boolean(), server_default="true", nullable=False))
    op.add_column("document_chunks", sa.Column("doc_version", sa.Integer(), server_default="1", nullable=False))

    op.create_index("ix_document_chunks_content_hash", "document_chunks", ["content_hash"])
    op.create_index("ix_document_chunks_is_current", "document_chunks", ["is_current"])

    # KCard table.
    op.create_table(
        "kcards",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("chunk_id", sa.Integer(), sa.ForeignKey("document_chunks.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("kcards")

    op.drop_index("ix_document_chunks_is_current", table_name="document_chunks")
    op.drop_index("ix_document_chunks_content_hash", table_name="document_chunks")

    op.drop_column("document_chunks", "doc_version")
    op.drop_column("document_chunks", "is_current")
    op.drop_column("document_chunks", "version")
    op.drop_column("document_chunks", "content_hash")
