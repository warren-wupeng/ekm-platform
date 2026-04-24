"""KnowledgeItem, Category, Tag, TagAssignment models."""

from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
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


class KGPipelineStatus(str, PyEnum):
    """End-to-end KG extraction pipeline status on a KnowledgeItem.

    The pipeline is orchestrated in `services/kg_pipeline.run_pipeline`
    and covers four stages: parse → index → vectorize → extract. The
    frontend polls this to drive the upload UI's "processing / ready /
    failed" states.

    SKIPPED is for file types we don't run the pipeline on (images,
    archives, audio/video) — so the UI can render "不适用" instead of
    "处理中" for a PNG that will never get chunks.
    """

    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    SKIPPED = "skipped"
    FAILED = "failed"


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    parent_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    parent: Mapped["Category | None"] = relationship(
        "Category", remote_side="Category.id", back_populates="children"
    )
    children: Mapped[list["Category"]] = relationship("Category", back_populates="parent")
    knowledge_items: Mapped[list["KnowledgeItem"]] = relationship(
        "KnowledgeItem", back_populates="category"
    )

    def __repr__(self) -> str:
        return f"<Category id={self.id} slug={self.slug}>"


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    usage_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    assignments: Mapped[list["TagAssignment"]] = relationship("TagAssignment", back_populates="tag")

    def __repr__(self) -> str:
        return f"<Tag id={self.id} name={self.name}>"


class KnowledgeItem(Base):
    __tablename__ = "knowledge_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # Rich-text content from the collaborative Tiptap editor (HTML snapshot).
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Binary Yjs document state, base64-encoded.  Hocuspocus onStoreDocument
    # writes this so the next connection can bootstrap from the authoritative
    # state instead of an empty Y.Doc.
    yjs_state: Mapped[str | None] = mapped_column(Text, nullable=True)
    # values_callable is load-bearing: the `filetype` Postgres enum type was
    # created with lowercase values ("document", "image", …) in 0001, but
    # SQLAlchemy's default is to serialize Python enum *names* (uppercase
    # "DOCUMENT"). Mismatch → every insert raises
    # `invalid input value for enum filetype: "DOCUMENT"`. Pin to `.value`
    # so what we write matches what Postgres declared.
    file_type: Mapped[FileType] = mapped_column(
        Enum(FileType, values_callable=lambda obj: [e.value for e in obj]),
        default=FileType.OTHER,
        nullable=False,
    )
    mime_type: Mapped[str | None] = mapped_column(String(200), nullable=True)
    size: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    download_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    view_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Timestamp of the auto-archive event (NULL if never archived or manually
    # archived via legacy path). Lets the UI explain *why* an item is archived
    # and gives admins a cutoff for "restore the last 30 days of archives".
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
    )
    # Last time a reminder was sent for this item's upcoming auto-archive.
    # Reset to NULL when the item is touched (service layer clears this on
    # update). See services/archive.py for the "once per pre-archive window"
    # guard.
    archive_reminder_sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Knowledge-graph pipeline state (US-048). One outer Celery task
    # (`ekm.kg.pipeline`) drives parse → index → vectorize → extract.
    # `kg_status` is the top-level state the frontend polls; `kg_stage`
    # records the last attempted stage so ops can see "failed at extract"
    # without cross-referencing logs.
    kg_status: Mapped[KGPipelineStatus] = mapped_column(
        Enum(
            KGPipelineStatus,
            name="kg_pipeline_status",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        default=KGPipelineStatus.PENDING,
        nullable=False,
        index=True,
    )
    kg_stage: Mapped[str | None] = mapped_column(String(30), nullable=True)
    kg_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    kg_task_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    kg_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    kg_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    uploader_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET DEFAULT"), nullable=False
    )
    category_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    uploader: Mapped["User"] = relationship("User", back_populates="knowledge_items")
    category: Mapped["Category | None"] = relationship("Category", back_populates="knowledge_items")
    tag_assignments: Mapped[list["TagAssignment"]] = relationship(
        "TagAssignment", back_populates="knowledge_item", cascade="all, delete-orphan"
    )
    sharing_records: Mapped[list["SharingRecord"]] = relationship(
        "SharingRecord", back_populates="knowledge_item", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<KnowledgeItem id={self.id} name={self.name}>"


class TagAssignment(Base):
    __tablename__ = "tag_assignments"
    __table_args__ = (UniqueConstraint("knowledge_item_id", "tag_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    knowledge_item_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("knowledge_items.id", ondelete="CASCADE"), nullable=False
    )
    tag_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tags.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    knowledge_item: Mapped["KnowledgeItem"] = relationship(
        "KnowledgeItem", back_populates="tag_assignments"
    )
    tag: Mapped["Tag"] = relationship("Tag", back_populates="assignments")
