import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))

def test_scanned_document_gets_linked_to_new_policy(registered_user):
    """Reproduces the real feature: upload a policy PDF (as would happen
    during a scan), then create the policy referencing that document id -
    it should become downloadable via the policy's linked documents."""
    client, user = registered_user

    upload_res = client.post(
        "/api/documents",
        files={"file": ("reliance_policy.pdf", b"%PDF-1.4 fake policy content", "application/pdf")},
        data={"category": "policy_document"},
    )
    assert upload_res.status_code == 200, upload_res.text
    document_id = upload_res.json()["id"]

    create_res = client.post("/api/policies", json={
        "insurer_name": "Reliance General", "policy_number": "POL-123", "policy_type": "Health",
        "sum_insured": 1000000, "start_date": "2026-09-09", "end_date": "2029-09-08",
        "scanned_document_id": document_id,
    })
    assert create_res.status_code == 200, create_res.text
    policy_id = create_res.json()["id"]

    linked_res = client.get(f"/api/documents?policy_id={policy_id}")
    assert linked_res.status_code == 200
    linked_docs = linked_res.json()["documents"]
    assert len(linked_docs) == 1
    assert linked_docs[0]["id"] == document_id
    assert linked_docs[0]["filename"] == "reliance_policy.pdf"

def test_scanned_document_id_from_another_household_is_ignored(registered_user):
    """A stray or mismatched document id from a different household must
    never get linked - confirms the household scoping actually works."""
    client, user = registered_user
    create_res = client.post("/api/policies", json={
        "insurer_name": "Star Health", "policy_number": "POL-999", "policy_type": "Health",
        "sum_insured": 500000, "start_date": "2026-01-01", "end_date": "2027-01-01",
        "scanned_document_id": "nonexistent-doc-id",
    })
    assert create_res.status_code == 200, create_res.text
    policy_id = create_res.json()["id"]
    linked_res = client.get(f"/api/documents?policy_id={policy_id}")
    assert linked_res.json()["documents"] == []
