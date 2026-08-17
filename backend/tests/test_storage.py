"""Object storage abstraction: confirms the S3-compatible backend (used for
DigitalOcean Spaces in production) behaves correctly - upload, download via
presigned URL, delete, and that local disk storage (the dev/docker-compose
default) is completely unaffected by any of this.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import boto3
import pytest
from moto import mock_aws

import server as srv


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
