"""Model-free tests for document deletion repository and route behavior."""

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.routes import documents
from app.db import DocumentRepository


class _Cursor:
    def __init__(self, row):
        self.row = row
        self.executed = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, query, params):
        self.executed = (query, params)

    def fetchone(self):
        return self.row


class _Connection:
    def __init__(self, cursor):
        self.cursor_value = cursor

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def cursor(self):
        return self.cursor_value


class _Database:
    vector_enabled = False
    embedding_dimension = 384

    def __init__(self, connection):
        self.connection = connection
        self.ensure_schema_calls = 0

    def ensure_schema(self):
        self.ensure_schema_calls += 1

    def connect(self):
        return self.connection


def _request(repo):
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(repository=repo)))


def test_repository_delete_returns_deleted_metadata_and_uses_id():
    cursor = _Cursor({"id": "doc-1", "name": "notes.md", "stored_filename": "stored.md"})
    repository = DocumentRepository(_Database(_Connection(cursor)))

    deleted = repository.delete("doc-1")

    assert deleted["id"] == "doc-1"
    assert cursor.executed[1] == ("doc-1",)
    assert "DELETE FROM documents" in cursor.executed[0]


def test_delete_route_quarantines_file_before_deleting_and_returns_typed_result(tmp_path, monkeypatch):
    upload = tmp_path / "stored.md"
    upload.write_text("content", encoding="utf-8")
    repo = SimpleNamespace(
        get=lambda document_id: {"id": document_id, "name": "notes.md", "stored_filename": upload.name},
        delete=lambda document_id: {"id": document_id, "name": "notes.md", "stored_filename": upload.name},
    )
    monkeypatch.setattr(documents, "get_settings", lambda: SimpleNamespace(upload_dir=tmp_path))

    result = documents.delete_document("doc-1", _request(repo))

    assert result.model_dump() == {"id": "doc-1", "name": "notes.md", "message": "Document deleted."}
    assert not upload.exists()
    assert not list(tmp_path.glob(".delete-*"))


def test_delete_route_missing_id_returns_404_without_touching_files(tmp_path, monkeypatch):
    upload = tmp_path / "stored.md"
    upload.write_text("content", encoding="utf-8")
    repo = SimpleNamespace(get=lambda document_id: None, delete=lambda document_id: pytest.fail("delete called"))
    monkeypatch.setattr(documents, "get_settings", lambda: SimpleNamespace(upload_dir=tmp_path))

    with pytest.raises(HTTPException) as raised:
        documents.delete_document("missing", _request(repo))

    assert raised.value.status_code == 404
    assert upload.exists()


def test_delete_route_database_read_failure_returns_503(tmp_path, monkeypatch):
    repo = SimpleNamespace(get=lambda document_id: (_ for _ in ()).throw(RuntimeError("database unavailable")))
    monkeypatch.setattr(documents, "get_settings", lambda: SimpleNamespace(upload_dir=tmp_path))

    with pytest.raises(HTTPException) as raised:
        documents.delete_document("doc-1", _request(repo))

    assert raised.value.status_code == 503


def test_delete_route_database_failure_restores_quarantined_file(tmp_path, monkeypatch):
    upload = tmp_path / "stored.md"
    upload.write_text("content", encoding="utf-8")

    def fail_delete(document_id):
        assert not upload.exists()
        raise RuntimeError("database unavailable")

    repo = SimpleNamespace(
        get=lambda document_id: {"id": document_id, "name": "notes.md", "stored_filename": upload.name},
        delete=fail_delete,
    )
    monkeypatch.setattr(documents, "get_settings", lambda: SimpleNamespace(upload_dir=tmp_path))

    with pytest.raises(HTTPException) as raised:
        documents.delete_document("doc-1", _request(repo))

    assert raised.value.status_code == 503
    assert upload.read_text(encoding="utf-8") == "content"
    assert not list(tmp_path.glob(".delete-*"))


def test_delete_route_file_cleanup_failure_reports_503_after_database_delete(tmp_path, monkeypatch):
    upload = tmp_path / "stored.md"
    upload.write_text("content", encoding="utf-8")
    repo = SimpleNamespace(
        get=lambda document_id: {"id": document_id, "name": "notes.md", "stored_filename": upload.name},
        delete=lambda document_id: {"id": document_id, "name": "notes.md", "stored_filename": upload.name},
    )
    monkeypatch.setattr(documents, "get_settings", lambda: SimpleNamespace(upload_dir=tmp_path))
    original_unlink = Path.unlink

    def fail_quarantine_unlink(path, *args, **kwargs):
        if path.name.startswith(".delete-"):
            raise OSError("disk failure")
        return original_unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", fail_quarantine_unlink)

    with pytest.raises(HTTPException) as raised:
        documents.delete_document("doc-1", _request(repo))

    assert raised.value.status_code == 503
    assert list(tmp_path.glob(".delete-*"))
