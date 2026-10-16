"""Request and response schemas for the RAG API."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    """Service health information."""

    status: Literal["ok"]
    service: str
    version: str


class DocumentSummary(BaseModel):
    """Metadata returned for an indexed document."""

    id: str
    name: str
    original_filename: str
    stored_filename: str
    content_type: str | None
    size_bytes: int
    chunk_count: int
    status: Literal["processing", "ready", "failed"]
    error: str | None = None
    created_at: datetime


class DocumentListResponse(BaseModel):
    """Persisted document listing response."""

    documents: list[DocumentSummary]
    message: str
    total: int


class DocumentCreateResponse(BaseModel):
    """Document ingestion response."""

    document: DocumentSummary
    message: str


class DocumentDeleteResponse(BaseModel):
    """Document deletion response."""

    id: str
    name: str
    message: str


class ChatRequest(BaseModel):
    """Payload for a RAG chat request."""

    question: str | None = Field(default=None, min_length=1)
    message: str | None = Field(default=None, min_length=1, description="Backward-compatible question field.")

    @property
    def resolved_question(self) -> str:
        """Return the canonical question from either supported request field."""
        return self.question or self.message or ""


class ChatSource(BaseModel):
    """A cited chunk used to assemble the answer."""

    document_id: str
    label: str
    chunk_id: str
    chunk_index: int
    snippet: str
    score: float
    keyword_score: float | None = None
    vector_score: float | None = None


class ChatResponse(BaseModel):
    """Evidence-grounded chat response."""

    answer: str
    sources: list[ChatSource]
    status: Literal["ok", "no_match"]
    strategy: Literal["hybrid", "keyword", "vector"] = "keyword"
    embedding_model: str | None = None
    answer_mode: Literal["llm", "deterministic"] = "deterministic"
    answer_provider: str | None = None
    answer_model: str | None = None
