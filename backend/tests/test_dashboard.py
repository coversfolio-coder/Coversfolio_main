"""Dashboard aggregates: KPIs and per-claim packet-readiness status.

This is the app's actual job made visible - getting a claim packet ready to
file, not settling it - so packet_status prioritizes "insurer requested more
info" over "ready to submit" even when every canonical document is attached,
since an open query means it isn't actually ready.
"""
from conftest import make_policy, make_claim


def test_kpis_aggregate_across_policies(registered_user):
    client, _ = registered_user
    make_policy(client, insurer_name="Star Health", sum_insured=1000000)
    make_policy(client, insurer_name="HDFC ERGO", sum_insured=500000)
    kpis = client.get("/api/dashboard").json()["kpis"]
    assert kpis["total_sum_insured"] == 1500000
    assert kpis["insurer_count"] == 2
    assert kpis["active_policies"] == 2


def test_packet_status_missing_then_ready(registered_user):
    client, _ = registered_user
    policy = make_policy(client)
    claim = make_claim(client, policy_id=policy["id"])

    claims = client.get("/api/dashboard").json()["claims"]
    this_claim = next(c for c in claims if c["id"] == claim["id"])
    assert "missing" in this_claim["packet_status"]
    assert this_claim["documents_attached"] == 0

    for cat in ["policy_document", "id_proof", "discharge_summary", "hospital_bill", "consultation", "pharmacy_bill", "opd_receipt"]:
        client.post("/api/documents", files={"file": (f"{cat}.pdf", b"%PDF-1.4 fake", "application/pdf")},
                     data={"category": cat, "linked_claim_id": claim["id"]})

    claims = client.get("/api/dashboard").json()["claims"]
    this_claim = next(c for c in claims if c["id"] == claim["id"])
    assert this_claim["packet_status"] == "Ready to submit"


def test_open_query_overrides_ready_to_submit(registered_user):
    client, _ = registered_user
    policy = make_policy(client)
    claim = make_claim(client, policy_id=policy["id"])
    for cat in ["policy_document", "id_proof", "discharge_summary", "hospital_bill", "consultation", "pharmacy_bill", "opd_receipt"]:
        client.post("/api/documents", files={"file": (f"{cat}.pdf", b"%PDF-1.4 fake", "application/pdf")},
                     data={"category": cat, "linked_claim_id": claim["id"]})
    client.post(f"/api/claims/{claim['id']}/queries", json={"question": "Please clarify", "source": "Insurer"})

    claims = client.get("/api/dashboard").json()["claims"]
    this_claim = next(c for c in claims if c["id"] == claim["id"])
    assert this_claim["packet_status"] == "Insurer requested more info"


def test_packets_in_progress_kpi_tracks_incomplete_claims(registered_user):
    client, _ = registered_user
    policy = make_policy(client)
    claim = make_claim(client, policy_id=policy["id"])
    assert client.get("/api/dashboard").json()["kpis"]["packets_in_progress"] == 1

    for cat in ["policy_document", "id_proof", "discharge_summary", "hospital_bill", "consultation", "pharmacy_bill", "opd_receipt"]:
        client.post("/api/documents", files={"file": (f"{cat}.pdf", b"%PDF-1.4 fake", "application/pdf")},
                     data={"category": cat, "linked_claim_id": claim["id"]})
    assert client.get("/api/dashboard").json()["kpis"]["packets_in_progress"] == 0
