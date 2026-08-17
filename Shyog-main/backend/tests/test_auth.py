"""Authentication: registration, login, lockout, token refresh, rate limiting."""


def test_register_creates_household_owner(client):
    resp = client.post("/api/auth/register", json={
        "email": "new@example.com", "password": "SecurePass123!", "name": "New User",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "owner"
    assert data["email"] == "new@example.com"


def test_register_duplicate_email_rejected(client):
    client.post("/api/auth/register", json={"email": "dup@example.com", "password": "SecurePass123!", "name": "User One"})
    resp = client.post("/api/auth/register", json={"email": "dup@example.com", "password": "SecurePass123!", "name": "User Two"})
    assert resp.status_code == 409


def test_login_wrong_password_rejected(client):
    client.post("/api/auth/register", json={"email": "u@example.com", "password": "SecurePass123!", "name": "U"})
    resp = client.post("/api/auth/login", json={"email": "u@example.com", "password": "WrongPassword1!"})
    assert resp.status_code == 401


def test_login_lockout_after_five_failures(client):
    client.post("/api/auth/register", json={"email": "locktest@example.com", "password": "SecurePass123!", "name": "Lock"})
    for _ in range(5):
        client.post("/api/auth/login", json={"email": "locktest@example.com", "password": "WrongPass1!"})
    resp = client.post("/api/auth/login", json={"email": "locktest@example.com", "password": "SecurePass123!"})
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
        client.post("/api/auth/register", json={"email": f"rl{i}@example.com", "password": "SecurePass123!", "name": "RL"})
    resp = client.post("/api/auth/register", json={"email": "rl-final@example.com", "password": "SecurePass123!", "name": "RL"})
    assert resp.status_code == 429


def test_google_signin_returns_clean_error_when_unconfigured(client):
    import server as srv
    srv.GOOGLE_CLIENT_ID = ""
    resp = client.post("/api/auth/google", json={"credential": "x" * 25})
    assert resp.status_code == 501
