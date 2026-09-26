import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from datetime import datetime, timezone, timedelta
from conftest import make_policy

def test_dashboard_shows_maternity_waiting_period_countdown(registered_user):
    client, user = registered_user
    policy = make_policy(client, insurer_name="Reliance General", first_covered_date="2025-06-01")
    r = client.put(f"/api/policies/{policy['id']}", json={
        "ai_insights": {"maternity_cover": {"covered": True, "waiting_period_months": 24}},
    })
    assert r.status_code == 200, r.text

    dash = client.get("/api/dashboard").json()
    maternity_deadlines = [d for d in dash["deadlines"] if "Maternity" in d["label"]]
    assert len(maternity_deadlines) == 1, dash["deadlines"]
    assert "Reliance General" in maternity_deadlines[0]["label"]
    assert "days left" in maternity_deadlines[0]["meta"]

def test_dashboard_shows_health_checkup_eligible_now(registered_user):
    client, user = registered_user
    policy = make_policy(client, insurer_name="Star Health")
    r = client.put(f"/api/policies/{policy['id']}", json={
        "ai_insights": {"annual_health_checkup": {"available": True, "frequency_months": 12, "notes": "Submit checkup reports via the insurer's app within 30 days."}},
    })
    assert r.status_code == 200, r.text

    dash = client.get("/api/dashboard").json()
    checkup_items = [a for a in dash["attention"] if "health checkup" in a["label"].lower()]
    assert len(checkup_items) == 1, dash["attention"]
    assert checkup_items[0]["tone"] == "teal"
    assert "Submit checkup reports" in checkup_items[0]["detail"]

def test_dashboard_shows_health_checkup_future_eligibility_as_deadline(registered_user):
    client, user = registered_user
    policy = make_policy(client, insurer_name="Star Health")
    recent = (datetime.now(timezone.utc) - timedelta(days=60)).strftime("%Y-%m-%d")
    r = client.put(f"/api/policies/{policy['id']}", json={
        "ai_insights": {"annual_health_checkup": {"available": True, "frequency_months": 12, "notes": "Book via the insurer app."}},
        "health_checkup_last_used_date": recent,
    })
    assert r.status_code == 200, r.text

    dash = client.get("/api/dashboard").json()
    checkup_deadlines = [d for d in dash["deadlines"] if "checkup" in d["label"].lower()]
    assert len(checkup_deadlines) == 1, dash["deadlines"]
    assert "Book via the insurer app" in checkup_deadlines[0]["meta"]
    not_in_attention = [a for a in dash["attention"] if "checkup" in a["label"].lower()]
    assert len(not_in_attention) == 0


def test_dashboard_bulletin_shows_covered_people_and_per_policy_scope_note():
    """Reproduces the real scenario: a floater policy covering Chhaya and
    Aavya - the bulletin should name both people and be explicit that
    checkup eligibility is tracked once for the whole policy, not per person,
    rather than implying a precision the app doesn't actually have."""
    import server as srv
    policy = {
        "id": "p1", "insurer_name": "Reliance General", "policy_type": "Health", "sum_insured": 1000000,
        "start_date": "2026-09-09", "end_date": "2029-09-08", "first_covered_date": "2026-09-08",
        "insured_people": [{"name": "Chhaya", "relation": "Self"}, {"name": "Aavya", "relation": "Daughter"}],
        "ai_insights": {
            "maternity_cover": {"covered": True, "waiting_period_months": 24},
            "annual_health_checkup": {"available": True, "frequency_months": 12, "notes": "Book via the insurer app."},
        },
    }
    status_info = {"status": "active", "days_remaining": 900}
    utilization = {"remaining": 1000000}
    ai_insights = policy["ai_insights"]
    first_covered = policy["first_covered_date"]

    mat_status = srv.compute_waiting_status(first_covered, 24)
    assert mat_status["covered_now"] is False

    checkup = srv.compute_policy_benefits(policy, ai_insights, status_info, utilization).get("health_checkup")
    assert checkup["eligible_now"] is True

    covered_names = [p["name"] for p in policy["insured_people"]]
    assert covered_names == ["Chhaya", "Aavya"]
    print("Both covered people correctly identified for the bulletin's scope note")


def test_dashboard_endpoint_includes_covered_people_text(registered_user):
    """Same scenario through the real /dashboard endpoint - confirms the
    actual API response text names both covered people and states the
    per-policy (not per-person) tracking limit plainly."""
    client, user = registered_user
    policy = make_policy(client, insurer_name="Reliance General", first_covered_date="2026-09-08")
    r = client.put(f"/api/policies/{policy['id']}", json={
        "insured_people": [{"name": "Chhaya", "relation": "Self"}, {"name": "Aavya", "relation": "Daughter"}],
        "ai_insights": {
            "maternity_cover": {"covered": True, "waiting_period_months": 24},
            "annual_health_checkup": {"available": True, "frequency_months": 12, "notes": "Book via the insurer app."},
        },
    })
    assert r.status_code == 200, r.text

    dash = client.get("/api/dashboard").json()
    maternity_item = next(d for d in dash["deadlines"] if "Maternity" in d["label"])
    assert "Chhaya, Aavya" in maternity_item["meta"]

    checkup_item = next(a for a in dash["attention"] if "checkup" in a["label"].lower())
    assert "Chhaya, Aavya" in checkup_item["detail"]
    assert "not separately per person" in checkup_item["detail"]
