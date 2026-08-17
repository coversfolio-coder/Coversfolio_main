# Claims & Coverage Companion — Product Record

## Original problem statement
Build a privacy-first responsive web app for Indian households to assemble, understand, and track home-inventory and Mediclaim claim files from preparation through settlement. The v1 promise is to help a household create a defensible claim file without presenting uncertain information as insurance advice. Claim Workspace must be the primary surface, with Policy, Evidence/Inventory, and Documents as supporting modules.

## Architecture decisions
- React frontend with responsive/PWA-style layouts and FastAPI backend.
- MongoDB remains the configured data store; frontend calls only `REACT_APP_BACKEND_URL`.
- Current iteration uses a small `/api/dashboard` contract and seeded prototype data to prove the core workflow.
- AI, authentication, private object storage, notifications, insurer submission, and OCR are deferred rather than implied as complete.

## User personas
- Household owner assembling and managing a claim file.
- Household member contributing evidence and documents.
- Read-only agent helping review a prepared packet.

## Core requirements (static)
- Household, policy, insured people, property, claim, evidence, document checklist, deadlines, audit history, export, and controlled sharing.
- Cashless and reimbursement claim paths, partial settlement, queries, rejection, appeal, and reopened states.
- Every uncertain extraction must be cited, confidence-marked, and confirmed by the user.
- Sensitive medical and financial data must use least-privilege access and private storage.

## What's been implemented
### 2026-08-14
- Replaced starter screen with a polished Claim Workspace dashboard using the Coversfolio Swiss/health-trust design direction.
- Added household summary, active claim progress, needs-attention list, important dates, privacy cue, upload prompt, and responsive sidebar navigation.
- Added new claim modal with cashless and reimbursement choices plus clear feedback states.
- Added `/api/dashboard` FastAPI endpoint with safe JSON-shaped prototype payload; existing status and root endpoints remain healthy.
- Verified desktop and 390px mobile browser flows, no horizontal overflow, API health, and unique `data-testid` coverage.
### 2026-08-14 — Household access
- Added email/password registration and login with secure httpOnly JWT access/refresh cookies, session lookup, logout, and protected dashboard access.
- Added household ownership IDs and owner role assignment; claims persist in MongoDB and are scoped to the signed-in household.
- Added Cashless/Reimbursement claim creation, ObjectId-safe responses, and repeated-login lockout after five failures for 15 minutes.
### 2026-08-14 — Member roles
- Added owner-managed household invitations for members and read-only agents, token acceptance, revocation, and role-preserving sessions.
- Added household-scoped access activity events and a responsive Manage Access panel with pending invitations and revoke controls.
- Enforced read-only agent restrictions on claim creation and blocked revoked users from authenticated access.
### 2026-08-14 — Verification & hardening
- Verified CORS preflight, credentialed browser sessions, and full member-roles workflow via live curl + browser.
- Fixed brute-force lockout: keyed by email instead of proxy IP (proxy IP rotated between requests, so counts never accumulated).
- Removed fictional "Mehta" fallback claim for real households; empty households now see an explicit empty state.
- Verified: 5 wrong logins → 6th correct login returns 429; agent 403 on claim create; member 403 on invite; revoked user 401; audit events captured; household isolation intact.
### 2026-08-14 — Claim Details
- Dedicated claim drawer with tabs for Timeline, Notes, Insurer queries, Settlements, and Outcome.
- Backend endpoints: `GET /api/claims/{id}`, plus `POST` for notes, queries (+respond), settlements, stage, and status (rejected/appealed/reopened/settled).
- Claim now stores `status`, `notes[]`, `queries[]`, `settlements[]`, `stage_history[]`; every mutation writes an audit event and updates dashboard timestamps.
- Agents receive 403 on every write; cross-household reads return 404. New claim from modal auto-opens the detail drawer.
### 2026-08-14 — Emergent Google Sign-In
- Added "Continue with Google" using the Emergent-managed OAuth flow (`https://auth.emergentagent.com/?redirect=...`).
- Backend `POST /api/auth/google/session` exchanges the `X-Session-ID` header for the session token via `demobackend.emergentagent.com`, upserts the user, creates a household on first login (role=owner, auth_provider=google), and sets a `session_token` HttpOnly cookie (samesite=none, secure, 7 days).
- `current_user` now accepts either `session_token` (Google) or `access_token` (email+password JWT); expiry checks are timezone-aware.
- `POST /api/auth/logout` deletes the `user_sessions` row and clears all auth cookies.
- Verified: seeded Google session hits `/auth/me`, `/dashboard`, and claim create; expired session returns 401; invalid `X-Session-ID` returns 401; missing header returns 400; email+password login still works alongside.
### 2026-08-14 — Security hardening & core modules (post-launch review)
- Added `/api/auth/refresh` (silent 15-min access-token renewal) and fixed a lockout-counter bug where the fail count never reset after a lock window expired.
- Added IP-based rate limiting on `/api/auth/register`; validated `JWT_SECRET` length at startup.
- Built full CRUD for **Policies**, **Evidence/Inventory**, and **Documents** modules (previously dead nav buttons) — private local file storage with type/size validation, auth-gated downloads, and claim checklists that auto-link to uploaded documents.
- Replaced the dashboard's hardcoded "2 active policies" and fabricated "Needs attention"/"Important dates" stub data with real counts and items derived from actual claim data (open insurer queries, incomplete checklist items); empty households now correctly show empty states instead of fictional tasks.
- Added `docker-compose.yml` + Dockerfiles for local Mongo/backend/frontend development.
- Verified via 24+ automated backend tests (in-memory Mongo) and full frontend production builds.
### 2026-08-14 — Removed Emergent platform dependency
- Deleted `/api/auth/google/session`, the `user_sessions` collection, and all `*.emergentagent.com` calls/CORS allowances.
- Removed the Emergent branding script and a PostHog analytics/session-recording script (sending usage data to `ap.emergent.sh` with a hardcoded key) from `index.html`.
- Replaced with **real Google Sign-In**: `POST /api/auth/google` verifies ID tokens directly against Google's public keys via the official `google-auth` library (checks issuer + email-verified); frontend uses Google's own Identity Services script. Fully optional — no client ID configured means no button and no crash.
- Rebranded app from "Sahyog" to **"Coversfolio"** throughout (UI, API messages, DB/container names, docs) after a domain-availability check.
- Fixed hardcoded "Riya"/demo-persona text on the login screen and dashboard greeting; greeting and date are now genuinely dynamic (real name, real time-of-day, real date).
- Designed and integrated a real logo (shield + claim-document + verified badge, real embedded Outfit Bold font) replacing the generic icon; added favicon/app-icon files. Fixed a latent CSS bug (an overly broad mobile media-query selector) discovered during integration that was hiding the brand text at ≤900px screen widths.
### 2026-08-14 — Policy document auto-extraction
- Added `POST /api/policies/extract`: accepts PDF/DOCX/TXT, extracts text (`pypdf`, `python-docx`), and heuristically parses insurer name (25+ known Indian insurers), policy number, policy type, and sum insured.
- Frontend "Scan a policy document" button in the Add Policy form triggers extraction immediately on file selection (no separate analyze click) and fills only fields the user hasn't already typed into — verified end-to-end that manually-entered values are never overwritten.
- Unsupported file types, empty files, and unreadable/scanned documents return clear errors rather than failing silently.

## Prioritized backlog
### P0 — Done
- ~~Add authenticated household ownership and role-based access.~~ Done.
- ~~Persist households, policies, claims, documents, deadlines, and audit events in MongoDB.~~ Done (deadlines still need a due-date data model — see P1).
- ~~Add private file storage with upload validation, versioning, recovery, and no public URLs.~~ Done — local disk storage, type/size validated, auth-gated downloads. No versioning or soft-delete/recovery yet.

### P1 — Partially done
- ~~Build separate Policy, Evidence/Inventory, and Documents routes and working CRUD screens.~~ Done.
- ~~Add claim checklist, evidence linking, query/decision/partial-settlement history.~~ Done.
- Packet export — not started.
- Manual deadline confirmation, reminder eligibility, change history — not started; dashboard "Important dates" currently shows an honest empty state since no due-date model exists yet.

### P2
- ~~Add cited document parsing and human-reviewed AI extraction with confidence and failure states.~~ Partially done — heuristic (regex/keyword) extraction for policy documents shipped; not AI-based, no confidence scoring UI, no OCR for scanned images.
- Add controlled sharing, revoke flow, session/device management, and email notifications. — not started.
- Add hospital leads with visible expiry and insurer/TPA verification action. — not started.

## Next tasks
1. Replace seeded dashboard payload with authenticated persistent records.
2. Implement policy/person setup and claim creation persistence.
3. Add private document upload and checklist linking.
4. Introduce reviewable, cited policy extraction after document parsing is reliable.