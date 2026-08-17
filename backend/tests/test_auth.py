"""Authentication: registration, login, lockout, token refresh, rate limiting."""


def test_register_creates_household_owner(client):
    resp = client.post("/api/auth/register", json={
        "email": "new@example.com", "password": "SecurePass123!", "name": "New User", "consent_given": True,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "owner"
    assert data["email"] == "new@example.com"


def test_register_duplicate_email_rejected(client):
    client.post("/api/auth/register", json={"email": "dup@example.com", "password": "SecurePass123!", "name": "User One", "consent_given": True})
    resp = client.post("/api/auth/register", json={"email": "dup@example.com", "password": "SecurePass123!", "name": "User Two", "consent_given": True})
    assert resp.status_code == 409


def test_login_wrong_password_rejected(client):
    client.post("/api/auth/register", json={"email": "u@example.com", "password": "SecurePass123!", "name": "U", "consent_given": True})
    resp = client.post("/api/auth/login", json={"email": "u@example.com", "password": "WrongPassword1!", "consent_given": True})
    assert resp.status_code == 401


def test_login_lockout_after_five_failures(client):
    client.post("/api/auth/register", json={"email": "locktest@example.com", "password": "SecurePass123!", "name": "Lock", "consent_given": True})
    for _ in range(5):
        client.post("/api/auth/login", json={"email": "locktest@example.com", "password": "WrongPass1!", "consent_given": True})
    resp = client.post("/api/auth/login", json={"email": "locktest@example.com", "password": "SecurePass123!", "consent_given": True})
    assert resp.status_code == 429


def test_unauthenticated_request_rejected(client):
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


def test_me_returns_current_user(registered_user):
    client, user = registered_user
    resp = client.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.json()["email"] == user["email"]


def test_logout_clears_session(registered_user):
    client, _ = registered_user
    client.post("/api/auth/logout")
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


def test_register_rate_limited(client):
    for i in range(11):
        client.post("/api/auth/register", json={"email": f"rl{i}@example.com", "password": "SecurePass123!", "name": "RL", "consent_given": True})
    resp = client.post("/api/auth/register", json={"email": "rl-final@example.com", "password": "SecurePass123!", "name": "RL", "consent_given": True})
    assert resp.status_code == 429


def test_google_signin_returns_clean_error_when_unconfigured(client):
    import server as srv
    srv.GOOGLE_CLIENT_ID = ""
    resp = client.post("/api/auth/google", json={"credential": "x" * 25})
    assert resp.status_code == 501


def test_register_without_consent_rejected(client):
    resp = client.post("/api/auth/register", json={
        "email": "noconsent@example.com", "password": "SecurePass123!", "name": "No Consent",
    })
    assert resp.status_code == 400
    assert "Privacy Policy" in resp.json()["detail"]


def test_register_with_consent_false_rejected(client):
    resp = client.post("/api/auth/register", json={
        "email": "noconsent2@example.com", "password": "SecurePass123!", "name": "No Consent", "consent_given": False,
    })
    assert resp.status_code == 400
