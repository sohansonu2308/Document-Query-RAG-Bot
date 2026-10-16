"""Command-line repair for missing or model-stale chunk embeddings."""

from __future__ import annotations

import argparse

from app.core.settings import get_settings
from app.db import Database, DocumentRepository
from app.services.embeddings import FastEmbedProvider


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Re-embed missing or model-mismatched document chunks."
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=None,
        help="Embedding batch size (defaults to RAG_EMBEDDING_BATCH_SIZE).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = get_settings()
    provider = (
        FastEmbedProvider(
            settings.embedding_model,
            dimension=settings.embedding_dimension,
            cache_dir=settings.embedding_cache_dir,
            batch_size=settings.embedding_batch_size,
        )
        if settings.embedding_enabled
        else None
    )
    repository = DocumentRepository(
        Database(settings.database_url, embedding_dimension=settings.embedding_dimension),
        embedding_provider=provider,
        keyword_weight=settings.retrieval_keyword_weight,
        vector_weight=settings.retrieval_vector_weight,
    )
    try:
        counts = repository.reindex_embeddings(args.batch_size or settings.embedding_batch_size)
    except Exception as error:
        print(f"reindex failed: {error}")
        return 1
    print(
        "reindex complete: "
        f"scanned={counts['scanned']} "
        f"success={counts['succeeded']} "
        f"failure={counts['failed']}"
    )
    return 0 if counts["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
