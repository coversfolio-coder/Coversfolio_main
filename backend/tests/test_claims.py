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


def test_claim_form_pdf_download_works(registered_user):
    """Regression test: an earlier edit accidentally deleted the 'def
    render_claim_form_pdf' line while adding an unrelated endpoint nearby,
    leaving its body as unreachable dead code and making the function
    undefined. No test caught this until it was reported live - this and the
    persistence test below exist specifically so that class of mistake fails
    the test suite instead of shipping silently again."""
    client, _ = registered_user
    policy = make_policy(client)
    claim = make_claim(client, claim_type="Reimbursement", policy_id=policy["id"])
    r = client.get(f"/api/claims/{claim['id']}/claim-form-pdf")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"
    assert len(r.content) > 500


def test_claim_form_analysis_persists_and_reloads(registered_user):
    """The uploaded claim form's OCR/AI match result must survive a reload,
    not just live in frontend state for the current session - and a fresh
    upload should replace it, the same way a new document replaces an old one."""
    import io
    from PIL import Image, ImageDraw

    client, _ = registered_user
    policy = make_policy(client, policy_number="PER-999")
    claim = make_claim(client, claim_type="Reimbursement", policy_id=policy["id"])

    img = Image.new("RGB", (300, 100), color="white")
    ImageDraw.Draw(img).text((10, 10), "Policy No: ____", fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    r = client.post(f"/api/claims/{claim['id']}/analyze-claim-form", files={"file": ("form.png", buf.getvalue(), "image/png")})
    assert r.status_code == 200, r.text
    assert r.json()["mode"] == "ocr_only"  # no GEMINI_API_KEY in the test environment

    # Confirm the follow-up GET (simulating "closed the app and came back")
    # actually surfaces the saved analysis, not just the one-time POST response.
    r = client.get(f"/api/claims/{claim['id']}/claim-form")
    assert r.status_code == 200
    saved = r.json().get("claim_form_analysis")
    assert saved is not None
    assert saved["filename"] == "form.png"

    # A fresh upload should replace it outright, not merge or duplicate.
    buf2 = io.BytesIO()
    img2 = Image.new("RGB", (300, 100), color="white")
    ImageDraw.Draw(img2).text((10, 10), "Name of Insured: ____", fill="black")
    img2.save(buf2, format="PNG")
    r = client.post(f"/api/claims/{claim['id']}/analyze-claim-form", files={"file": ("form-v2.png", buf2.getvalue(), "image/png")})
    assert r.status_code == 200, r.text
    r = client.get(f"/api/claims/{claim['id']}/claim-form")
    assert r.json()["claim_form_analysis"]["filename"] == "form-v2.png"
from conftest import make_policy, make_claim

def test_deduction_settlement_with_billed_and_reason(registered_user):
    client, user = registered_user
    policy = make_policy(client, insurer_name="Star Health")
    claim = make_claim(client, claim_type="Reimbursement", policy_id=policy["id"])

    r = client.post(f"/api/claims/{claim['id']}/settlements", json={
        "amount": 15000, "kind": "deduction", "note": "Operation Theatre charges",
        "billed_amount": 15000, "insurer_reason": "Not payable under maternity benefit",
    })
    assert r.status_code == 200, r.text
    entry = r.json()
    assert entry["billed_amount"] == 15000
    assert entry["insurer_reason"] == "Not payable under maternity benefit"
    print("Deduction entry with billed_amount/insurer_reason:", entry)

def test_escalation_letter_includes_real_deduction_data(registered_user):
    client, user = registered_user
    policy = make_policy(client, insurer_name="Star Health", policy_number="7187112401017592")
    claim = make_claim(client, claim_type="Reimbursement", policy_id=policy["id"])
    client.post(f"/api/claims/{claim['id']}/settlements", json={
        "amount": 15000, "kind": "deduction", "note": "Operation Theatre charges",
        "billed_amount": 15000, "insurer_reason": "Not payable under maternity benefit",
    })
    client.post(f"/api/claims/{claim['id']}/settlements", json={
        "amount": 8000, "kind": "deduction", "note": "Consultant fees",
        "billed_amount": 8000, "insurer_reason": None,
    })

    r = client.get(f"/api/claims/{claim['id']}/escalation-letter", params={"stage": "gro"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["deduction_count"] == 2
    letter = data["letter"]
    assert "Star Health" in letter
    assert "7187112401017592" in letter
    assert "Operation Theatre charges" in letter
    assert "Consultant fees" in letter
    assert "₹15,000.00" in letter
    assert "Not payable under maternity benefit" in letter
    assert "No reason provided by insurer" in letter  # the second deduction had no insurer_reason
    assert "exact clause and page number" in letter
    assert "30 days" in letter
    print("GRO letter generated correctly, total dispute amount shown:", "₹23,000.00" in letter)

    r2 = client.get(f"/api/claims/{claim['id']}/escalation-letter", params={"stage": "ombudsman"})
    assert r2.status_code == 200
    assert "Insurance Ombudsman" in r2.json()["letter"]
    print("Ombudsman-stage letter also generated correctly")

def test_escalation_letter_rejects_bad_stage(registered_user):
    client, user = registered_user
    policy = make_policy(client)
    claim = make_claim(client, claim_type="Reimbursement", policy_id=policy["id"])
    r = client.get(f"/api/claims/{claim['id']}/escalation-letter", params={"stage": "bogus"})
    assert r.status_code == 400

def test_escalation_path_present_in_claim_form(registered_user):
    client, user = registered_user
    policy = make_policy(client)
    claim = make_claim(client, claim_type="Cashless", policy_id=policy["id"])
    r = client.get(f"/api/claims/{claim['id']}/claim-form")
    assert r.status_code == 200
    path = r.json()["escalation_path"]
    assert len(path) == 3
    assert path[0]["label"] == "Insurer's Grievance Redressal Officer (GRO)"
    assert path[2]["label"] == "Insurance Ombudsman"
    assert "50 lakh" in path[2]["citation"]
    assert "1 year" in path[2]["timeframe"]
    print("Escalation path present for Cashless claim too (not type-restricted):", [p["label"] for p in path])
