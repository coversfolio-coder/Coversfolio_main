# Coversfolio — Deployment Runbook (starting from scratch)

Follow this in order — each phase depends on the one before it. Check things off as you go; come back anytime.

Your generated production secret (save this in a password manager now, not just here):
```
JWT_SECRET = NVcgflwV8WEJnbmZQtT6Q4VtvTfKNJ7F_Hw8JfSfURgGaSy6bEbF6-AD2KqubsvN
```

---

## Phase 1 — Push the code to GitHub

1. Create a GitHub account if you don't have one: github.com/signup
2. Create a **new, private** repository (Settings → keep it Private — no reason for this to be public)
3. From inside the extracted `Shyog-main` folder, run:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git push -u origin main
   ```
4. Double-check on GitHub's website that `backend/.env` and `frontend/.env` do **not** appear in the pushed files (they shouldn't — `.gitignore` already excludes them, but it's worth a 10-second look before moving on)

---

## Phase 2 — MongoDB Atlas (your database)

1. Sign up at mongodb.com/cloud/atlas
2. Create a new Project (any name)
3. Build a Database → choose the **Flex** tier (not the free M0 — no backups there)
4. While it provisions, create a database user: Database Access → Add New Database User → save the username/password somewhere safe
5. Network Access → Add IP Address → allow `0.0.0.0/0` for now (we can restrict this later once the app is stable)
6. Once the cluster is ready: Database → Connect → Drivers → copy the connection string. It looks like:
   ```
   mongodb+srv://<username>:<password>@yourcluster.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   Replace `<username>`/`<password>` with what you created in step 4, and keep this string safe — it's needed in Phase 4.

---

## Phase 3 — DigitalOcean Spaces (document/file storage)

1. Sign up at digitalocean.com
2. Left sidebar → Spaces Object Storage → Create a Space
   - Region: pick one close to your users (e.g. `blr1` for India)
   - Name it something like `coversfolio-documents`
3. Once created, go to Spaces → **Manage Keys** → Generate New Key → save both the **Access Key** and **Secret Key** immediately (the secret is only shown once)
4. Note down: your Space's name, its region code (e.g. `blr1`), and its endpoint URL (shown on the Space's page, looks like `https://blr1.digitaloceanspaces.com`)

---

## Phase 4 — DigitalOcean App Platform (the app itself)

1. In DigitalOcean: Apps → Create App
2. Choose GitHub as the source → authorize DigitalOcean to access your repo → select the repo you pushed in Phase 1
3. DigitalOcean should detect `.do/app.yaml` automatically and propose two components (`backend` and `frontend`) — if it doesn't detect it, you can still configure manually using that file as reference
4. Before deploying, fill in every environment variable (Settings → each component → Environment Variables):

   **Backend component:**
   | Variable | Value |
   |---|---|
   | `MONGO_URL` | Your Atlas connection string from Phase 2 |
   | `DB_NAME` | `coversfolio_production` |
   | `JWT_SECRET` | The secret generated at the top of this doc |
   | `CORS_ORIGINS` | `https://yourdomain.com` (your actual GoDaddy domain) |
   | `COOKIE_SECURE` | `true` |
   | `STORAGE_BACKEND` | `s3` |
   | `S3_BUCKET` | Your Space's name from Phase 3 |
   | `S3_ENDPOINT_URL` | Your Space's endpoint URL from Phase 3 |
   | `S3_REGION` | Your Space's region code (e.g. `blr1`) |
   | `S3_ACCESS_KEY` | From Phase 3 (mark as **encrypted/secret** in DO's UI) |
   | `S3_SECRET_KEY` | From Phase 3 (mark as **encrypted/secret**) |
   | `GEMINI_API_KEY` | Optional — leave blank to disable AI analysis, or your key from aistudio.google.com |
   | `GEMINI_MODEL` | `gemini-flash-latest` |
   | `GOOGLE_CLIENT_ID` | Optional — leave blank to disable Google Sign-In |

   **Frontend component:**
   | Variable | Value |
   |---|---|
   | `REACT_APP_BACKEND_URL` | `https://yourdomain.com` (same domain, backend is reachable at `/api` on it) |
   | `REACT_APP_GOOGLE_CLIENT_ID` | Optional — same value as backend's `GOOGLE_CLIENT_ID` if used |

5. Deploy. First build takes a few minutes — watch the build logs for errors.

---

## Phase 5 — Connect your GoDaddy domain

1. In the DO app's Settings → Domains → Add Domain → enter your domain
2. DigitalOcean will show you **exactly** which DNS record to add (usually a CNAME or A record depending on whether it's the root domain or a subdomain) — this is more reliable to follow live than any instructions written in advance, since DO tailors it to your specific app
3. Log into GoDaddy → My Products → DNS → add the record DigitalOcean showed you
4. Wait for DNS propagation (can take anywhere from a few minutes to a few hours)
5. DigitalOcean automatically provisions a free HTTPS certificate once DNS resolves correctly — no separate step needed

---

## Phase 6 — Verify it's actually working

Once DNS has propagated:
1. Visit `https://yourdomain.com` — you should see the login screen
2. Register a test account (check the consent checkbox!)
3. Add a policy, upload a document, confirm it shows up
4. Confirm the uploaded document persists after a browser refresh (this specifically tests that Spaces storage is wired correctly, not just local disk)

Come back once you're through a phase (or stuck on one) and I'll help troubleshoot or verify the specific piece.
