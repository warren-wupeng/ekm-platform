"""SharingRecord, AuditLog models."""

from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class SharePermission(str, PyEnum):
    VIEW = "view"
    DOWNLOAD = "download"
    EDIT = "edit"


class AuditAction(str, PyEnum):
    UPLOAD = "upload"
    DOWNLOAD = "download"
    DELETE = "delete"
    SHARE = "share"
    LOGIN = "login"
    LOGOUT = "logout"
    UPDATE = "update"
    VIEW = "view"


class SharingRecord(Base):
    __tablename__ = "sharing_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    knowledge_item_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("knowledge_items.id", ondelete="CASCADE"), nullable=False
    )
    shared_by_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    shared_to_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    shared_to_department: Mapped[str | None] = mapped_column(
        String(100), nullable=True
    )  # dept-level share
    permission: Mapped[SharePermission] = mapped_column(
        Enum(SharePermission, values_callable=lambda obj: [e.value for e in obj]),
        default=SharePermission.VIEW,
        nullable=False,
    )
    token: Mapped[str | None] = mapped_column(
        String(255), unique=True, index=True, nullable=True
    )  # public link token
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Soft-delete: NULL means active. Set to revoke-time; the owner can restore
    # within 30 days. A Celery beat task purges rows whose deleted_at is older
    # than the retention window.
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    knowledge_item: Mapped["KnowledgeItem"] = relationship(
        "KnowledgeItem", back_populates="sharing_records"
    )
    shared_by: Mapped["User"] = relationship(
        "User", foreign_keys=[shared_by_id], back_populates="sharing_records"
    )

    def __repr__(self) -> str:
        return f"<SharingRecord id={self.id} item={self.knowledge_item_id}>"


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    actor_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[AuditAction] = mapped_column(
        Enum(AuditAction, values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
        index=True,
    )
    resource_type: Mapped[str | None] = mapped_column(
        String(100), nullable=True
    )  # "knowledge_item", "user", etc.
    resource_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    actor: Mapped["User | None"] = relationship("User", back_populates="audit_logs")

    def __repr__(self) -> str:
        return f"<AuditLog id={self.id} action={self.action}>"
