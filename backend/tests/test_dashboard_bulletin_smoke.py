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
