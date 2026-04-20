"""Tests for app.services.storage — local-disk fallback path."""
import tempfile

import pytest


@pytest.fixture(autouse=True)
def _local_storage(monkeypatch):
    """Force local-disk mode with a temp directory."""
    tmpdir = tempfile.mkdtemp()
    monkeypatch.setattr("app.core.config.settings.S3_BUCKET", "")
    monkeypatch.setattr("app.core.config.settings.UPLOAD_DIR", tmpdir)
    yield tmpdir


def test_upload_download_roundtrip(_local_storage):
    from app.services.storage import upload, download

    content = b"hello world"
    upload(content, "test.txt")
    assert download("test.txt") == content


def test_download_missing_raises(_local_storage):
    from app.services.storage import download

    with pytest.raises(FileNotFoundError):
        download("nonexistent.txt")


def test_delete(_local_storage):
    from app.services.storage import upload, delete, download

    upload(b"data", "del.txt")
    delete("del.txt")
    with pytest.raises(FileNotFoundError):
        download("del.txt")


def test_delete_idempotent(_local_storage):
    from app.services.storage import delete

    delete("nope.txt")


def test_upload_creates_dir(monkeypatch, tmp_path):
    from app.services.storage import upload

    nested = str(tmp_path / "a" / "b")
    monkeypatch.setattr("app.core.config.settings.UPLOAD_DIR", nested)
    upload(b"x", "f.bin")
    assert (tmp_path / "a" / "b" / "f.bin").read_bytes() == b"x"
