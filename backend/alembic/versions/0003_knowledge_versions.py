"""knowledge_versions

Append-only snapshot history per KnowledgeItem. See models/version.py for
design notes.

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "knowledge_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "knowledge_item_id",
            sa.Integer(),
            sa.ForeignKey("knowledge_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("name_snapshot", sa.String(500), nullable=False),
        sa.Column("description_snapshot", sa.Text(), nullable=True),
        sa.Column("file_path_snapshot", sa.String(1000), nullable=True),
        sa.Column("size_snapshot", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("content_text", sa.Text(), nullable=True),
        sa.Column("change_summary", sa.String(500), nullable=True),
        sa.Column(
            "created_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "knowledge_item_id", "version_number",
            name="uq_knowledge_versions_item_version",
        ),
    )
    op.create_index(
        "ix_knowledge_versions_knowledge_item_id",
        "knowledge_versions",
        ["knowledge_item_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_knowledge_versions_knowledge_item_id",
        table_name="knowledge_versions",
    )
    op.drop_table("knowledge_versions")
