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
from datetime import datetime, timedelta, timezone
from conftest import make_policy

def test_waiting_period_survives_renewal(registered_user):
    """Regression test for a real reported bug: renewing a policy (uploading
    a new period's document) was resetting waiting-period countdowns to
    start from the renewal date instead of the original policy's inception -
    exactly what happened to a real user 4 years into continuous coverage."""
    client, user = registered_user
    original_start = "2022-08-15"  # ~4 years before "today" in this test env
    policy = make_policy(client, start_date=original_start, end_date="2023-08-14")
    policy_id = policy["id"]

    ai_insights = {
        "pre_existing_disease_waiting_months": 36,
        "schema_version": 3,
    }
    client.put(f"/api/policies/{policy_id}", json={"ai_insights": ai_insights})

    # Confirm the waiting period is correctly calculated from the ORIGINAL start date
    r = client.get(f"/api/policies/{policy_id}")
    ped_status = r.json()["ai_insights"]["pre_existing_disease_waiting_status"]
    assert ped_status["covered_now"] is True  # 36 months have passed since 2022
    print("Before renewal - PED waiting status:", ped_status)

    # Simulate a renewal: update start_date/end_date to reflect the new period,
    # WITHOUT explicitly touching first_covered_date (exactly what a normal
    # "update after renewal" flow would send).
    client.put(f"/api/policies/{policy_id}", json={"start_date": "2026-08-15", "end_date": "2027-08-14"})

    r = client.get(f"/api/policies/{policy_id}")
    policy_after = r.json()
    assert policy_after["start_date"] == "2026-08-15"  # current period correctly updated
    assert policy_after["first_covered_date"] == original_start  # but original inception preserved!
    ped_status_after = policy_after["ai_insights"]["pre_existing_disease_waiting_status"]
    assert ped_status_after["covered_now"] is True  # still correctly covered, NOT reset to "36 months from renewal"
    print("After renewal - first_covered_date preserved:", policy_after["first_covered_date"])
    print("After renewal - PED waiting status still correct:", ped_status_after)

def test_new_policy_defaults_first_covered_date_to_start_date(registered_user):
    client, user = registered_user
    policy = make_policy(client, start_date="2026-01-01", end_date="2027-01-01")
    r = client.get(f"/api/policies/{policy['id']}")
    assert r.json()["first_covered_date"] == "2026-01-01"
    print("Brand new policy correctly defaults first_covered_date to start_date")

def test_first_covered_date_can_be_explicitly_edited(registered_user):
    client, user = registered_user
    policy = make_policy(client, start_date="2026-01-01", end_date="2027-01-01")
    client.put(f"/api/policies/{policy['id']}", json={"first_covered_date": "2020-06-01"})
    r = client.get(f"/api/policies/{policy['id']}")
    assert r.json()["first_covered_date"] == "2020-06-01"
    print("first_covered_date can be explicitly corrected by the user")
