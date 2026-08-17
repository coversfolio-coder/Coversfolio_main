"""Claim lifecycle: creation, SLA clocks, document packet compilation, permissions."""
from datetime import datetime, timedelta, timezone

import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from conftest import make_policy, make_claim


def test_create_cashless_claim(registered_user):
    client, _ = registered_user
    claim = make_claim(client, title="Hospitalisation", claim_type="Cashless")
    assert claim["type"] == "Cashless"
    assert claim["status"] == "in_progress"


def test_claim_linked_to_nonexistent_policy_rejected(registered_user):
    client, _ = registered_user
    resp = client.post("/api/claims", json={"title": "Test claim", "claim_type": "Reimbursement", "policy_id": "nonexistent"})
    assert resp.status_code == 404


def test_sla_applicable_types_differ_by_claim_type(registered_user):
    client, _ = registered_user
    cashless = make_claim(client, claim_type="Cashless")
    reimbursement = make_claim(client, claim_type="Reimbursement")

    cashless_sla = client.get(f"/api/claims/{cashless['id']}/sla").json()["applicable"]
    assert "pre_auth" in cashless_sla
    assert "reimbursement_decision" not in cashless_sla

    reimb_sla = client.get(f"/api/claims/{reimbursement['id']}/sla").json()["applicable"]
    assert "reimbursement_decision" in reimb_sla
    assert "pre_auth" not in reimb_sla


def test_sla_clock_breach_detected(registered_user):
    client, _ = registered_user
    claim = make_claim(client, claim_type="Cashless")
    two_hours_ago = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    client.post(f"/api/claims/{claim['id']}/sla/start", json={"sla_type": "pre_auth", "started_at": two_hours_ago})
    resp = client.get("/api/dashboard")
    attention = resp.json()["attention"]
    assert any("SLA missed" in a["label"] and claim["id"] in a["label"] for a in attention)


def test_sla_clock_resolve_clears_breach(registered_user):
    client, _ = registered_user
    claim = make_claim(client, claim_type="Cashless")
    two_hours_ago = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    event = client.post(f"/api/claims/{claim['id']}/sla/start", json={"sla_type": "pre_auth", "started_at": two_hours_ago}).json()
    client.post(f"/api/claims/{claim['id']}/sla/{event['id']}/resolve")
    resp = client.get("/api/dashboard")
    assert not any("SLA missed" in a["label"] for a in resp.json()["attention"])


def test_document_packet_follows_canonical_order(registered_user):
    client, _ = registered_user
    claim = make_claim(client, claim_type="Reimbursement")
    resp = client.get(f"/api/claims/{claim['id']}/document-packet")
    sections = resp.json()["sections"]
    assert sections[0]["category"] == "policy_document"
    assert all(s["status"] == "missing" for s in sections)


def test_document_attach_moves_from_suggested_to_attached(registered_user):
    client, _ = registered_user
    policy = make_policy(client)
    claim = make_claim(client, claim_type="Reimbursement", policy_id=policy["id"])
    doc = client.post("/api/documents", files={"file": ("bill.pdf", b"%PDF-1.4 fake", "application/pdf")},
                       data={"category": "hospital_bill", "linked_policy_id": policy["id"]}).json()

    packet = client.get(f"/api/claims/{claim['id']}/document-packet").json()
    section = next(s for s in packet["sections"] if s["category"] == "hospital_bill")
    assert section["status"] == "suggested"

    client.post(f"/api/documents/{doc['id']}/link", json={"linked_claim_id": claim["id"]})
    packet = client.get(f"/api/claims/{claim['id']}/document-packet").json()
    section = next(s for s in packet["sections"] if s["category"] == "hospital_bill")
    assert section["status"] == "attached"


def test_maternity_flag_adds_obstetric_history_to_packet(registered_user):
    client, _ = registered_user
    claim = make_claim(client, claim_type="Reimbursement")
    client.put(f"/api/claims/{claim['id']}/hospitalization", json={"is_maternity": True})
    packet = client.get(f"/api/claims/{claim['id']}/document-packet").json()
    categories = [s["category"] for s in packet["sections"]]
    assert "obstetric_history" in categories


def test_agent_cannot_create_claim(registered_user):
    client, _ = registered_user
    invite = client.post("/api/household/invites", json={"email": "agent2@example.com", "role": "agent"}).json()
    from fastapi.testclient import TestClient
    import server as srv
    agent_client = TestClient(srv.app)
    agent_client.post("/api/household/invites/accept", json={"token": invite["invite_token"], "name": "Agent", "password": "SecurePass123!"})
    resp = agent_client.post("/api/claims", json={"title": "Test claim", "claim_type": "Cashless"})
    assert resp.status_code == 403
