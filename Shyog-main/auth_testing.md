# Authentication testing playbook

1. Register a new account with `POST /api/auth/register` and confirm secure session cookies are returned.
2. Call `GET /api/auth/me` with the session cookie and confirm the user has an owner role and household id.
3. Call `GET /api/dashboard` with the session cookie and confirm only that household's claim data is returned.
4. Call `POST /api/claims` for both Cashless and Reimbursement and confirm the records persist in the household.
5. Call `POST /api/auth/logout` and confirm `/api/auth/me` returns 401 afterward.
6. Try invalid login credentials and confirm a safe 401 message without account details.
7. Repeat invalid login five times for the same email/IP and confirm a 15-minute 429 lockout; successful login clears the attempt record.
8. As owner, create member and agent invites, list members/activity, revoke a pending invite, and revoke an active member.
9. Accept an invite with the token, confirm the role is preserved, and confirm agents cannot create claims.

## Google (Emergent-managed) sign-in
10. Click "Continue with Google" → user is redirected to `https://auth.emergentagent.com` with `redirect=<origin>/`.
11. After Google auth, browser returns to `#session_id=<token>`. The app must synchronously detect this on first render, POST to `/api/auth/google/session` with `X-Session-ID`, then clear the hash and load `/api/auth/me`.
12. Google users get a household created on first login (role=owner, auth_provider=google). Second login with the same Google email reuses the same user and household — no duplicate.
13. `session_token` HttpOnly cookie is set with `samesite=none; secure`. Persists for 7 days; expiry comparison must be timezone-aware.
14. `/api/auth/me` accepts EITHER `session_token` (Google) or `access_token` (email+password) — both flows must reach the workspace.
15. `/api/auth/logout` deletes the session row from `user_sessions` and clears both cookies.

### Seeded test session (for testing agent)
```bash
mongosh test_database --eval "
var userId = 'test-goog-' + Date.now();
var householdId = 'test-hh-' + Date.now();
var token = 'test_session_' + Date.now();
db.users.insertOne({id:userId,email:'goog.'+Date.now()+'@example.com',name:'Google Tester',household_id:householdId,role:'owner',auth_provider:'google',created_at:new Date().toISOString()});
db.households.insertOne({id:householdId,name:'Google household',city:'India',members:1,owner_id:userId});
db.user_sessions.insertOne({user_id:userId,session_token:token,expires_at:new Date(Date.now()+7*24*60*60*1000),created_at:new Date()});
print(token);
"
```
