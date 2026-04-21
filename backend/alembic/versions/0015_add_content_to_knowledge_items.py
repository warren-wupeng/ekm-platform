"""add content column to knowledge_items

Revision ID: 0015
Revises: 0014
Create Date: 2026-04-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("knowledge_items", sa.Column("content", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("knowledge_items", "content")
