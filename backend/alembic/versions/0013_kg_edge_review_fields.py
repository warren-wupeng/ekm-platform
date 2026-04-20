"""Add confidence, review, and soft-delete fields to kg_edges.

Revision ID: 0013
Revises: 0012
Create Date: 2026-04-21

Issue #54: KG quality assessment + low-confidence relation review.
Adds fields for confidence scoring, human review workflow, and
soft-delete support to the kg_edges table.
"""
from alembic import op
import sqlalchemy as sa


revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("kg_edges", sa.Column("confidence", sa.Float(), nullable=True))
    op.add_column("kg_edges", sa.Column("needs_review", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("kg_edges", sa.Column("reviewed_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
    op.add_column("kg_edges", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("kg_edges", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))

    op.create_index("ix_kg_edges_confidence", "kg_edges", ["confidence"])
    op.create_index("ix_kg_edges_needs_review", "kg_edges", ["needs_review"])
    op.create_index("ix_kg_edges_deleted_at", "kg_edges", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("ix_kg_edges_deleted_at", table_name="kg_edges")
    op.drop_index("ix_kg_edges_needs_review", table_name="kg_edges")
    op.drop_index("ix_kg_edges_confidence", table_name="kg_edges")

    op.drop_column("kg_edges", "deleted_at")
    op.drop_column("kg_edges", "reviewed_at")
    op.drop_column("kg_edges", "reviewed_by_id")
    op.drop_column("kg_edges", "needs_review")
    op.drop_column("kg_edges", "confidence")
