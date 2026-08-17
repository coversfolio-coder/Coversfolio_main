# Coversfolio

A private claim and coverage companion for Indian households — organize policies, track claims through settlement, and keep a documented claim file with real IRDAI-based SLA tracking.

## Prerequisites

- **Docker Desktop** — [docker.com/get-started](https://www.docker.com/get-started). Includes Docker + Docker Compose. You don't need Node, Python, or MongoDB installed separately; Docker handles all of that.
  - On Windows, make sure Docker Desktop is actually **running** (check the whale icon in your system tray) before using any `docker` command in a terminal.

## Steps to run the app

**1. Open a terminal in the project folder** (the one containing `docker-compose.yml`):

```
cd path/to/Shyog-main
```

**2. Start everything:**

```
docker compose up --build
```

First run takes a few minutes (downloading the MongoDB image, installing npm/pip packages). You'll see logs from all three services (`mongo`, `backend`, `frontend`) interleaved in your terminal. Wait until you see the frontend report it compiled successfully.

**3. Open the app:**

```
http://localhost:3000
```

The backend API runs at `http://localhost:8000` — you can sanity-check it directly at `http://localhost:8000/api/`, which should return `{"message":"Coversfolio API"}`.

**4. Sign up:**

Click "New here? Create a household," fill in name/email/password. Google Sign-In is also available if `GOOGLE_CLIENT_ID` is set in both `.env` files (see below) — otherwise the button just doesn't appear, and email/password always works regardless.

**5. Stop the app:**

`Ctrl+C` in the terminal, then optionally:

```
docker compose down
```

Add `-v` to also wipe the database volume and start completely fresh next time:

```
docker compose down -v
```

## Configuration (already set up, but here's what's in it)

Two `.env` files control local config — both already exist and work out of the box:

- **`backend/.env`** — Mongo connection, a generated `JWT_SECRET`, CORS origins, file storage settings, optional `GOOGLE_CLIENT_ID`
- **`frontend/.env`** — points at the backend URL, optional `REACT_APP_GOOGLE_CLIENT_ID` (same value as the backend one)

If you ever need to regenerate the JWT secret:
```
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

### Enabling Google Sign-In (optional)

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) → **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. Under **Authorized JavaScript origins**, add `http://localhost:3000`
4. Copy the generated Client ID into `GOOGLE_CLIENT_ID` (backend/.env) and `REACT_APP_GOOGLE_CLIENT_ID` (frontend/.env)
5. Rebuild: `docker compose up --build`

### Enabling AI-powered policy analysis (optional)

Adds an "Analyze with AI ✨" button to the Add Policy form — reads any insurer's PDF format (not just the ones the built-in heuristic recognizes) and surfaces maternity caps, sub-limits, exclusions, and a plain-language summary. **This sends the document to Google's Gemini API** — it's off by default and only runs when explicitly clicked, never automatically.

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey), sign in, click **"Create API key"**
2. Copy the key into `GEMINI_API_KEY` in `backend/.env` (no frontend change needed)
3. Rebuild: `docker compose up --build`

Leave `GEMINI_API_KEY` blank to keep this off entirely — the standard non-AI scan still works regardless.

## Common issues

| Problem | Fix |
|---|---|
| `docker: command not found` | Docker Desktop isn't installed or isn't on PATH — install it, then open a **new** terminal window |
| `no configuration file provided: not found` | You're not in the folder containing `docker-compose.yml` — `cd` into the project root first |
| Port 3000 or 8000 already in use | Edit the `ports:` section in `docker-compose.yml`, e.g. change `"3000:3000"` to `"3001:3000"`, then visit `localhost:3001` |
| Backend crashes on startup | Check `backend/.env` exists and `JWT_SECRET` is at least 32 characters |
| Changed the database name or need a clean slate | `docker compose down -v` before `docker compose up --build` |
| Google Sign-In button doesn't appear | Expected if `GOOGLE_CLIENT_ID` isn't set — see the section above |

## What's built so far

See `CHANGELOG.md` for the full running history of features and fixes.

**Working now:** email/password + Google auth, household roles (owner/member/read-only agent) with invites, claims with notes/queries/settlements/status changes, Policies/Evidence/Documents modules with private file storage, policy document auto-extraction (including automatic detection on any upload), and SLA countdown timers grounded in real IRDAI regulatory windows.

**Known gaps:** no packet export, no controlled sharing/revoke flow, no OCR for scanned (photographed) documents, no push notifications. See `CHANGELOG.md`'s "Known gaps" section for the full honest list.
