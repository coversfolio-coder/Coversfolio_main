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
