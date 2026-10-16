"""Small psycopg repository for document metadata and extracted chunks."""

from __future__ import annotations

import threading
import uuid
from typing import Any, Iterable

import psycopg
from psycopg.rows import dict_row

from app.services.extraction import chunk_text
from app.services.embeddings import EmbeddingProvider, validate_embedding
from app.services.retrieval import (
    RetrievalChunk,
    RetrievalHit,
    keyword_search,
    merge_hybrid_results,
)


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL UNIQUE,
    content_type TEXT,
    size_bytes BIGINT NOT NULL,
    extracted_text TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('processing', 'ready', 'failed')),
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    embedding_model TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS document_chunks_document_id_idx
    ON document_chunks (document_id);
"""


def vector_literal(vector: list[float]) -> str:
    """Serialize a validated embedding for PostgreSQL's vector input cast."""
    return "[" + ",".join(format(value, ".9g") for value in vector) + "]"


class RetrievalResult:
    """Retrieval hits plus the strategy information exposed by the API."""

    def __init__(self, hits: list[RetrievalHit], strategy: str, embedding_model: str | None):
        self.hits = hits
        self.strategy = strategy
        self.embedding_model = embedding_model


def normalize_dsn(database_url: str) -> str:
    """Make the SQLAlchemy-style URL in the sample env usable by psycopg."""
    return database_url.replace("postgresql+psycopg://", "postgresql://", 1).replace(
        "postgres+psycopg://", "postgresql://", 1
    )


class Database:
    """Lazy database connection factory with one-time schema initialization."""

    def __init__(self, database_url: str, embedding_dimension: int = 384):
        self.database_url = normalize_dsn(database_url)
        self.embedding_dimension = embedding_dimension
        self.vector_enabled = False
        self.embedding_provenance_enabled = False
        self._schema_ready = False
        self._schema_lock = threading.Lock()

    def connect(self) -> psycopg.Connection[Any]:
        return psycopg.connect(self.database_url, row_factory=dict_row)

    def ensure_schema(self) -> None:
        if self._schema_ready:
            return
        with self._schema_lock:
            if self._schema_ready:
                return
            with self.connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(SCHEMA_SQL)

            try:
                with self.connect() as connection:
                    with connection.cursor() as cursor:
                        cursor.execute(
                            "ALTER TABLE document_chunks "
                            "ADD COLUMN IF NOT EXISTS embedding_model TEXT"
                        )
                self.embedding_provenance_enabled = True
            except Exception:
                # Existing deployments can still use their original keyword
                # path if this additive migration is not permitted.
                self._schema_ready = True
                return

            # The supplied container has pgvector, but keeping this optional
            # lets the existing keyword-only flow work with plain PostgreSQL.
            try:
                with self.connect() as connection:
                    with connection.cursor() as cursor:
                        cursor.execute("CREATE EXTENSION IF NOT EXISTS vector")
            except Exception:
                self._schema_ready = True
                return

            try:
                with self.connect() as connection:
                    with connection.cursor() as cursor:
                        dimension = int(self.embedding_dimension)
                        cursor.execute(
                            "ALTER TABLE document_chunks "
                            f"ADD COLUMN IF NOT EXISTS embedding vector({dimension})"
                        )
                        cursor.execute(
                            "SELECT format_type(a.atttypid, a.atttypmod) AS vector_type "
                            "FROM pg_attribute a "
                            "JOIN pg_class c ON c.oid = a.attrelid "
                            "WHERE c.relname = 'document_chunks' AND a.attname = 'embedding'"
                        )
                        column = cursor.fetchone()
                        if not column or column["vector_type"].lower() != f"vector({dimension})":
                            raise ValueError("Existing embedding column has a different dimension")
                self.vector_enabled = True
            except Exception:
                # A pre-existing incompatible schema should not take down the
                # upload/chat endpoints; keyword retrieval remains available.
                self._schema_ready = True
                return

            # HNSW is preferred for cosine search. Older pgvector versions may
            # not support it, so use ivfflat as a safe practical fallback.
            try:
                with self.connect() as connection:
                    with connection.cursor() as cursor:
                        cursor.execute(
                            "CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx "
                            "ON document_chunks USING hnsw (embedding vector_cosine_ops)"
                        )
            except Exception:
                try:
                    with self.connect() as connection:
                        with connection.cursor() as cursor:
                            cursor.execute(
                                "CREATE INDEX IF NOT EXISTS document_chunks_embedding_ivfflat_idx "
                                "ON document_chunks USING ivfflat (embedding vector_cosine_ops)"
                            )
                except Exception:
                    # Vector search still works without an ANN index on small
                    # local datasets, so do not make schema setup fatal.
                    pass
            self._schema_ready = True


class DocumentRepository:
    """Persist uploaded documents and provide keyword retrieval over their chunks."""

    def __init__(
        self,
        database: Database,
        chunk_size: int = 1200,
        chunk_overlap: int = 200,
        embedding_provider: EmbeddingProvider | None = None,
        keyword_weight: float = 0.35,
        vector_weight: float = 0.65,
    ):
        self.database = database
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.embedding_provider = embedding_provider
        self.keyword_weight = keyword_weight
        self.vector_weight = vector_weight

    def _embed(self, texts: list[str]) -> list[list[float] | None]:
        """Best-effort embedding that never breaks deterministic fallback."""
        if not self.embedding_provider or not texts or not self.database.vector_enabled:
            return [None] * len(texts)
        try:
            vectors = self.embedding_provider.embed(texts)
        except Exception:
            return [None] * len(texts)
        valid: list[list[float] | None] = []
        for vector in vectors[: len(texts)]:
            try:
                valid.append(validate_embedding(vector, self.database.embedding_dimension))
            except (TypeError, ValueError):
                valid.append(None)
        return valid + [None] * (len(texts) - len(valid))

    def ingest(
        self,
        *,
        name: str,
        stored_filename: str,
        content_type: str | None,
        size_bytes: int,
        extracted_text: str,
    ) -> dict[str, Any]:
        self.database.ensure_schema()
        document_id = str(uuid.uuid4())
        chunks = chunk_text(extracted_text, self.chunk_size, self.chunk_overlap)
        embeddings = self._embed(chunks)
        try:
            with self.database.connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        INSERT INTO documents
                            (id, name, original_filename, stored_filename, content_type,
                             size_bytes, extracted_text, status)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, 'processing')
                        RETURNING created_at
                        """,
                        (document_id, name, name, stored_filename, content_type, size_bytes, extracted_text),
                    )
                    cursor.fetchone()
            with self.database.connect() as connection:
                with connection.cursor() as cursor:
                    if self.database.vector_enabled:
                        cursor.executemany(
                            "INSERT INTO document_chunks "
                            "(id, document_id, chunk_index, text, embedding, embedding_model) "
                            "VALUES (%s, %s, %s, %s, %s::vector, %s)",
                            [
                                (
                                    str(uuid.uuid4()),
                                    document_id,
                                    index,
                                    text,
                                    vector_literal(vector) if vector is not None else None,
                                    (
                                        self.embedding_provider.model_name
                                        if vector is not None and self.embedding_provider
                                        else None
                                    ),
                                )
                                for index, (text, vector) in enumerate(zip(chunks, embeddings))
                            ],
                        )
                    else:
                        cursor.executemany(
                            "INSERT INTO document_chunks (id, document_id, chunk_index, text) "
                            "VALUES (%s, %s, %s, %s)",
                            [(str(uuid.uuid4()), document_id, index, text) for index, text in enumerate(chunks)],
                        )
                    cursor.execute(
                        "UPDATE documents SET status = 'ready', updated_at = NOW() WHERE id = %s",
                        (document_id,),
                    )
        except Exception as error:
            try:
                with self.database.connect() as connection:
                    with connection.cursor() as cursor:
                        cursor.execute(
                            "UPDATE documents SET status = 'failed', error = %s, updated_at = NOW() WHERE id = %s",
                            (str(error)[:1000], document_id),
                        )
            except Exception:
                pass
            raise
        document = self.get(document_id)
        if document is None:
            raise RuntimeError("Document was inserted but could not be read back.")
        return document

    def list(self) -> list[dict[str, Any]]:
        self.database.ensure_schema()
        with self.database.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT d.id, d.name, d.original_filename, d.stored_filename,
                           d.content_type, d.size_bytes, d.status, d.error, d.created_at,
                           COUNT(c.id)::INTEGER AS chunk_count
                    FROM documents d
                    LEFT JOIN document_chunks c ON c.document_id = d.id
                    GROUP BY d.id
                    ORDER BY d.created_at DESC, d.id
                    """
                )
                return list(cursor.fetchall())

    def get(self, document_id: str) -> dict[str, Any] | None:
        self.database.ensure_schema()
        with self.database.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT d.id, d.name, d.original_filename, d.stored_filename,
                           d.content_type, d.size_bytes, d.status, d.error, d.created_at,
                           COUNT(c.id)::INTEGER AS chunk_count
                    FROM documents d
                    LEFT JOIN document_chunks c ON c.document_id = d.id
                    WHERE d.id = %s
                    GROUP BY d.id
                    """,
                    (document_id,),
                )
                return cursor.fetchone()

    def delete(self, document_id: str) -> dict[str, Any] | None:
        """Delete a document and let PostgreSQL cascade its chunks.

        The surrounding connection context commits only after the DELETE has
        completed successfully, so a database error leaves the document and
        its chunks untouched.
        """
        self.database.ensure_schema()
        with self.database.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "DELETE FROM documents WHERE id = %s RETURNING id, name, stored_filename",
                    (document_id,),
                )
                return cursor.fetchone()

    def retrieve(self, question: str, top_k: int = 5) -> list[RetrievalHit]:
        """Return hybrid hits while preserving the original list-returning API."""
        return self.retrieve_with_metadata(question, top_k).hits

    def retrieve_with_metadata(self, question: str, top_k: int = 5) -> RetrievalResult:
        """Retrieve by exact terms and, when available, local vector similarity."""
        self.database.ensure_schema()
        with self.database.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT c.id AS chunk_id, c.document_id, d.name AS document_name,
                           c.chunk_index, c.text
                    FROM document_chunks c
                    JOIN documents d ON d.id = c.document_id
                    WHERE d.status = 'ready'
                    ORDER BY d.created_at, c.chunk_index, c.id
                    """
                )
                rows: Iterable[dict[str, Any]] = cursor.fetchall()
        candidates = [RetrievalChunk(**row) for row in rows]
        keyword_hits = keyword_search(question, candidates, max(top_k * 4, 20))
        vector_hits: list[RetrievalHit] = []

        question_embedding = self._embed([question])[0] if self.embedding_provider else None
        if question_embedding is not None:
            vector_hits = self._vector_search(question_embedding, top_k)

        hits = merge_hybrid_results(
            keyword_hits,
            vector_hits,
            top_k=top_k,
            keyword_weight=self.keyword_weight,
            vector_weight=self.vector_weight,
        )
        if keyword_hits and vector_hits:
            strategy = "hybrid"
        elif vector_hits:
            strategy = "vector"
        else:
            strategy = "keyword"
        model_name = self.embedding_provider.model_name if vector_hits and self.embedding_provider else None
        return RetrievalResult(hits=hits, strategy=strategy, embedding_model=model_name)

    def _vector_search(self, question_embedding: list[float], top_k: int) -> list[RetrievalHit]:
        """Run vector search, treating database/vector failures as no vector hits."""
        try:
            query_vector = vector_literal(question_embedding)
            with self.database.connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT c.id AS chunk_id, c.document_id, d.name AS document_name,
                               c.chunk_index, c.text,
                               1 - (c.embedding <=> %s::vector) AS vector_score
                        FROM document_chunks c
                        JOIN documents d ON d.id = c.document_id
                        WHERE d.status = 'ready'
                          AND c.embedding IS NOT NULL
                          AND c.embedding_model = %s
                        ORDER BY c.embedding <=> %s::vector, d.created_at, c.chunk_index, c.id
                        LIMIT %s
                        """,
                        (
                            query_vector,
                            self.embedding_provider.model_name if self.embedding_provider else "",
                            query_vector,
                            max(top_k * 4, 20),
                        ),
                    )
                    vector_rows: Iterable[dict[str, Any]] = cursor.fetchall()
            hits: list[RetrievalHit] = []
            for row in vector_rows:
                chunk = RetrievalChunk(
                    chunk_id=row["chunk_id"],
                    document_id=row["document_id"],
                    document_name=row["document_name"],
                    chunk_index=row["chunk_index"],
                    text=row["text"],
                )
                similarity = float(row["vector_score"])
                hits.append(
                    RetrievalHit(
                        chunk=chunk,
                        score=similarity,
                        vector_score=similarity,
                    )
                )
            return hits
        except Exception:
            return []

    def reindex_embeddings(self, batch_size: int = 32) -> dict[str, int]:
        """Fill missing or stale vectors without changing chunk text or files."""
        self.database.ensure_schema()
        if not self.database.vector_enabled or not self.embedding_provider:
            raise RuntimeError("Vector storage and an embedding provider are required for reindexing.")
        if batch_size <= 0:
            raise ValueError("batch_size must be positive")

        counts = {"scanned": 0, "succeeded": 0, "failed": 0}
        last_id = ""
        while True:
            with self.database.connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT c.id, c.text
                        FROM document_chunks c
                        JOIN documents d ON d.id = c.document_id
                        WHERE d.status = 'ready'
                          AND c.id > %s
                          AND (
                              c.embedding IS NULL
                              OR c.embedding_model IS DISTINCT FROM %s
                          )
                        ORDER BY c.id
                        LIMIT %s
                        """,
                        (last_id, self.embedding_provider.model_name, batch_size),
                    )
                    rows = list(cursor.fetchall())
            if not rows:
                break

            last_id = rows[-1]["id"]
            counts["scanned"] += len(rows)
            embeddings = self._embed([row["text"] for row in rows])
            updates = []
            for row, embedding in zip(rows, embeddings):
                if embedding is None:
                    counts["failed"] += 1
                else:
                    updates.append(
                        (vector_literal(embedding), self.embedding_provider.model_name, row["id"])
                    )
            if updates:
                with self.database.connect() as connection:
                    with connection.cursor() as cursor:
                        cursor.executemany(
                            "UPDATE document_chunks "
                            "SET embedding = %s::vector, embedding_model = %s "
                            "WHERE id = %s",
                            updates,
                        )
                counts["succeeded"] += len(updates)
        return counts
