"""Object storage abstraction: confirms the S3-compatible backend (used for
DigitalOcean Spaces in production) behaves correctly - upload, download via
presigned URL, delete, and that local disk storage (the dev/docker-compose
default) is completely unaffected by any of this.

storage_save() uploads via a presigned URL + httpx rather than calling
boto3's put_object() directly - a deliberate workaround for a real
compatibility issue where botocore's own HTTP transport adds an
"Expect: 100-continue" header that several S3-compatible backends (including,
in practice, DigitalOcean Spaces) don't handle correctly. moto's @mock_aws
only intercepts calls made through boto3/botocore's own request pipeline, not
raw httpx requests, so these tests fake httpx.put() to route the same bytes
through the moto-mocked S3 client instead - verifying the same end-to-end
behavior (object actually lands in the bucket) without needing real network
access to a presigned URL.
"""
import os
import sys
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import boto3
import pytest
from moto import mock_aws

import server as srv


class _FakeHttpxResponse:
    def __init__(self, status_code=200, text=""):
        self.status_code = status_code
        self.text = text

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f"fake httpx error {self.status_code}: {self.text}")


def _fake_httpx_put_via_moto(s3_client, bucket):
    """Returns a stand-in for httpx.put() that performs the equivalent upload
    against the moto-mocked bucket, so storage_save's real logic (presigned
    URL generation, then a PUT of the body) is exercised end-to-end."""
    def _put(url, content=None, headers=None, timeout=None):
        # generate_presigned_url with no custom endpoint uses virtual-hosted
        # style (bucket-name.s3.amazonaws.com/key...) - everything after the
        # domain in the path is the object key.
        key = urlparse(url).path.lstrip("/")
        s3_client.put_object(Bucket=bucket, Key=key, Body=content, ContentType=(headers or {}).get("Content-Type"))
        return _FakeHttpxResponse(200)
    return _put


def test_local_storage_is_default(registered_user):
    assert srv.STORAGE_BACKEND == "local"


@mock_aws
def test_s3_storage_save_download_delete(monkeypatch, registered_user):
    client, _ = registered_user
    bucket = "test-coversfolio-bucket"

    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=bucket)

    monkeypatch.setattr(srv, "STORAGE_BACKEND", "s3")
    monkeypatch.setattr(srv, "S3_BUCKET", bucket)
    monkeypatch.setattr(srv, "_s3_client", s3)
    monkeypatch.setattr(srv.httpx, "put", _fake_httpx_put_via_moto(s3, bucket))

    resp = client.post("/api/documents", files={"file": ("policy.pdf", b"%PDF-1.4 fake policy content", "application/pdf")},
                        data={"category": "policy_document"})
    assert resp.status_code == 200
    doc = resp.json()

    # Confirm the object actually landed in the mocked S3 bucket
    objects = s3.list_objects_v2(Bucket=bucket)
    assert objects["KeyCount"] == 1
    assert objects["Contents"][0]["Key"].endswith(".pdf")

    # Download should redirect to a presigned URL, not serve bytes directly
    resp = client.get(f"/api/documents/{doc['id']}/download", follow_redirects=False)
    assert resp.status_code in (302, 307)
    assert bucket in resp.headers["location"] or "amazonaws" in resp.headers["location"] or "X-Amz-Signature" in resp.headers["location"]

    # Delete should remove the object from the bucket, not just the DB record
    resp = client.delete(f"/api/documents/{doc['id']}")
    assert resp.status_code == 200
    objects = s3.list_objects_v2(Bucket=bucket)
    assert objects.get("KeyCount", 0) == 0


@mock_aws
def test_s3_download_404_when_object_missing(monkeypatch, registered_user):
    client, _ = registered_user
    bucket = "test-coversfolio-bucket-2"
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=bucket)

    monkeypatch.setattr(srv, "STORAGE_BACKEND", "s3")
    monkeypatch.setattr(srv, "S3_BUCKET", bucket)
    monkeypatch.setattr(srv, "_s3_client", s3)
    monkeypatch.setattr(srv.httpx, "put", _fake_httpx_put_via_moto(s3, bucket))

    resp = client.post("/api/documents", files={"file": ("bill.pdf", b"%PDF-1.4 fake", "application/pdf")},
                        data={"category": "hospital_bill"})
    doc = resp.json()

    # Simulate the object having been removed directly from the bucket (out of band)
    s3.delete_object(Bucket=bucket, Key=doc["stored_path"] if "stored_path" in doc else f"{doc['id']}")
    # stored_path isn't exposed publicly, so delete by listing instead
    for obj in s3.list_objects_v2(Bucket=bucket).get("Contents", []):
        s3.delete_object(Bucket=bucket, Key=obj["Key"])

    resp = client.get(f"/api/documents/{doc['id']}/download", follow_redirects=False)
    assert resp.status_code == 404
