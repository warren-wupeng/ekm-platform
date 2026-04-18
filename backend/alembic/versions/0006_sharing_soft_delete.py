"""sharing_records — soft delete with 30-day recovery window.

Revision ID: 0006_sharing_soft_delete
Revises: 0005
Create Date: 2026-04-18

Adds `deleted_at` to `sharing_records` so revoke becomes reversible for 30
days. The Celery beat task `ekm.sharing.purge_expired` hard-deletes rows
whose `deleted_at` is older than that window.

Note: picked a literal revision ID rather than `0006` so the migration
graph stays deterministic if another parallel PR also numbers at 0006 —
whoever merges second just updates `down_revision` during rebase.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0006_sharing_soft_delete"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sharing_records",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Plain index is fine — the purge scan uses `WHERE deleted_at < cutoff`,
    # and the active-list query uses `WHERE deleted_at IS NULL` which already
    # benefits from the NULLs-last B-tree default.
    op.create_index(
        "ix_sharing_records_deleted_at",
        "sharing_records",
        ["deleted_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_sharing_records_deleted_at", table_name="sharing_records")
    op.drop_column("sharing_records", "deleted_at")
