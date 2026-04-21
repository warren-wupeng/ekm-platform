"""add yjs_state column to knowledge_items

Revision ID: 0017
Revises: 0016
Create Date: 2026-04-24
"""
from alembic import op
import sqlalchemy as sa

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("knowledge_items", sa.Column("yjs_state", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("knowledge_items", "yjs_state")
