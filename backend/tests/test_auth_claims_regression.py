import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")


@pytest.fixture
def session():
    return requests.Session()


def test_unauthenticated_dashboard_is_rejected(session):
    response = session.get(f"{BASE_URL}/api/dashboard", timeout=20)
    assert response.status_code == 401


def test_registration_claim_persistence_and_logout(session):
    email = f"test_{uuid.uuid4().hex}@example.com"
    payload = {"name": "Regression Owner", "email": email, "password": "SafePass123!"}
    register = session.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=20)
    assert register.status_code == 200, register.text
    user = register.json()
    assert user["email"] == email
    assert user["role"] == "owner"
    assert user["household_id"]
    assert "password_hash" not in user
    assert session.cookies.get("access_token")
    assert session.cookies.get("refresh_token")

    me = session.get(f"{BASE_URL}/api/auth/me", timeout=20)
    assert me.status_code == 200
    assert "password_hash" not in me.json()
    dashboard = session.get(f"{BASE_URL}/api/dashboard", timeout=20)
    assert dashboard.status_code == 200
    assert all("_id" not in claim for claim in dashboard.json()["claims"])

    created = []
    for claim_type in ("Cashless", "Reimbursement"):
        response = session.post(
            f"{BASE_URL}/api/claims",
            json={"title": f"Regression {claim_type}", "claim_type": claim_type},
            timeout=20,
        )
        assert response.status_code == 200, response.text
        claim = response.json()
        assert claim["type"] == claim_type
        assert "_id" not in claim
        created.append(claim["title"])

    persisted = session.get(f"{BASE_URL}/api/dashboard", timeout=20).json()["claims"]
    assert all(title in [claim["title"] for claim in persisted] for title in created)

    logout = session.post(f"{BASE_URL}/api/auth/logout", timeout=20)
    assert logout.status_code == 200
    assert session.get(f"{BASE_URL}/api/auth/me", timeout=20).status_code == 401


def test_invalid_login_is_safe(session):
    response = session.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "nobody@example.com", "password": "WrongPass123!"},
        timeout=20,
    )
    assert response.status_code == 401
    assert "password_hash" not in response.text.lower()