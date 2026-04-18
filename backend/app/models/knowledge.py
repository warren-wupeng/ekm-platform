"""KnowledgeItem, Category, Tag, TagAssignment models."""
from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    BigInteger, Boolean, DateTime, Enum, ForeignKey, Integer,
    String, Text, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class FileType(str, PyEnum):
    DOCUMENT = "document"
    IMAGE = "image"
    ARCHIVE = "archive"
    AUDIO = "audio"
    VIDEO = "video"
    OTHER = "other"


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    parent_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    parent: Mapped["Category | None"] = relationship("Category", remote_side="Category.id", back_populates="children")
    children: Mapped[list["Category"]] = relationship("Category", back_populates="parent")
    knowledge_items: Mapped[list["KnowledgeItem"]] = relationship("KnowledgeItem", back_populates="category")

    def __repr__(self) -> str:
        return f"<Category id={self.id} slug={self.slug}>"


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    usage_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    assignments: Mapped[list["TagAssignment"]] = relationship("TagAssignment", back_populates="tag")

    def __repr__(self) -> str:
        return f"<Tag id={self.id} name={self.name}>"


class KnowledgeItem(Base):
    __tablename__ = "knowledge_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    file_type: Mapped[FileType] = mapped_column(Enum(FileType), default=FileType.OTHER, nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(200), nullable=True)
    size: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    download_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    view_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Timestamp of the auto-archive event (NULL if never archived or manually
    # archived via legacy path). Lets the UI explain *why* an item is archived
    # and gives admins a cutoff for "restore the last 30 days of archives".
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True,
    )
    # Last time a reminder was sent for this item's upcoming auto-archive.
    # Reset to NULL when the item is touched (service layer clears this on
    # update). See services/archive.py for the "once per pre-archive window"
    # guard.
    archive_reminder_sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    uploader_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET DEFAULT"), nullable=False)
    category_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    uploader: Mapped["User"] = relationship("User", back_populates="knowledge_items")  # noqa: F821
    category: Mapped["Category | None"] = relationship("Category", back_populates="knowledge_items")
    tag_assignments: Mapped[list["TagAssignment"]] = relationship("TagAssignment", back_populates="knowledge_item", cascade="all, delete-orphan")
    sharing_records: Mapped[list["SharingRecord"]] = relationship("SharingRecord", back_populates="knowledge_item", cascade="all, delete-orphan")  # noqa: F821

    def __repr__(self) -> str:
        return f"<KnowledgeItem id={self.id} name={self.name}>"


class TagAssignment(Base):
    __tablename__ = "tag_assignments"
    __table_args__ = (UniqueConstraint("knowledge_item_id", "tag_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    knowledge_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("knowledge_items.id", ondelete="CASCADE"), nullable=False)
    tag_id: Mapped[int] = mapped_column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    knowledge_item: Mapped["KnowledgeItem"] = relationship("KnowledgeItem", back_populates="tag_assignments")
    tag: Mapped["Tag"] = relationship("Tag", back_populates="assignments")
