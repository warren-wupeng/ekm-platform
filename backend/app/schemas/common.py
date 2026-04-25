"""Shared response/pagination schemas."""

from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ResponseOK(BaseModel, Generic[T]):
    success: bool = True
    data: T


class ResponseList(BaseModel, Generic[T]):
    success: bool = True
    data: list[T]
    total: int
    page: int
    page_size: int


class ErrorDetail(BaseModel):
    code: str
    message: str


class ResponseError(BaseModel):
    success: bool = False
    error: ErrorDetail
