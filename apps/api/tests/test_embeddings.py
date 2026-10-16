"""Model-free checks for embedding validity and vector fallback boundaries."""

from app.db import DocumentRepository
from app.services.embeddings import FastEmbedProvider, validate_embedding


class StubProvider:
    model_name = "test-model-v1"
    dimension = 2

    def embed(self, texts):
        return [[1.0, 0.0] for _ in texts]


class Cursor:
    def __init__(self, *, fail=False):
        self.fail = fail
        self.sql = ""
        self.params = ()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, params=()):
        if self.fail:
            raise RuntimeError("vector database unavailable")
        self.sql = sql
        self.params = params

    def fetchall(self):
        return []


class Connection:
    def __init__(self, cursor):
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return self._cursor


class Database:
    vector_enabled = True
    embedding_dimension = 2

    def __init__(self, cursor):
        self._connection = Connection(cursor)

    def ensure_schema(self):
        pass

    def connect(self):
        return self._connection


class ReindexCursor:
    def __init__(self, database):
        self.database = database
        self.rows = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, params=()):
        self.database.queries.append((sql, params))
        if "SELECT c.id, c.text" in sql:
            self.rows = self.database.candidates if self.database.select_calls == 0 else []
            self.database.select_calls += 1

    def fetchall(self):
        return self.rows

    def executemany(self, sql, params):
        self.database.updates.append((sql, list(params)))


class ReindexConnection:
    def __init__(self, database):
        self.database = database

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return ReindexCursor(self.database)


class ReindexDatabase:
    vector_enabled = True
    embedding_dimension = 2

    def __init__(self):
        self.candidates = [{"id": "chunk-1", "text": "one"}, {"id": "chunk-2", "text": "two"}]
        self.select_calls = 0
        self.queries = []
        self.updates = []

    def ensure_schema(self):
        pass

    def connect(self):
        return ReindexConnection(self)


class MixedProvider(StubProvider):
    def embed(self, texts):
        return [[1.0, 0.0], [0.0, 0.0]]


def test_validate_embedding_rejects_zero_norm_and_invalid_dimensions():
    assert validate_embedding([0.0, 0.0], 2) is None
    assert validate_embedding([1.0], 2) is None
    assert validate_embedding([1.0, 0.0], 2) == [1.0, 0.0]


def test_vector_search_filters_by_current_model_provenance():
    cursor = Cursor()
    repository = DocumentRepository(Database(cursor), embedding_provider=StubProvider())

    assert repository._vector_search([1.0, 0.0], 3) == []
    assert "c.embedding_model = %s" in cursor.sql
    assert cursor.params[1] == "test-model-v1"


def test_vector_database_failure_returns_no_vector_hits():
    repository = DocumentRepository(
        Database(Cursor(fail=True)), embedding_provider=StubProvider()
    )

    assert repository._vector_search([1.0, 0.0], 3) == []


def test_reindex_counts_success_and_zero_norm_failure_in_batches():
    database = ReindexDatabase()
    repository = DocumentRepository(database, embedding_provider=MixedProvider())

    counts = repository.reindex_embeddings(batch_size=2)

    assert counts == {"scanned": 2, "succeeded": 1, "failed": 1}
    assert len(database.updates) == 1
    assert "embedding_model = %s" in database.updates[0][0]
    assert "text" not in database.updates[0][0].lower()
    assert "embedding_model IS DISTINCT FROM" in database.queries[0][0]


def test_fastembed_provider_stays_lazy():
    provider = FastEmbedProvider()

    assert provider._model is None
