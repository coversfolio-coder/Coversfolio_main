def test_non_admin_cannot_list_users(registered_user):
    client, user = registered_user
    r = client.get("/api/admin/users")
    assert r.status_code == 403

def test_admin_can_list_users_with_correct_fields(registered_user, monkeypatch):
    client, user = registered_user
    import server as srv
    monkeypatch.setattr(srv, "ADMIN_EMAILS", {user["email"].lower()})

    r = client.get("/api/admin/users")
    assert r.status_code == 200, r.text
    data = r.json()["users"]
    assert len(data) >= 1
    me = next(u for u in data if u["email"] == user["email"])
    assert me["name"] == user["name"]
    assert me["household_name"]  # resolved from household_id, not just an id
    assert me["is_platform_admin"] is True
    assert "password_hash" not in me
    assert "password_hash" not in str(data)  # confirm it's nowhere in the whole payload
    print("Admin user list correct, password_hash confirmed absent:", me)
def test_regulatory_check_rejects_unauthorized(registered_user):
    """No admin session, no secret - should be rejected outright."""
    client, user = registered_user
    r = client.post("/api/regulatory-check" if False else "/api/admin/regulatory-check")
    assert r.status_code == 403

def test_regulatory_check_admin_session_authorized_but_no_ai_configured(registered_user, monkeypatch):
    import server as srv
    client, user = registered_user
    monkeypatch.setattr(srv, "ADMIN_EMAILS", {user["email"].lower()})
    r = client.post("/api/admin/regulatory-check")
    # Authorized (not 403) - but no GEMINI_API_KEY in the test environment, so 501
    assert r.status_code == 501, r.text

def test_regulatory_check_secret_token_works_without_login(registered_user, monkeypatch):
    """Confirms an external scheduler (no login session at all) can trigger
    this via the secret token - this is what actually makes 'fully automatic,
    recurring' possible, not just admin-triggered."""
    import server as srv
    client, user = registered_user
    monkeypatch.setattr(srv, "REGULATORY_CHECK_SECRET", "test-secret-123")
    # Log out entirely - simulate a bare external caller with no session
    client.cookies.clear()
    r = client.post("/api/admin/regulatory-check", params={"secret": "wrong-secret"})
    assert r.status_code == 403
    r = client.post("/api/admin/regulatory-check", params={"secret": "test-secret-123"})
    assert r.status_code == 501  # authorized via secret, just no AI configured in test env
    print("Secret-token auth path correctly works without any login session")

def test_regulatory_facts_endpoint_shows_current_facts_and_empty_audit(registered_user, monkeypatch):
    import server as srv
    client, user = registered_user
    monkeypatch.setattr(srv, "ADMIN_EMAILS", {user["email"].lower()})
    r = client.get("/api/admin/regulatory-facts")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "pre_auth" in data["facts"]["sla"]
    assert data["facts"]["sla"]["pre_auth"]["hours"] == 1
    assert data["audit_log"] == []
    assert data["last_run"] is None
    print("Regulatory facts endpoint correctly shows hardcoded defaults with empty audit log")
