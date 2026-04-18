"""DocumentChunk — parsed text segments for search + RAG.

One KnowledgeItem → N DocumentChunks. A chunk is the unit of both
Elasticsearch indexing (#16) and Qdrant vectorization (#22). Keeping them
in Postgres as source-of-truth means ES/Qdrant can be rebuilt from scratch.
"""
from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ParseStatus(str, PyEnum):
    PENDING = "pending"
    PARSING = "parsing"
    PARSED = "parsed"
    FAILED = "failed"


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    knowledge_item_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("knowledge_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Ordinal position within the document. Lets us re-assemble or cite
    # "paragraph 3" in answers.
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Qdrant point ID — nullable until #22 embeds it.
    vector_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    knowledge_item: Mapped["KnowledgeItem"] = relationship(  # noqa: F821
        "KnowledgeItem", backref="chunks",
    )

    def __repr__(self) -> str:
        return f"<DocumentChunk doc={self.knowledge_item_id} idx={self.chunk_index}>"


class DocumentParseRecord(Base):
    """Tracks async parse state so we don't re-queue in-flight jobs."""
    __tablename__ = "document_parse_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    knowledge_item_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("knowledge_items.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    status: Mapped[ParseStatus] = mapped_column(
        Enum(ParseStatus), default=ParseStatus.PENDING, nullable=False,
    )
    task_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Extracted metadata (title, author, page_count, content-type, etc.)
    # Stored as JSON-serialized text to avoid jsonb dialect coupling here.
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
