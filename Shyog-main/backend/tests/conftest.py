"""
Shared pytest fixtures for the Coversfolio backend test suite.

Each test gets a completely fresh in-memory Mongo (via mongomock-motor) and a
fresh FastAPI TestClient wired to it - tests never share state and never touch
a real database, so the suite is safe to run anywhere without configuration.
"""
import os
import sys
import uuid

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "coversfolio_test")
os.environ.setdefault("JWT_SECRET", "test-secret-key-that-is-at-least-32-characters-long")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("STORAGE_ROOT", "/tmp/coversfolio_test_storage")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient

import server as srv


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch):
    """Every test gets its own isolated in-memory database - a unique DB name
    per test avoids any chance of state leaking between tests even though
    they all share the same mongomock client process."""
    fresh_client = AsyncMongoMockClient()
    db_name = f"test_{uuid.uuid4().hex[:12]}"
    monkeypatch.setattr(srv, "client", fresh_client)
    monkeypatch.setattr(srv, "db", fresh_client[db_name])
    yield fresh_client[db_name]


@pytest.fixture
def client():
    with TestClient(srv.app) as c:
        yield c


@pytest.fixture
def registered_user(client):
    """A fresh, logged-in household owner. Returns (client, user_dict)."""
    resp = client.post("/api/auth/register", json={
        "email": "owner@example.com", "password": "SecurePass123!", "name": "Test Owner",
    })
    assert resp.status_code == 200, resp.text
    return client, resp.json()


def make_policy(client, **overrides):
    """Factory for a policy with sensible defaults - pass overrides for
    anything a specific test cares about. Call with an already-authenticated
    client (e.g. from the registered_user fixture)."""
    payload = {
        "insurer_name": "Star Health", "policy_number": f"POL-{uuid.uuid4().hex[:8]}",
        "policy_type": "Health", "sum_insured": 500000,
        "start_date": "2025-01-01", "end_date": "2026-12-31",
    }
    payload.update(overrides)
    resp = client.post("/api/policies", json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()


def make_claim(client, **overrides):
    """Factory for a claim with sensible defaults. Call with an
    already-authenticated client."""
    payload = {"title": "Test claim", "claim_type": "Reimbursement"}
    payload.update(overrides)
    resp = client.post("/api/claims", json=payload)
    assert resp.status_code == 200, resp.text
    return resp.json()
