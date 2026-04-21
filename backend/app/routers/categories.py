"""Category CRUD with tree semantics.

Endpoints:
  GET    /api/v1/categories             — full tree (nested) or flat list
  GET    /api/v1/categories/{id}        — single node
  POST   /api/v1/categories             — create
  PATCH  /api/v1/categories/{id}        — partial update
  DELETE /api/v1/categories/{id}        — delete; children are "promoted"
                                           to the deleted node's parent so
                                           the tree doesn't lose branches.

The FK on categories.parent_id is `ondelete=SET NULL`, which is the DB-level
safety net. Our delete endpoint does the explicit re-parent step *first*
so children inherit the right ancestor instead of being orphaned at the root.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

import logging

from app.core.deps import CurrentUser, DB
from app.models.knowledge import Category
from app.services.es_client import es


_log = logging.getLogger(__name__)


async def _get_item_counts(db: Any) -> dict[int, int]:
    """Return {category_id: count} for all categories with items."""
    from app.models.knowledge import KnowledgeItem
    rows = (await db.execute(
        select(KnowledgeItem.category_id, func.count().label("cnt"))
        .where(KnowledgeItem.category_id.is_not(None))
        .group_by(KnowledgeItem.category_id)
    )).all()
    return {row[0]: row[1] for row in rows}


async def _es_index_category(c: Category) -> None:
    """Mirror a Category into ekm_tags (kind=category) for unified search."""
    try:
        await es.index_tag(tag_id=c.id, body={
            "id": c.id,
            "kind": "category",
            "name": c.name,
            "description": c.description,
            "slug": c.slug,
            "color": None,
            "usage_count": 0,
        })
    except Exception as exc:  # noqa: BLE001
        _log.warning("ES index_category failed id=%s: %s", c.id, exc)


async def _es_delete_category(cat_id: int) -> None:
    try:
        await es.delete_tag(tag_id=cat_id, kind="category")
    except Exception as exc:  # noqa: BLE001
        _log.warning("ES delete_category failed id=%s: %s", cat_id, exc)


router = APIRouter(prefix="/api/v1/categories", tags=["categories"])


# ─── Schemas ────────────────────────────────────────────────────────────────
class CategoryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    slug: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$")
    parent_id: int | None = None
    description: str | None = None
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    slug: str | None = Field(None, min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$")
    parent_id: int | None = None
    description: str | None = None
    sort_order: int | None = None


class CategoryOut(BaseModel):
    id: int
    name: str
    slug: str
    parent_id: int | None
    description: str | None
    sort_order: int
    children: list["CategoryOut"] = []

    class Config:
        from_attributes = True


CategoryOut.model_rebuild()


def _to_dict(c: Category, counts: dict[int, int] | None = None) -> dict[str, Any]:
    return {
        "id": c.id,
        "name": c.name,
        "slug": c.slug,
        "parent_id": c.parent_id,
        "description": c.description,
        "sort_order": c.sort_order,
        "item_count": counts.get(c.id, 0) if counts else 0,
        "children": [],
    }


def _build_tree(cats: list[Category], counts: dict[int, int] | None = None) -> list[dict[str, Any]]:
    """Assemble a nested tree from a flat list in O(n)."""
    nodes: dict[int, dict[str, Any]] = {c.id: _to_dict(c, counts) for c in cats}
    roots: list[dict[str, Any]] = []
    for c in cats:
        node = nodes[c.id]
        if c.parent_id and c.parent_id in nodes:
            nodes[c.parent_id]["children"].append(node)
        else:
            roots.append(node)
    # Roll up child counts to parent so the parent shows total descendants.
    def _rollup(nodes_list: list[dict[str, Any]]) -> int:
        total = 0
        for n in nodes_list:
            child_total = _rollup(n["children"])
            n["item_count"] += child_total
            total += n["item_count"]
        return total
    # Stable sort by sort_order then id within each level.
    def _sort(ns: list[dict[str, Any]]) -> None:
        ns.sort(key=lambda n: (n["sort_order"], n["id"]))
        for n in ns:
            _sort(n["children"])
    _rollup(roots)
    _sort(roots)
    return roots


# ─── Routes ─────────────────────────────────────────────────────────────────
@router.get("")
async def list_categories(
    db: DB,
    user: CurrentUser,
    flat: bool = Query(False, description="Return flat list instead of nested tree"),
):
    rows = (await db.execute(
        select(Category).order_by(Category.sort_order, Category.id)
    )).scalars().all()
    counts = await _get_item_counts(db)

    if flat:
        return {"categories": [_to_dict(c, counts) for c in rows]}
    return {"categories": _build_tree(list(rows), counts)}


@router.get("/{cat_id}")
async def get_category(cat_id: int, db: DB, user: CurrentUser):
    row = (await db.execute(
        select(Category).where(Category.id == cat_id)
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="category not found")
    return _to_dict(row)


@router.post("", status_code=201)
async def create_category(
    payload: CategoryCreate, db: DB, user: CurrentUser,
):
    if payload.parent_id is not None:
        parent = (await db.execute(
            select(Category).where(Category.id == payload.parent_id)
        )).scalar_one_or_none()
        if parent is None:
            raise HTTPException(status_code=400, detail="parent category not found")

    cat = Category(
        name=payload.name,
        slug=payload.slug,
        parent_id=payload.parent_id,
        description=payload.description,
        sort_order=payload.sort_order,
    )
    db.add(cat)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="slug already exists")
    await db.refresh(cat)
    await _es_index_category(cat)
    return _to_dict(cat)


@router.patch("/{cat_id}")
async def update_category(
    cat_id: int, payload: CategoryUpdate, db: DB, user: CurrentUser,
):
    cat = (await db.execute(
        select(Category).where(Category.id == cat_id)
    )).scalar_one_or_none()
    if cat is None:
        raise HTTPException(status_code=404, detail="category not found")

    if payload.parent_id is not None:
        if payload.parent_id == cat_id:
            raise HTTPException(status_code=400, detail="cannot set self as parent")
        # Prevent cycles — walk up the proposed parent chain.
        ancestor_id: int | None = payload.parent_id
        seen: set[int] = set()
        while ancestor_id is not None:
            if ancestor_id in seen:
                break  # paranoia; existing tree shouldn't have cycles
            seen.add(ancestor_id)
            if ancestor_id == cat_id:
                raise HTTPException(status_code=400, detail="cycle in category tree")
            parent = (await db.execute(
                select(Category.parent_id).where(Category.id == ancestor_id)
            )).scalar_one_or_none()
            ancestor_id = parent

    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(cat, k, v)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="slug already exists")
    await db.refresh(cat)
    await _es_index_category(cat)
    return _to_dict(cat)


@router.delete("/{cat_id}", status_code=204)
async def delete_category(cat_id: int, db: DB, user: CurrentUser):
    cat = (await db.execute(
        select(Category).where(Category.id == cat_id)
    )).scalar_one_or_none()
    if cat is None:
        raise HTTPException(status_code=404, detail="category not found")

    # Promote children to the deleted node's parent. This keeps the tree
    # intact (users don't suddenly find half their subtree unreachable).
    # The FK has ondelete=SET NULL as a safety net; doing it explicitly
    # lets us preserve grandparent lineage instead of orphaning at root.
    await db.execute(
        update(Category)
        .where(Category.parent_id == cat_id)
        .values(parent_id=cat.parent_id),
    )
    await db.delete(cat)
    await db.commit()
    await _es_delete_category(cat_id)
    return None
