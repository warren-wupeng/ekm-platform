"""Archive-rule evaluation + sweep helpers.

Split from the Celery task so:
  1. Unit tests can exercise rule resolution without a broker
  2. An admin "preview this rule" endpoint can call resolve_effective_days()
     to show affected items before saving
  3. The tick task stays thin + readable

Rule matching:
  - A rule matches an item if every set field on the rule matches. NULL
    on the rule = wildcard for that field.
  - Multiple rules can match the same item. We take the *tightest*
    (smallest inactive_days) so the most aggressive policy wins. That way
    a general "180d" fallback rule coexists with a "audio: 30d" override.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.models.archive import ArchiveRule
from app.models.knowledge import FileType, KnowledgeItem

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class EffectiveRule:
    """The winning threshold for one item."""
    inactive_days: int
    rule_id: int
    rule_name: str


def resolve_effective_rule(
    db: Session, item: KnowledgeItem, rules: list[ArchiveRule]
) -> EffectiveRule | None:
    """Find the tightest matching rule for one item, or None if none match."""
    matching: list[ArchiveRule] = []
    for r in rules:
        if not r.enabled:
            continue
        if r.category_id is not None and r.category_id != item.category_id:
            continue
        if r.file_type is not None and r.file_type != item.file_type:
            continue
        matching.append(r)
    if not matching:
        return None
    winner = min(matching, key=lambda r: r.inactive_days)
    return EffectiveRule(
        inactive_days=winner.inactive_days,
        rule_id=winner.id,
        rule_name=winner.name,
    )


def load_active_rules(db: Session) -> list[ArchiveRule]:
    return list(
        db.execute(
            select(ArchiveRule).where(ArchiveRule.enabled.is_(True))
        ).scalars().all()
    )


def fetch_candidates(db: Session) -> list[KnowledgeItem]:
    """Items that are eligible to be considered for archive.

    We pull all non-archived items and let the Python side apply per-rule
    matching. The table stays small relative to a full content index, and
    per-rule SQL would multiply the query count. If the table grows past
    ~100k, swap this for a per-rule filtered query.
    """
    return list(
        db.execute(
            select(KnowledgeItem).where(KnowledgeItem.is_archived.is_(False))
        ).scalars().all()
    )
