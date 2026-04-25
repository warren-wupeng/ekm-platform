"""KGNode and KGEdge — knowledge graph models."""

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class KGNode(Base):
    __tablename__ = "kg_nodes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    external_id: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )  # e.g. "n1"
    label: Mapped[str] = mapped_column(String(500), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    properties: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    outgoing_edges: Mapped[list["KGEdge"]] = relationship(
        "KGEdge",
        foreign_keys="KGEdge.source_id",
        back_populates="source",
        cascade="all, delete-orphan",
    )
    incoming_edges: Mapped[list["KGEdge"]] = relationship(
        "KGEdge",
        foreign_keys="KGEdge.target_id",
        back_populates="target",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<KGNode id={self.id} label={self.label} type={self.entity_type}>"


class KGEdge(Base):
    __tablename__ = "kg_edges"
    __table_args__ = (UniqueConstraint("source_id", "target_id", "relation_type"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    source_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("kg_nodes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("kg_nodes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    relation_type: Mapped[str] = mapped_column(String(200), nullable=False)
    properties: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True, index=True)
    needs_review: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    reviewed_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    source: Mapped["KGNode"] = relationship(
        "KGNode", foreign_keys=[source_id], back_populates="outgoing_edges"
    )
    target: Mapped["KGNode"] = relationship(
        "KGNode", foreign_keys=[target_id], back_populates="incoming_edges"
    )
    reviewer = relationship("User", foreign_keys=[reviewed_by_id])

    def __repr__(self) -> str:
        return f"<KGEdge {self.source_id}--[{self.relation_type}]-->{self.target_id}>"
