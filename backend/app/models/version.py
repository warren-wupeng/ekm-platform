"""KnowledgeVersion — immutable snapshot history for KnowledgeItem.

Every meaningful change to a KnowledgeItem records a new row here with the
full snapshot (not a delta). This trades a bit of storage for O(1) rollback
and simpler diffing — we can always re-compute diffs from snapshots, but
re-assembling a snapshot from deltas is more code for little upside at our
scale.

Rollback is append-only: reverting to v3 creates a new v(N+1) that copies
v3's fields. We never delete history — audit trails beat "clean" DBs.
"""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class KnowledgeVersion(Base):
    __tablename__ = "knowledge_versions"
    __table_args__ = (UniqueConstraint("knowledge_item_id", "version_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    knowledge_item_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("knowledge_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 1-based, monotonically increasing per item. Computed by the router
    # under a row lock on the parent item to avoid races.
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)

    # Snapshot fields. We copy the surface attributes that show up in the
    # UI; the file itself isn't copied — we reference the file_path at
    # that point in time and rely on the storage layer being append-only.
    name_snapshot: Mapped[str] = mapped_column(String(500), nullable=False)
    description_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_path_snapshot: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    size_snapshot: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    # Extracted plain text at snapshot time — populated lazily when chunks
    # are available; may be NULL for never-parsed items.
    content_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Human-readable summary of what changed vs the previous version.
    change_summary: Mapped[str | None] = mapped_column(String(500), nullable=True)

    created_by_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    knowledge_item: Mapped["KnowledgeItem"] = relationship(
        "KnowledgeItem",
        backref="versions",
    )

    def __repr__(self) -> str:
        return f"<KnowledgeVersion item={self.knowledge_item_id} v={self.version_number}>"
