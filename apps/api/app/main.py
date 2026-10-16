"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.db import Database, DocumentRepository
from app.core.settings import get_settings
from app.services.embeddings import FastEmbedProvider


def create_app() -> FastAPI:
    """Create and configure the API application."""
    settings = get_settings()
    application = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Local-first document ingestion and citation-grounded RAG API.",
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    database = Database(settings.database_url, embedding_dimension=settings.embedding_dimension)
    embedding_provider = (
        FastEmbedProvider(
            settings.embedding_model,
            dimension=settings.embedding_dimension,
            cache_dir=settings.embedding_cache_dir,
            batch_size=settings.embedding_batch_size,
        )
        if settings.embedding_enabled
        else None
    )
    application.state.repository = DocumentRepository(
        database,
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
        embedding_provider=embedding_provider,
        keyword_weight=settings.retrieval_keyword_weight,
        vector_weight=settings.retrieval_vector_weight,
    )
    application.include_router(api_router)

    return application


app = create_app()
