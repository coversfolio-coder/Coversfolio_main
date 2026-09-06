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
def test_proportionate_deduction_matches_researched_worked_example(registered_user):
    """Verified against the exact worked example found during research:
    eligible Rs 5,000/day, actual Rs 10,000/day room, Rs 1,60,000 associated
    expenses -> 50% ratio -> Rs 80,000 correctly payable."""
    client, user = registered_user
    r = client.post("/api/tools/proportionate-deduction-check", json={
        "eligible_room_rent": 5000, "actual_room_rent": 10000, "associated_expenses": 160000,
        "excluded_category_deductions": {},
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ratio"] == 0.5
    assert data["correct_payable_on_associated_expenses"] == 80000.0
    assert data["correct_deduction_on_associated_expenses"] == 80000.0
    print("Matches researched worked example exactly:", data["ratio"], data["correct_payable_on_associated_expenses"])

def test_flags_wrongly_deducted_excluded_categories(registered_user):
    client, user = registered_user
    r = client.post("/api/tools/proportionate-deduction-check", json={
        "eligible_room_rent": 5000, "actual_room_rent": 10000, "associated_expenses": 100000,
        "excluded_category_deductions": {"ICU charges": 8000, "Medicines": 3000, "Room rent": 2000},
    })
    assert r.status_code == 200
    data = r.json()
    # "Room rent" isn't in the excluded list, so it should NOT be flagged - only ICU/Medicines
    assert "ICU charges" in data["wrongly_deducted_categories"]
    assert "Medicines" in data["wrongly_deducted_categories"]
    assert "Room rent" not in data["wrongly_deducted_categories"]
    assert data["wrongly_deducted_total"] == 11000.0
    print("Correctly flagged only the truly-excluded categories:", data["wrongly_deducted_categories"])

def test_no_excess_when_room_within_limit(registered_user):
    client, user = registered_user
    r = client.post("/api/tools/proportionate-deduction-check", json={
        "eligible_room_rent": 5000, "actual_room_rent": 4000, "associated_expenses": 50000,
        "excluded_category_deductions": {},
    })
    assert r.status_code == 200
    data = r.json()
    assert data["ratio"] == 1.0
    assert data["correct_deduction_on_associated_expenses"] == 0.0
    assert data["room_rent_excess_per_day"] == 0.0
    print("No deduction when within room rent limit, correctly capped at ratio 1.0")
from conftest import make_policy, make_claim

def test_maternity_claim_includes_prenatal_postnatal_checklist(registered_user):
    client, user = registered_user
    policy = make_policy(client)
    claim = make_claim(client, claim_type="Reimbursement", policy_id=policy["id"])
    client.put(f"/api/claims/{claim['id']}/hospitalization", json={"is_maternity": True})

    r = client.get(f"/api/claims/{claim['id']}/document-packet")
    assert r.status_code == 200
    categories = [s["category"] for s in r.json()["sections"]]
    assert "obstetric_history" in categories
    assert "prenatal_records" in categories
    assert "postnatal_records" in categories

    sections_by_cat = {s["category"]: s for s in r.json()["sections"]}
    postnatal = sections_by_cat["postnatal_records"]
    assert postnatal["guidance"]["supplementary"] is True
    assert "later" in postnatal["guidance"]["supplementary_note"]
    print("Maternity checklist correctly includes pre/post-natal with supplementary note:", postnatal["guidance"]["supplementary_note"])

def test_non_maternity_claim_excludes_maternity_checklist(registered_user):
    client, user = registered_user
    policy = make_policy(client)
    claim = make_claim(client, claim_type="Reimbursement", policy_id=policy["id"])
    r = client.get(f"/api/claims/{claim['id']}/document-packet")
    categories = [s["category"] for s in r.json()["sections"]]
    assert "prenatal_records" not in categories
    assert "postnatal_records" not in categories
    print("Non-maternity claim correctly excludes maternity-specific checklist items")
from conftest import make_policy, make_claim

def _upload_doc(client, filename, category, bill_date):
    r = client.post("/api/documents", files={"file": (filename, b"fake content", "application/pdf")}, data={"category": category, "bill_date": bill_date, "bill_amount": "500"})
    return r.json()["id"]

def test_prenatal_documents_grouped_by_visit_with_window_check(registered_user):
    """Reproduces the real pattern from an actual uploaded example: multiple
    documents (consultation, lab report) from the same visit date, which
    should group together - and checked against the policy's stated
    pre-natal window relative to the claim's admission date."""
    client, user = registered_user
    policy = make_policy(client)
    client.put(f"/api/policies/{policy['id']}", json={
        "ai_insights": {"schema_version": 5, "maternity_cover": {"covered": True, "pre_natal_days": 30, "post_natal_days": 60}},
    })
    claim = make_claim(client, claim_type="Reimbursement", policy_id=policy["id"])
    client.put(f"/api/claims/{claim['id']}/hospitalization", json={"is_maternity": True, "admission_date": "2026-05-25"})

    # May 20 is 5 days before May 25 - clearly within a 30-day window
    doc1 = _upload_doc(client, "consultation_may20.pdf", "prenatal_records", "2026-05-20")
    doc2 = _upload_doc(client, "lab_report_may20.pdf", "prenatal_records", "2026-05-20")
    for d in (doc1, doc2):
        r = client.post(f"/api/documents/{d}/link", json={"linked_claim_id": claim["id"]})
        assert r.status_code == 200, r.text
    # Jan 1 is well over 30 days before May 25 - outside the window
    doc3 = _upload_doc(client, "old_consultation.pdf", "prenatal_records", "2026-01-01")
    r = client.post(f"/api/documents/{doc3}/link", json={"linked_claim_id": claim["id"]})
    assert r.status_code == 200, r.text

    r = client.get(f"/api/claims/{claim['id']}/document-packet")
    assert r.status_code == 200, r.text
    prenatal_section = next(s for s in r.json()["sections"] if s["category"] == "prenatal_records")
    groups = prenatal_section["visit_groups"]

    may20_group = next(g for g in groups if g["visit_date"] == "2026-05-20")
    assert len(may20_group["documents"]) == 2
    assert may20_group["window_status"] == "within_window"

    jan1_group = next(g for g in groups if g["visit_date"] == "2026-01-01")
    assert jan1_group["window_status"] == "outside_window"
    print("Visit grouping and window check both correct:", [(g["visit_date"], len(g["documents"]), g["window_status"]) for g in groups])
