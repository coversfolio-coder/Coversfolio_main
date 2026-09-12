import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from conftest import make_policy

def test_agent_ask_returns_501_without_gemini_configured(registered_user):
    client, user = registered_user
    make_policy(client, insurer_name="Star Health")
    r = client.post("/api/agent/ask", json={"message": "When does my waiting period end?"})
    assert r.status_code == 501

def test_agent_ask_requires_auth():
    from fastapi.testclient import TestClient
    import server as srv
    anon_client = TestClient(srv.app)
    r = anon_client.post("/api/agent/ask", json={"message": "hello"})
    assert r.status_code == 401

def test_build_agent_household_context_includes_real_policy_data():
    import server as srv
    policies = [{
        "insurer_name": "Star Health", "policy_type": "Health", "sum_insured": 1000000,
        "start_date": "2022-01-01", "end_date": "2027-01-01", "first_covered_date": "2022-01-01",
        "ai_insights": {"pre_existing_disease_waiting_months": 36, "key_exclusions": ["Cosmetic surgery"]},
    }]
    context = srv.build_agent_household_context(policies, [])
    assert "Star Health" in context
    assert "\u20b910,00,000" in context
    assert "already passed" in context
    assert "Cosmetic surgery" in context
    print("Household context correctly built:", context)
