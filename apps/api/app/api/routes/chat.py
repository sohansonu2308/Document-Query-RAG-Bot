"""Chat route backed by hybrid retrieval and optional grounded generation."""

from fastapi import APIRouter, HTTPException, Request

from app.core.settings import get_settings
from app.db import DocumentRepository
from app.schemas import ChatRequest, ChatResponse, ChatSource
from app.services.generation import GroundedAnswerGenerator


router = APIRouter(prefix="/chat", tags=["chat"])


def repository(request: Request) -> DocumentRepository:
    return request.app.state.repository


@router.post("", response_model=ChatResponse, summary="Ask the RAG chatbot")
def chat(payload: ChatRequest, request: Request) -> ChatResponse:
    """Retrieve matching stored chunks and assemble a cited evidence answer."""
    question = payload.resolved_question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="A question is required.")
    settings = get_settings()
    try:
        retrieval = repository(request).retrieve_with_metadata(question, settings.retrieval_top_k)
    except Exception as error:
        raise HTTPException(status_code=503, detail="Document storage is unavailable.") from error

    generated = GroundedAnswerGenerator(
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
        model=settings.llm_model,
        timeout_seconds=settings.llm_timeout_seconds,
    ).generate(question, retrieval.hits)
    sources = [
        ChatSource(
            document_id=hit.chunk.document_id,
            label=f"{hit.chunk.document_name} (chunk {hit.chunk.chunk_index + 1})",
            chunk_id=hit.chunk.chunk_id,
            chunk_index=hit.chunk.chunk_index,
            snippet=hit.chunk.text,
            score=hit.score,
            keyword_score=hit.keyword_score,
            vector_score=hit.vector_score,
        )
        for hit in retrieval.hits
    ]
    return ChatResponse(
        answer=generated.answer,
        sources=sources,
        status="ok" if retrieval.hits else "no_match",
        strategy=retrieval.strategy,
        embedding_model=retrieval.embedding_model,
        answer_mode=generated.answer_mode,
        answer_provider=generated.answer_provider,
        answer_model=generated.answer_model,
    )
