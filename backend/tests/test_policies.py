"""Policy CRUD, status computation (active/grace/expired), and utilization tracking."""
from datetime import datetime, timedelta, timezone

import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from conftest import make_policy, make_claim


def test_create_and_list_policy(registered_user):
    client, _ = registered_user
    policy = make_policy(client, insurer_name="HDFC ERGO")
    resp = client.get("/api/policies")
    assert resp.status_code == 200
    policies = resp.json()["policies"]
    assert len(policies) == 1
    assert policies[0]["id"] == policy["id"]


def test_policy_status_active(registered_user):
    client, _ = registered_user
    policy = make_policy(client, end_date="2030-12-31")
    resp = client.get(f"/api/policies/{policy['id']}")
    assert resp.json()["status_info"]["status"] == "active"


def test_policy_status_grace_period(registered_user):
    client, _ = registered_user
    ten_days_ago = (datetime.now(timezone.utc) - timedelta(days=10)).strftime("%Y-%m-%d")
    policy = make_policy(client, start_date="2020-01-01", end_date=ten_days_ago)
    resp = client.get(f"/api/policies/{policy['id']}")
    assert resp.json()["status_info"]["status"] == "grace_period"


def test_policy_status_expired(registered_user):
    client, _ = registered_user
    long_ago = (datetime.now(timezone.utc) - timedelta(days=90)).strftime("%Y-%m-%d")
    policy = make_policy(client, start_date="2020-01-01", end_date=long_ago)
    resp = client.get(f"/api/policies/{policy['id']}")
    assert resp.json()["status_info"]["status"] == "expired"


def test_utilization_reduces_after_settlement(registered_user):
    client, _ = registered_user
    policy = make_policy(client, sum_insured=500000)
    claim = make_claim(client, policy_id=policy["id"])
    client.post(f"/api/claims/{claim['id']}/settlements", json={"amount": 75000, "kind": "final", "note": "test"})
    resp = client.get(f"/api/policies/{policy['id']}")
    util = resp.json()["utilization"]
    assert util["used"] == 75000
    assert util["remaining"] == 425000


def test_deduction_settlements_dont_count_against_utilization(registered_user):
    client, _ = registered_user
    policy = make_policy(client, sum_insured=500000)
    claim = make_claim(client, policy_id=policy["id"])
    client.post(f"/api/claims/{claim['id']}/settlements", json={"amount": 10000, "kind": "deduction", "note": "test"})
    resp = client.get(f"/api/policies/{policy['id']}")
    assert resp.json()["utilization"]["used"] == 0


def test_update_policy_preserves_untouched_fields(registered_user):
    client, _ = registered_user
    policy = make_policy(client, insurer_name="Star Health", policy_number="ORIGINAL-1")
    resp = client.put(f"/api/policies/{policy['id']}", json={"sum_insured": 999999})
    assert resp.status_code == 200
    data = resp.json()
    assert data["sum_insured"] == 999999
    assert data["insurer_name"] == "Star Health"
    assert data["policy_number"] == "ORIGINAL-1"


def test_delete_policy(registered_user):
    client, _ = registered_user
    policy = make_policy(client)
    resp = client.delete(f"/api/policies/{policy['id']}")
    assert resp.status_code == 200
    resp = client.get(f"/api/policies/{policy['id']}")
    assert resp.status_code == 404


def test_agent_cannot_create_policy(registered_user):
    client, _ = registered_user
    invite = client.post("/api/household/invites", json={"email": "agent@example.com", "role": "agent"}).json()
    from fastapi.testclient import TestClient
    import server as srv
    agent_client = TestClient(srv.app)
    agent_client.post("/api/household/invites/accept", json={"token": invite["invite_token"], "name": "Agent", "password": "SecurePass123!"})
    resp = agent_client.post("/api/policies", json={
        "insurer_name": "Star Health", "policy_number": "P1", "policy_type": "Health",
        "sum_insured": 100000, "start_date": "2025-01-01", "end_date": "2026-01-01",
    })
    assert resp.status_code == 403
