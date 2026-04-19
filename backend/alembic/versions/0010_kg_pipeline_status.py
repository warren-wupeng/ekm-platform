"""kg extraction pipeline status on KnowledgeItem.

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-19

Adds six columns to `knowledge_items` plus a new `kg_pipeline_status`
enum. This tracks the end-to-end KG extraction pipeline (#48):
parse → index → vectorize → extract. `kg_status` is what the frontend
polls; `kg_stage` records the last attempted stage so ops can see
"failed at extract" without cross-referencing logs.

An index on `kg_status` supports the "show me all failed pipelines"
admin view.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Create the enum type once and reuse it for the column — avoids the
# "pre-create enum AND create_type=True" gotcha from alembic 0002/0005.
kg_status_enum = sa.Enum(
    "pending", "running", "done", "skipped", "failed",
    name="kg_pipeline_status",
)


def upgrade() -> None:
    # 1. Create the enum explicitly so we can reference it from add_column
    #    with create_type=False (avoids double-create on reruns).
    kg_status_enum.create(op.get_bind(), checkfirst=True)

    # 2. KnowledgeItem pipeline columns.
    op.add_column(
        "knowledge_items",
        sa.Column(
            "kg_status",
            sa.Enum(
                "pending", "running", "done", "skipped", "failed",
                name="kg_pipeline_status",
                create_type=False,
            ),
            nullable=False,
            server_default="pending",
        ),
    )
    op.create_index(
        "ix_knowledge_items_kg_status",
        "knowledge_items",
        ["kg_status"],
    )
    op.add_column(
        "knowledge_items",
        sa.Column("kg_stage", sa.String(length=30), nullable=True),
    )
    op.add_column(
        "knowledge_items",
        sa.Column("kg_error", sa.Text(), nullable=True),
    )
    op.add_column(
        "knowledge_items",
        sa.Column("kg_task_id", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "knowledge_items",
        sa.Column("kg_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "knowledge_items",
        sa.Column("kg_completed_at", sa.DateTime(timezone=True), nullable=True),
    )

    # 3. Drop the server_default now that existing rows have been
    #    backfilled to 'pending'. The ORM supplies the default going
    #    forward; keeping the DB-side default would let raw SQL inserts
    #    bypass it silently.
    op.alter_column("knowledge_items", "kg_status", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_knowledge_items_kg_status", table_name="knowledge_items")
    op.drop_column("knowledge_items", "kg_completed_at")
    op.drop_column("knowledge_items", "kg_started_at")
    op.drop_column("knowledge_items", "kg_task_id")
    op.drop_column("knowledge_items", "kg_error")
    op.drop_column("knowledge_items", "kg_stage")
    op.drop_column("knowledge_items", "kg_status")
    kg_status_enum.drop(op.get_bind(), checkfirst=True)
