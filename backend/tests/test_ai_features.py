"""AI-derived features: extraction shape, waiting-period math, coverage checks,
policy benefits. All tested against mocked Gemini responses - never hits the
real API - so these stay fast and deterministic."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from conftest import make_policy, make_claim


def test_extract_ai_returns_501_when_unconfigured(registered_user, monkeypatch):
    client, _ = registered_user
    import server as srv
    monkeypatch.setattr(srv, "GEMINI_API_KEY", "")
    resp = client.post("/api/policies/extract-ai", files={"file": ("p.pdf", b"%PDF-1.4 x", "application/pdf")})
    assert resp.status_code == 501


def test_extract_ai_rejects_non_pdf(registered_user, monkeypatch):
    client, _ = registered_user
    import server as srv
    monkeypatch.setattr(srv, "GEMINI_API_KEY", "fake-key")
    resp = client.post("/api/policies/extract-ai", files={"file": ("p.docx", b"x", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
    assert resp.status_code == 415


def test_waiting_status_passed_for_old_policy(registered_user):
    client, _ = registered_user
    old_start = (datetime.now(timezone.utc) - timedelta(days=800)).strftime("%Y-%m-%d")
    policy = make_policy(client, start_date=old_start, ai_insights={
        "waiting_periods": [{"condition": "Cataract", "waiting_period_months": 24, "covered": True}],
    })
    resp = client.get(f"/api/policies/{policy['id']}")
    item = resp.json()["ai_insights"]["waiting_periods"][0]
    assert item["waiting_status"]["covered_now"] is True


def test_waiting_status_active_for_recent_policy(registered_user):
    client, _ = registered_user
    recent_start = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
    policy = make_policy(client, start_date=recent_start, ai_insights={
        "waiting_periods": [{"condition": "Cataract", "waiting_period_months": 24, "covered": True}],
    })
    resp = client.get(f"/api/policies/{policy['id']}")
    item = resp.json()["ai_insights"]["waiting_periods"][0]
    assert item["waiting_status"]["covered_now"] is False
    assert item["waiting_status"]["days_remaining"] > 600


def test_null_maternity_cover_does_not_crash(registered_user):
    """Regression test for a real bug: Gemini legitimately returns
    maternity_cover: null when a policy doesn't mention maternity at all -
    this must never crash policy enrichment."""
    client, _ = registered_user
    policy = make_policy(client, ai_insights={"maternity_cover": None, "waiting_periods": []})
    resp = client.get(f"/api/policies/{policy['id']}")
    assert resp.status_code == 200
    assert resp.json()["ai_insights"]["maternity_cover"] is None


def test_check_condition_fuzzy_match(registered_user):
    client, _ = registered_user
    policy = make_policy(client, ai_insights={
        "waiting_periods": [{"condition": "Knee Replacement", "waiting_period_months": 24, "covered": True}],
    })
    resp = client.get(f"/api/policies/{policy['id']}/check-condition", params={"condition": "knee"})
    assert resp.json()["matched"] is True
    assert resp.json()["condition"] == "Knee Replacement"


def test_check_condition_honest_when_unmatched(registered_user):
    client, _ = registered_user
    policy = make_policy(client, ai_insights={"waiting_periods": []})
    resp = client.get(f"/api/policies/{policy['id']}/check-condition", params={"condition": "dental implants"})
    assert resp.json()["matched"] is False


def test_claim_form_coverage_check_uses_claim_diagnosis(registered_user):
    client, _ = registered_user
    recent_start = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
    policy = make_policy(client, start_date=recent_start, ai_insights={
        "waiting_periods": [{"condition": "Cataract", "waiting_period_months": 24, "covered": True}],
    })
    claim = make_claim(client, policy_id=policy["id"])
    client.put(f"/api/claims/{claim['id']}/hospitalization", json={"diagnosis": "Cataract surgery"})
    resp = client.get(f"/api/claims/{claim['id']}/claim-form")
    cov = resp.json()["coverage_check"]
    assert cov["matched"] is True
    assert cov["waiting_status"]["covered_now"] is False


def test_health_checkup_eligible_when_never_logged(registered_user):
    client, _ = registered_user
    policy = make_policy(client, ai_insights={
        "annual_health_checkup": {"available": True, "frequency_months": 12, "notes": "test"},
    })
    resp = client.get(f"/api/policies/{policy['id']}")
    assert resp.json()["benefits"]["health_checkup"]["eligible_now"] is True


def test_health_checkup_not_eligible_right_after_logging(registered_user):
    client, _ = registered_user
    policy = make_policy(client, ai_insights={
        "annual_health_checkup": {"available": True, "frequency_months": 12, "notes": "test"},
    })
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    resp = client.put(f"/api/policies/{policy['id']}", json={"health_checkup_last_used_date": today})
    assert resp.json()["benefits"]["health_checkup"]["eligible_now"] is False


def test_restoration_benefit_relevant_only_when_exhausted(registered_user):
    client, _ = registered_user
    policy = make_policy(client, sum_insured=100000, ai_insights={
        "restoration_benefit": {"available": True, "notes": "test"},
    })
    resp = client.get(f"/api/policies/{policy['id']}")
    assert resp.json()["benefits"]["restoration_benefit"]["relevant_now"] is False

    claim = make_claim(client, policy_id=policy["id"])
    client.post(f"/api/claims/{claim['id']}/settlements", json={"amount": 100000, "kind": "final", "note": "full payout"})
    resp = client.get(f"/api/policies/{policy['id']}")
    assert resp.json()["benefits"]["restoration_benefit"]["relevant_now"] is True


def test_gemini_transient_error_retries_then_recovers(registered_user, monkeypatch):
    client, _ = registered_user
    import server as srv
    from google.genai import errors as genai_errors
    monkeypatch.setattr(srv, "GEMINI_API_KEY", "fake-key")
    srv.time.sleep = lambda s: None

    fake_analysis = srv.PolicyAIAnalysis(insurer_name="Star Health", summary="ok")

    class FakeResponse:
        text = fake_analysis.model_dump_json()

    call_count = {"n": 0}

    def side_effect(*a, **kw):
        call_count["n"] += 1
        if call_count["n"] < 2:
            raise genai_errors.ServerError(503, {"error": {"code": 503, "message": "busy", "status": "UNAVAILABLE"}})
        return FakeResponse()

    with patch("server.genai.Client") as MockClient:
        mock_instance = MagicMock()
        mock_instance.models.generate_content.side_effect = side_effect
        MockClient.return_value = mock_instance
        resp = client.post("/api/policies/extract-ai", files={"file": ("p.pdf", b"%PDF-1.4 x", "application/pdf")})
        assert resp.status_code == 200
        assert call_count["n"] == 2


def test_gemini_quota_error_does_not_retry(registered_user, monkeypatch):
    client, _ = registered_user
    import server as srv
    from google.genai import errors as genai_errors
    monkeypatch.setattr(srv, "GEMINI_API_KEY", "fake-key")

    call_count = {"n": 0}

    def side_effect(*a, **kw):
        call_count["n"] += 1
        raise genai_errors.ClientError(429, {"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED"}})

    with patch("server.genai.Client") as MockClient:
        mock_instance = MagicMock()
        mock_instance.models.generate_content.side_effect = side_effect
        MockClient.return_value = mock_instance
        resp = client.post("/api/policies/extract-ai", files={"file": ("p.pdf", b"%PDF-1.4 x", "application/pdf")})
        assert resp.status_code == 429
        assert call_count["n"] == 1
