# Coversfolio — Project Changelog

A running record of everything built, fixed, and decided on this project. Newest first within each date.

---

## 2026-08-14

### Policy document auto-extraction
- New `POST /api/policies/extract` endpoint: upload a PDF, Word doc, or plain text file → text extracted automatically (`pypdf`, `python-docx`) → insurer name, policy number, policy type, and sum insured are parsed out using heuristic matching (25+ known Indian insurers, regex patterns for policy numbers and currency amounts).
- Frontend "Scan a policy document" button in the Add Policy form runs analysis the instant a file is picked — no separate "analyze" click needed.
- **Verified the core guarantee end-to-end:** fields already typed in manually are never overwritten by a scan; only empty fields get auto-filled. Tested with a real PDF, DOCX, and TXT sample.
- Unsupported file types, empty files, and scanned image PDFs (no extractable text) return clear errors instead of failing silently or guessing.

### Branding: logo + rename
- Renamed the app from "Sahyog" to **Coversfolio** everywhere — UI text, API responses, database name, Docker container names, and internal docs — after a domain-availability check.
- Designed a real logo from scratch: a shield (protection) containing a claim document with checklist lines, plus a teal "verified" checkmark badge. Wordmark uses the actual Outfit Bold font (pulled via npm, embedded directly in the SVG) to match the app's existing typography exactly.
- Replaced the generic placeholder icon throughout the app (login screen, sidebar, browser favicon, home-screen app icon).
- **Found and fixed a real bug** while integrating the logo: a mobile CSS rule meant only for collapsing the sidebar to icon-only was too broadly scoped and was also silently hiding the login screen's brand text at ≤900px widths. Fixed by scoping the rule to `.sidebar` specifically.
- Fixed hardcoded demo-persona text ("Riya", "The Mehta household", a frozen fake date) on the login screen and dashboard — these now show the real signed-in user's name, a real time-of-day-aware greeting, and the real current date.
- The dashboard's "Needs attention" and "Important dates" sections previously showed the *same three fake tasks* to every household regardless of whether they had any claims. Replaced with real derivation from actual data (open insurer queries, incomplete checklist items) — empty households now honestly show empty states.

### Removed the Emergent platform dependency entirely
- Deleted the Google sign-in flow that routed through Emergent's proxy (`demobackend.emergentagent.com`), along with the `user_sessions` collection it relied on.
- Removed an Emergent branding script and a **PostHog analytics/session-recording script** (sending usage data to `ap.emergent.sh` with a hardcoded API key) that were loaded on every page — a real privacy inconsistency for an app explicitly built to be "privacy-first."
- Replaced with **real Google Sign-In**: verifies ID tokens directly against Google's own servers (official `google-auth` library, checks issuer + verified email) — zero third-party middleman. Fully optional: no Client ID configured means the button simply doesn't render, and email/password auth always works regardless.

### Security & core features (first hardening pass)
- Added silent access-token refresh (`/api/auth/refresh`) so users aren't logged out every 15 minutes.
- Fixed a login-lockout bug where the failed-attempt counter never reset after a lock expired.
- Added rate limiting on registration; validated the JWT secret's strength at startup.
- Built out **Policies**, **Evidence/Inventory**, and **Documents** — previously dead nav buttons with no working pages behind them. Documents now includes real private file storage (type/size validated, auth-gated downloads) and claim checklists that auto-link to uploads.
- Added `docker-compose.yml` for one-command local development (MongoDB + backend + frontend).

### Initial review
- Read through the existing codebase (originally scaffolded via the Emergent AI dev platform) and flagged several issues: a malicious package in `requirements.txt` (`emergentintegrations` — flagged by security researchers for exfiltrating host info on install, and the pinned version didn't even exist on public PyPI), a brute-force lockout bug, missing token refresh, and three feature modules that existed in the nav but did nothing.

---

## 2026-08-14 (continued)

### Smart policy detection, app-wide
Previously, auto-extraction only ran if you specifically used "Scan a policy document" inside the Add Policy form. Closed that gap:
- **Every** document upload (from the general Documents page, not just Add Policy) is now silently checked: if it's a PDF/DOCX/TXT, the same extraction runs in the background.
- **If it matches a policy you already have** (by policy number) → the document is automatically linked to that policy. No prompt, no extra step — you just see a toast confirming the link.
- **If it looks like a new policy you don't have yet** → a banner appears offering "Review & add" — one click jumps you to the Policies page with the Add Policy form already open and pre-filled from what was detected.
- **Never auto-creates a policy record silently** — a new policy is only ever added after you review and explicitly save it, so there's no risk of duplicate or wrong entries appearing without your say-so.
- Verified end-to-end: uploading a document matching an existing policy auto-links with zero duplicate policies created; uploading a genuinely new policy triggers the suggestion banner; uploading a non-policy file (e.g. a photo) is completely unaffected — no detection attempted, no banner shown.

## 2026-08-15 — Research brief + SLA countdown timers

A five-area research brief (regulatory/compliance, document requirements, competitors, technical/UX best practices, terminology) informed the next feature directly:

- New **"SLA tracking"** tab on every claim, built off IRDAI's 2024 Master Circular and the "Cashless Everywhere" initiative. Each clock shows its exact regulatory citation right where you start it.
- **Cashless claims** track: pre-authorization decision (1 hour), final discharge authorization (3 hours), cashless-anywhere intimation window (48 hours).
- **Reimbursement claims** track the commonly-cited 30-day settlement window — explicitly flagged in the UI as unverified against primary source text, per the research brief's own caveat.
- Live, real-time countdown (ticks every second), turns red and switches to "Overdue by Xh Ym" the moment a deadline passes.
- Dashboard's "Needs attention" and "Important dates" now surface real SLA data — breached clocks as urgent attention items, active clocks as genuine upcoming deadlines with real timestamps. Closes the "deadlines" gap from the previous honesty pass.
- Verified: 19 backend tests + a full browser end-to-end run confirming live countdown ticking and correct multi-day formatting.

## 2026-08-15 (continued) — Fixed sum insured extraction on real insurer documents

A real Star Health renewal document exposed two genuine bugs the synthetic test PDFs hadn't caught:

- The actual sum insured figure (₹1,00,00,000) was **split across a line break inside a table cell** ("1,00,00,0" then a newline then "00") — normal for complex multi-column insurer tables, but broke a straightforward regex.
- More seriously, that same document's raw text extraction **scrambled column order**, so the number appeared *before* its own "Sum Insured" label in the flattened text, not after. A same-day fix that searched proximity in both directions technically "worked" but introduced a worse bug: it grabbed a customer ID number (34,013,383) instead, since it happened to be nearby and larger.

Fixed properly rather than patched further: added **table-structure-aware extraction** (`pdfplumber`) for PDFs specifically, which reads the actual column headers and cell geometry the document itself defines — no more guessing from flattened, potentially-scrambled text. It finds the real "Sum Insured" column and pulls the value from the matching row directly. The original text-based regex remains as a fallback for non-tabular documents (DOCX, TXT, simple PDFs), reverted to its safer "label immediately followed by number" form rather than the riskier bidirectional search.

Verified: the real document now correctly extracts ₹1,00,00,000 (not the customer code), and all previously-passing synthetic PDF/DOCX test cases still pass — 11/11 tests.

## 2026-08-15 (continued) — AI-powered policy analysis (Feature 1 of 3)

A user request to make document understanding "smart enough for any insurer's format" and to surface real policy details (like the exact maternity cover cap and waiting period) led to a genuine architectural addition: optional Gemini AI integration, built with explicit privacy tradeoffs in mind rather than silently bolted on.

**Design principles, not just features:**
- **Opt-in per action, never automatic.** An explicit "Analyze with AI ✨" button — not triggered on every upload. The button itself states plainly: "Sends this document to Google's Gemini API."
- **Your own API key, same pattern as Google Sign-In.** Unset `GEMINI_API_KEY` means the button never appears and nothing else in the app changes.
- **AI output always labeled and never authoritative** — a clearly-marked panel reads "AI-GENERATED — ALWAYS VERIFY AGAINST YOUR ACTUAL POLICY DOCUMENT," directly following the confidence-framing guidance from the earlier research brief (never let AI/OCR auto-decide; always human-confirm).

**What it does:**
- New `POST /api/policies/extract-ai` sends the PDF directly to Gemini 2.5 Flash with a structured-output schema — extracts insurer, policy number, type, sum insured, **plus** maternity coverage (covered/not, cap amount, waiting period), other named sub-limits, key exclusions, and a plain-language summary.
- New `GET /api/config` lets the frontend know if AI is configured without duplicating secrets into a second env file.
- Insights are **saved on the policy record itself** (not just shown once and discarded) — this is what the next phase, reimbursement guidance, will read from.
- Verified: 16 backend tests (unconfigured → clean 501, mocked successful analysis matching a real maternity-cover scenario, mocked API failure → clean 502 not a crash, agent permission enforcement) + a full browser end-to-end run confirming the exact scenario requested — "Maternity cover: Covered, capped at ₹1,00,000 after a 24-month waiting period" — displays correctly end-to-end.

**Still to come:** reimbursement guidance grounded in the actual policy document (caps, process, required documents), and intelligent document compilation (auto-sorting uploaded bills/receipts against claim requirements).

## 2026-08-15 (continued) — Policy visibility, document categories, and claim compilation

A detailed spec for making policies visible with real status/limits, organizing documents by type, and auto-compiling claim documents in insurer order — all built and verified end-to-end:

**Policy status & remaining limits:**
- Every policy now computes a real status: **Active**, **Grace period** (30-day default post-expiry), or **Expired** — with days-remaining shown everywhere the policy appears.
- **Remaining sum insured** tracked automatically: reduces as settlements get recorded against claims linked to that policy, so "₹X of ₹Y remaining" is always real, not static.
- Dashboard's "Needs attention" now flags policies expiring within 30 days, in grace period, or expired — as real, derived attention items, not separate from the existing honest-data pattern.

**Documents reorganized:**
- Policies now show as summary cards **at the top of the Documents page** — insurer, status pill, renewal countdown, remaining limit, and (if AI-analyzed) maternity cap/waiting period, all in one place.
- Documents are grouped into labeled sections by category: Policy document, Discharge summary, Hospital bill, Consultation papers, Pharmacy bill, OPD receipt, Claim settlement, ID proof, Other.
- Upload flow now asks **what kind of document** it is and optionally **which policy** it belongs to, via a proper dialog — no longer defaults silently to "general."

**Claims can now link to a policy:**
- New Claim modal has an optional policy picker.
- This is what makes the next feature possible — the app now knows which policy's rules apply to a given claim.

**Document compilation, in insurer-standard order:**
- New "Document packet" tab on every claim shows documents organized in the order insurers commonly expect them (drawn from the earlier research brief's cross-insurer pattern) — different orders for Cashless vs. Reimbursement claims.
- Each section shows **Attached** (already linked), **Suggested** (a matching document exists under the same policy but isn't linked yet — one click to attach), or **Missing**.
- **Never auto-attaches anything silently** — matching documents are only ever suggested, confirmed by a click, consistent with the "suggest, don't auto-decide" principle from the research brief.

Verified: 22 backend tests (status computation across active/grace/expired scenarios, utilization tracking through real settlements, claim-policy linkage and validation, document linking, packet compilation and ordering, suggested-vs-attached distinction) + a full browser end-to-end run confirming every piece works together live — including clicking "Attach" and watching a document move from Suggested to Attached in real time.






## 2026-08-15 (continued) — Fixed missing date and insured-people extraction

A follow-up check on the earlier sum-insured fix revealed that Start date, End date, and Insured people were never actually implemented in the document scanner — not a bug in the extraction logic, just fields that were never built:

- Added period-of-insurance date parsing (handles both "07-Aug-2025" and "2026-01-15" style formats), converting to the format the date picker expects.
- Added table-aware insured-person extraction (same `pdfplumber` approach as the sum-insured fix) — reads the "Details of Insured Persons" table's Name/Relation columns directly.
- **Also found the frontend never applied these fields even when present** — both the standard scan and the AI analysis handler silently ignored `start_date`/`end_date`/`insured_people` in the response. Fixed both, using the same only-fill-if-empty rule as every other field.

Verified directly against the real Star Health document: Start date, End date, insurer, policy number, sum insured, and the insured person's name and relation now all fill correctly — confirmed with a live browser screenshot, not just an API response. 10 backend tests pass, including a regression check on the previously-working ISO-date format.

## 2026-08-15 (continued) — New logo integrated (user-provided design)

Replaced the hand-drawn shield logo with a new user-provided design: a layered "C" folio mark in blue-to-purple gradient, paired with a two-tone "Coversfolio" wordmark (navy "Covers" + blue-purple gradient "folio").

- Cropped the icon mark out of the full lockup image (auto-detected the true content boundary rather than eyeballing coordinates, to avoid bleeding in the adjacent letter), padded to a square canvas, and exported at all sizes the app actually uses (512/192/180/32/16 + favicon.ico).
- Replaced the icon in both the login screen and sidebar; removed the old hand-drawn SVG.
- Sampled the exact colors from the source image (`#011b51` navy, `#00abfa`→`#7d20e9` gradient) and reproduced the wordmark's two-tone treatment in CSS, so the text stays crisp HTML rather than a flattened raster image.
- **Known tradeoff, stated honestly:** this is a detailed 3D-shaded illustration rather than flat vector art, so it loses some crispness at true favicon size (16-32px) compared to the previous hand-drawn version. Still clearly identifiable, just softer.

## 2026-08-15 (continued) — Onboarding checklist, plus a stale-data bug fix

Direct follow-up to a candid usability review: a brand-new user landed on an empty dashboard with no guidance on what to do first.

- New "Getting started" card on the dashboard — three real, clickable steps (add a policy → upload a document → you're ready to file a claim), each genuinely reflecting actual household data, not a static checklist. A step shows done (green, checkmark, strikethrough) only once the real underlying data exists.
- Clicking an incomplete step navigates straight to the right page (Policies, Documents) or opens the New Claim modal.
- Dismissible — stored per household, so it won't reappear once someone's decided they don't need it.
- Disappears on its own once all three steps are genuinely done.
- **Found and fixed a real bug while testing this**: the dashboard only fetched data once on login, so switching to another tab and back showed stale information — a newly-added policy wouldn't appear until a full page refresh. Now refetches every time you navigate back to the workspace tab.

Verified: 10 backend tests (each step's done-state computed correctly from real counts, dismiss persistence) + a full browser end-to-end run confirming a step visibly flips from "1" to a green checkmark the moment real data exists, and that the dismiss button actually removes the card.

## 2026-08-15 (continued) — Network hospital locator (deliberately not a hospital database)

A request to add "list of hospitals authorized by insurance provider" led to real research first, since this is a case where being wrong has real financial consequences - showing up expecting cashless treatment somewhere no longer in-network is a genuine harm, not just an inconvenience.

**What the research found:** no major Indian insurer publishes network hospital data via a simple deep-linkable URL - all official locators are interactive search tools. Worse, third-party "hospital list" aggregator sites showed wildly inconsistent counts for the same insurer (one site reported ICICI Lombard has "10,200" network hospitals, another reported "1,013") - exactly the kind of stale, unverifiable data this app should never present as fact.

**What got built instead:** a "Find network hospitals" action on every policy that links directly to the insurer's own official site - verified, not guessed. Star Health and ICICI Lombard have confirmed working direct links (their real hospital-search tools, checked by fetching the actual pages); other known insurers link to their verified homepage with guidance on where to look; unrecognized insurers get an honest fallback web search rather than nothing. Every result carries the same disclaimer regardless of path: networks change often, always confirm cashless eligibility with the hospital's insurance desk before treatment.

**What was deliberately not built:** any hospital list maintained inside the app itself. Scraping and caching insurer network data would go stale in ways we can't detect, and presenting it as current would be worse than not having the feature at all.

Verified: 11 backend tests (verified insurer links, unverified-but-known insurer links, unknown-insurer fallback, city query handling, 404 on bad policy) + a full browser end-to-end run confirming the real Star Health URL (`starhealth.in/lookup/hospital/`) is what actually gets returned and linked.

## 2026-08-15 (continued) — "Use my location" for network hospital search

A follow-up question ("can the AI search for user and add 'Use my location'") turned into a useful clarification: reverse-geocoding GPS coordinates into a city isn't actually an AI task. Converting lat/lng to a place name is a deterministic lookup with a purpose-built free service already available (OpenStreetMap's Nominatim) - asking Gemini to guess a city from raw coordinates would be slower, less reliable, and exactly the kind of "let AI improvise something a real tool already does" pattern this build has avoided everywhere else (sum insured, hospital lists).

- New `GET /api/geocode/reverse` endpoint - takes lat/lng, returns city/state/pincode via Nominatim, with a proper identifying User-Agent header (a real requirement of Nominatim's usage policy, not decoration).
- "Use my location" button added next to the city field in the network-hospitals search - uses the browser's own Geolocation API (user must grant permission), then resolves the coordinates through the backend.
- Handles every real failure mode distinctly: browser doesn't support geolocation, user denies permission, coordinates resolve to no known place, or the geocoding service itself is down - each gets its own clear message rather than a generic error.

Verified: 8 backend tests (successful resolution, invalid coordinates, no-address-found, service-timeout handling) + a full browser end-to-end run using Playwright's real geolocation mocking with Pune's actual coordinates - confirmed the city field genuinely fills with "Pune" from real lat/lng math, not a canned response.

## 2026-08-15 (continued) — Coverage breakdown and waiting-period check

Direct answer to "how does a user know what's covered, what's not, and whether a waiting period has actually passed" - built on top of the existing AI policy analysis rather than a new system.

- Extended the Gemini analysis to extract the initial (cooling) waiting period, the pre-existing-disease waiting period, and a list of named conditions/procedures with their own stated waiting periods (cataract, hernia, joint replacement, etc.) - only what the document actually states, nothing invented.
- **The key part: waiting periods are computed live against the policy's real start date**, not shown as an abstract "24 months." A policy that started 800 days ago shows "covered now"; one that started 60 days ago shows "670 days left" - same stated waiting period, different real answer, because the math actually runs against when the policy began.
- New "Ask about a specific condition" search on each AI-analyzed policy - type anything ("knee replacement," "cataract," "pregnancy") and get a direct answer: covered or not, waiting period status, and any notes the document had. Matches loosely (e.g. "knee" finds "Knee Replacement," "pregnancy" finds "Maternity").
- **When a condition isn't in what was extracted, the app says so plainly** rather than guessing - "isn't specifically named... check the exclusions list or ask your insurer" - consistent with the whole app's "never guess, always say when you don't know" approach.
- A "Coverage & waiting periods" view shows all of this together: pre-existing disease wait status, every named condition with a live status pill, and the full exclusions list.

Verified: 16 backend tests (waiting-period math against both recently-started and long-established policies, fuzzy condition matching, maternity matched via natural phrasing, honest non-match handling, no-AI-analysis-yet handling) + a full browser end-to-end run confirming the exact days-remaining numbers shown match the real date math, not placeholder text.

## 2026-08-15 (continued) — Fixed: no way to add AI analysis to an already-saved policy

A real gap found by a user testing their actual account: "Analyze with AI" only existed in the Add Policy form. A policy added earlier via the regular scan (or entered manually) had no way to get AI-analyzed afterward - the "Coverage & waiting periods" feature simply stayed invisible with no path to enable it, and the person had no way to know why.

- `PUT /api/policies/{id}` now accepts `ai_insights`, so an existing policy can be updated with analysis after the fact - previously only settable at creation time.
- New "Analyze with AI" action appears directly on any policy card that doesn't have insights yet (only when Gemini is configured) - upload the same policy PDF, and it updates that policy in place.
- Once analysis lands, "Coverage & waiting periods" appears automatically - no re-adding the policy, no data loss on the existing record (insurer, dates, insured people all untouched).

Verified: 10 backend tests (partial update preserves existing fields, response is fully re-enriched with live waiting-period math) + a full browser end-to-end run reproducing the exact reported scenario - a policy with no insights, missing coverage button, "Analyze with AI" appearing in its place, and the coverage view correctly appearing after analysis completes.

## 2026-08-15 (continued) — Fixed: Gemini model deprecated without warning

A real error from a real account: `gemini-2.5-flash` (the model this app defaulted to) started returning 404 "no longer available to new users" - confirmed via Google's own developer forum as a live, actively-discussed issue affecting many people this month, where Google has been retiring specific dated model versions faster than their own published shutdown dates.

- Also found and fixed a real bug while investigating: **the actual Gemini error was never logged anywhere** - the API endpoint only ever returned a generic "AI analysis failed" message, with the real cause completely lost, not even in server logs. Added proper server-side logging so this is diagnosable going forward.
- **Root fix**: switched the default model from a hardcoded dated version (`gemini-2.5-flash`) to `gemini-flash-latest` - Google's own auto-updating alias that always points to their current recommended flash model. This is the same fix Google's own changelog and multiple affected developers converged on: don't pin to a specific dated model version, since Google's deprecation cadence has been outpacing its own published dates.

Verified: confirmed the new alias is what actually gets sent in the API call (not just changed in a comment), and the full AI-analysis flow still works end-to-end with the update.

## 2026-08-15 (continued) — Automatic retry for transient Gemini errors

Follow-up to the model deprecation fix: after switching to the auto-updating model alias, the next real error was a 503 "currently experiencing high demand - please try again later" - Google's own servers being temporarily overloaded, not a real problem with the request.

- Added automatic retry (up to 3 attempts, with backoff) specifically for transient server errors (5xx) - exactly what Google's own error message asks for.
- **Client errors (4xx) - bad API key, deprecated model, malformed request - fail immediately with no wasted retries**, since retrying something that's fundamentally wrong just delays the real error for no benefit.
- If all 3 attempts hit persistent server errors, it still fails cleanly rather than retrying forever.

Verified: 8 backend tests confirming recovery after 2 transient failures, clean failure after exhausting all retries on persistent errors, and zero retries wasted on a real 4xx client error (using the exact deprecated-model scenario from the previous bug as a regression check).

## 2026-08-15 (continued) — Fixed a real crash: null maternity coverage broke policy enrichment

A genuine bug, separate from the Gemini capacity issue: `AttributeError: 'NoneType' object has no attribute 'get'` when saving AI insights for a policy Gemini correctly determined has no maternity coverage mentioned at all - which is the common case for most policies, not an edge case.

The bug: `ai_insights.get("maternity_cover", {})` only falls back to `{}` when the *key is missing* from the dict. But Gemini legitimately returns `maternity_cover: null` (the key present, value explicitly `None`) whenever a policy doesn't mention maternity - so the fallback never kicked in, and the next `.get(...)` call crashed on `None`. Fixed by checking truthiness explicitly instead of relying on a dict-default that doesn't cover this case.

Verified: 8 backend tests reproducing the exact crash (a policy update with `maternity_cover: null`, mirroring precisely what "Analyze with AI" sends for a policy without maternity coverage) - confirmed the save now succeeds, the subsequent dashboard/policy GET calls that previously would have hit the same broken data don't crash either, and asking "pregnancy" via the condition-checker correctly reports no match rather than erroring.

## 2026-08-15 (continued) — Coverage modal shows everything first, search moved to secondary

UX fix based on real usage: the modal previously led with "Ask about a specific condition," so if a policy document had little structured detail to extract (very possible - the schedule/renewal letter insurers send isn't the same document as the full terms & conditions wording), the person hit a dead end with a "not found" message and nothing else to look at.

- Summary, pre-existing disease waiting period, named conditions, and exclusions now show automatically at the top, no search required.
- "Ask about a specific condition" moved below, clearly labeled "Or search for a specific condition" - still fully available, just no longer the first thing you have to interact with.
- When a document genuinely has nothing extracted (as opposed to a bug), the modal now says so plainly and explains why - "may be a policy schedule rather than the complete terms & conditions wording" - instead of showing three empty sections with no explanation.

Verified: full browser end-to-end run confirming both the sparse-data case (matching a real reported scenario - summary only, everything else null) and the rich-data case render correctly, with the honest guidance message only appearing when there's genuinely nothing to show.

## 2026-08-15 (continued) — Clear quota-limit messaging, reduced retry count

Third error in the same debugging thread, and the simplest one: `429 RESOURCE_EXHAUSTED` - Gemini's free tier caps at 20 requests/day for this model, and today's testing (including the earlier 503 retries) used it up.

- Confirmed (by reading the SDK's own source) that 429 is correctly classified as a 4xx `ClientError`, which the retry logic already skips - the quota error was never being wastefully retried.
- **Reduced automatic retries from 3 to 2** - each retry attempt counts against the daily quota even when it fails, so being less aggressive here means outage-smoothing retries burn through a scarce 20-per-day allowance more slowly.
- The API now returns a specific 429 with a clear, actionable message ("hit Gemini's daily free-tier limit... try again tomorrow, or add billing") instead of the generic "AI analysis failed" - the frontend already surfaces whatever `detail` message the backend sends, so no frontend change was needed for this to show up correctly.

Verified: 6 backend tests confirming the quota error returns the specific message without retrying, and that transient 503s still recover correctly under the new 2-attempt cap.

## 2026-08-16 — Reimbursement claim compilation, built from a real case

Grounded in a real maternity reimbursement claim the user shared (7 weeks of antenatal OP visits, an LSCS delivery for placenta previa, and Star Health's actual signed Claim Form Part A) - confirmed via research that IRDAI genuinely standardizes this across insurers (Part A filled by the policyholder, Part B by the hospital, both mandatory), not something specific to one insurer.

**Found the backend for this was already substantially built** from earlier work, but with real gaps:
- `MATERNITY_EXTRA_CHECKLIST` (the obstetric-history requirement real Part B forms require for maternity claims) was defined but never actually wired anywhere - no `is_maternity` field existed on claims at all.
- The "Claim form" tab existed in the UI's tab list but had **zero content rendered** - clicking it showed nothing.
- The hospitalization-details form (hospital name, admission/discharge dates, diagnosis) had state and a save handler in the code, but was **never actually rendered** - dead code with no way to use it.
- Bills could carry an amount and date in the backend, but the Documents upload modal had **no fields to enter either one**.
- Claim-form data was computed by the backend but only as JSON - no actual downloadable document existed, despite that being the explicit ask.

**What got built/fixed:**
- Added `is_maternity` to hospitalization details, wired into the **visible** "Document packet" tab (not the separate, unused checklist API it was originally connected to) - a maternity claim now shows "Obstetric history (maternity claims)" as a real, trackable requirement.
- Built the actual hospitalization-details form into the claim's "Claim form" tab: patient name, hospital, admission/discharge dates, diagnosis, and the maternity checkbox - all wired to the save endpoint that already existed.
- Added bill amount and bill date fields to the Documents upload modal, plus a "link to a claim" selector - previously only "link to a policy" existed.
- Built a real downloadable PDF ("Reimbursement Claim Summary") via reportlab - policy details, hospitalization details, bills automatically bucketed into pre/during/post-hospitalization with real totals (color-coded document checklist included) - a genuine reference document, not just an on-screen summary.
- Reimbursement summary view in the Claim form tab shows the same bucketed totals live, with a one-click PDF download.

**What this deliberately does not do:** replace the insurer's own Claim Form Part A (needs the policyholder's real signature) or Part B (needs the hospital's declaration and signature) - both are stated explicitly on the generated document itself. This is a compilation aid, not a submission.

Verified: 19 backend tests (maternity checklist wiring on both the initial seed and retroactively, bill bucketing math against real dates matching the user's actual case, PDF generation with correct content-type and structure) + a full browser end-to-end run reproducing the exact real case - CHHAYA DEVI, Venkateshwar Hospital, 26-28 May, placenta previa - with real uploaded bills correctly bucketing to ₹6,600 pre-hospitalization and ₹93,650 hospitalization, grand total ₹1,00,250 shown live and matching the downloadable PDF.

## 2026-08-16 (continued) — Bill copies in the Evidence vault

The Evidence vault (home inventory) could only ever record text details - item name, category, value - with no way to attach the actual receipt. The backend already had the underlying link (`document_ids` on evidence items), it just wasn't wired into the page at all.

- Every inventory item now has **"Take photo"** (opens the device camera directly via `capture="environment"`, not just a generic file picker) and **"Upload bill copy"** (any image, PDF, or Word doc from the device).
- Attached bill copies show right under the item — filename, size, download, remove — no separate page needed.
- New "Purchase receipt" document category, so these also show up correctly organized on the general Documents page.

Verified: confirmed the camera input actually carries the `capture="environment"` attribute that triggers a real camera on mobile devices (not just a bare file picker), and a full browser run uploading both a photo and a PDF to the same item, confirming both appear immediately and also surface correctly under Documents.

## 2026-08-16 (continued) — Proactive coverage check on claims (going deeper on our real edge)

After researching CoverSure (a live, IRDAI-certified, $4M-funded competitor doing much of the same policy-organization and claims-assistance work), the decision was to go deeper on the thing we do more specifically than what CoverSure advertises: turning "know your policy" from a lookup you have to remember to do into an automatic warning at the exact moment it matters.

- The moment a diagnosis is entered on a claim's hospitalization details, the app **automatically** checks it against that claim's linked policy - no separate search required.
- Reuses the same matching logic as the manual "ask about a condition" search (refactored into one shared function, so the two can never silently disagree with each other).
- Shows a clear status: waiting period still active with real days remaining, waiting period passed, not covered per the policy, or an honest "not specifically named" if the diagnosis doesn't match anything extracted - never a guess.
- Also appears in the downloadable Claim Summary PDF, so the warning travels with the document, not just the screen you happened to be looking at.

Verified: 10 backend tests (matched diagnosis with active waiting period, unmatched diagnosis handled honestly, no-diagnosis and no-policy-linked cases both handled without crashing, PDF generation with and without a coverage check present) + a full browser end-to-end run confirming the exact behavior - no banner before a diagnosis exists, then "Cataract: Waiting period active — 670 days left" appearing automatically the moment "Cataract surgery, left eye" was typed and saved.

## 2026-08-16 (continued) — "Maximize your policy": what you're actually eligible to use, right now

A direct extension of the coverage-clarity direction — after "what's covered/excluded/waiting," the natural next question is "what am I actually paying for and not using."

- Extended AI analysis to extract benefits people commonly forget exist: free annual health checkup, restoration/refill of exhausted sum insured, no-claim bonus mechanics, and any other named service (teleconsultation, ambulance cover, wellness discounts, etc.) - only what the document actually states, same as everywhere else in this build.
- **The health checkup tracker is honest about what we can and can't know**: the app has no way of knowing whether you've actually used a benefit unless you tell it, so rather than fabricating a "used/not used" status, there's a simple "I used this today" log - and the eligibility countdown (e.g. "Next eligible 2027-08-16") is computed from that real logged date, not guessed.
- Restoration benefit is flagged as "relevant now" specifically when a policy's remaining sum insured is actually exhausted (reusing the real utilization tracking already built), not shown as a generic fact regardless of circumstance.
- Reuses the waiting-period data already extracted to show which named conditions are "already usable" (waiting period passed) as a positive framing, not just a lookup.
- A real renewal-window reminder about IRDAI's portability right (not insurer-specific, a general regulatory right) appears only when a policy is actually expiring soon or in its grace period.
- Caught and fixed a real bug before shipping: a missing icon import (`Check`) crashed the entire modal at runtime despite a clean production build - confirms why end-to-end browser testing matters beyond just "does it compile."

Verified: 19 backend tests (health checkup eligibility math against logged/unlogged usage, restoration relevance tied to real utilization, waiting-period-passed conditions correctly split from still-waiting ones, renewal reminder only appearing when actually near expiry, graceful handling of policies with partial or no AI insights) + a full browser end-to-end run confirming the live update from "Eligible now" to "Next eligible 2027-08-16" immediately after logging usage.

## 2026-08-16 (continued) — Structural foundation + visual identity fix

After an honest audit of the codebase's design/schema/structure, agreed the app had real technical debt (`server.py` at 2,100+ lines with no persistent tests, an unversioned `ai_insights` schema that already caused one crash) and a real visual problem (the logo's actual brand colors - navy `#011b51` + blue-to-purple gradient - were never reconciled with the rest of the UI, which used a completely different teal-based palette chosen before the logo existed).

**Backend structure - done safely, deliberately scoped:**
- New persistent `backend/tests/` suite (`conftest.py` + `test_auth.py`, `test_policies.py`, `test_claims.py`, `test_ai_features.py`) - 40 tests, isolated fresh in-memory database per test, runs under the project's existing pytest-xdist configuration. This replaces the pattern of writing a disposable test script per feature and deleting it afterward - regression coverage now actually persists.
- Found a pre-existing `test_auth_claims_regression.py` (meant to run against a live deployed server, not a local mongomock setup) - left untouched rather than modifying test infrastructure that wasn't mine to change.
- Caught 4 real bugs in the test-writing itself while building this (single-character names/passwords/titles failing Pydantic validation before ever reaching the logic meant to be tested) - fixed the tests, confirmed the actual app behavior was correct all along.
- Added `schema_version` to `PolicyAIAnalysis` (currently 2) - directly targets the exact bug class that caused the earlier `maternity_cover: null` crash, and documents that any AI-analyzed policy's `ai_insights` may be missing fields depending on when it was analyzed.
- **Deliberately did not attempt** a full split of `server.py` into routers/services/models this pass. Explicitly assessed as too large an undertaking to verify safely in one sitting without real risk of subtle breakage in a currently-working app - flagged honestly rather than rushed.

**Visual identity - the actual brand colors, reconciled with the UI for the first time:**
- Replaced the disconnected teal/navy palette (`#00a88f`/`#0d5c75`, chosen before the logo existed) with tokens that actually match the real brand mark: deep navy `#0b1f3f`, and a `--brand-gradient` (blue `#0ea5e9` to violet `#7c3aed`) pulled directly from the logo itself.
- The primary button is now the one deliberate signature element carrying that gradient - every other surface stays calm and restrained around it, rather than the gradient (or the old flat teal) being scattered everywhere.
- Icon badges and avatars shifted from a teal tint to a soft lavender tint, so teal is now reserved specifically for "positive/active" status (progress bars, "Active" chips, checkmarks) instead of doing double duty as both a status color and generic decoration.
- Softened card shadows and canvas background to a warmer, calmer tone consistent with the new palette.

Verified: full backend test suite still passes (40/40) after the schema change, and the visual changes were confirmed with real browser screenshots (dashboard, policies) showing the gradient button, refined nav states, and consistent icon-badge treatment working together - not just a clean CSS build.

## 2026-08-16 (continued) — Dashboard redesign from a real reference mockup, plus a positioning fix throughout

Implemented against a provided reference design (`coversfolio-dashboard_1.html`) with one explicit correction folded in: **Coversfolio compiles documents and gets a claim ready to file - it does not settle claims.** That distinction is now structural, not just copy:

- Claims are shown as a **"Claim packets" table**, not settlement-tracking cards - columns are Claim / Policy / Packet status / Documents / Started, with actions "Continue" or "Download packet." Packet status reads "Ready to submit," "N documents missing," or "Insurer requested more info" - never "settled," "recovered," or anything implying Coversfolio processed the claim itself.
- **The one priority rule that matters most**: an open insurer query overrides "Ready to submit" even when every canonical document is attached, since a claim isn't actually ready if the insurer's still waiting on an answer. Verified with a dedicated test.
- New KPI row: Active policies, Total sum insured (aggregated across the household, formatted as Cr/L), Claim packets in progress, Overdue SLAs - all computed server-side, none hardcoded.
- New "Your policies" preview cards on the dashboard itself (icon badge, status chip, sum insured/remaining, utilization progress bar), reusing the same `policy-card` styling now shared with the full Policies page.
- Redesigned "Needs attention" and "Important dates" panels matching the reference's visual language exactly.
- Sidebar fully converted to the reference's solid navy background - brand mark, nav items (with the gradient left-accent-bar on the active item), household switcher, privacy note, and profile footer all restyled for the dark background, including a real specificity bug caught and fixed along the way (an override losing to an existing shared rule due to source order in the minified CSS).
- New "Household" nav item, promoting household management out of a secondary switcher-click into a first-class sidebar entry.
- Type system updated to the reference's fonts (Outfit / Inter / IBM Plex Mono for data-dense numbers, dates, and policy IDs).
- Caught and fixed a real bug during the build itself: used the reference's own CSS class names (`.section-head-row`, `.section-title`, `.view-all`, `.section`) in the new JSX but never actually defined them - confirmed via screenshot (text rendering with no spacing at all) before fixing, not just assumed correct from a clean build.

Verified: 44 backend tests (including new dashboard KPI and packet-status priority tests) + a full-page browser screenshot showing real, live-computed data throughout - ₹1.25Cr total sum insured correctly summed across two real policies, a grace-period countdown accurate to the day, an SLA deadline showing the exact computed due-date/time, and packet statuses reflecting real document-attachment counts, not sample data.

## 2026-08-16 (continued) — Object storage for production, and a real registration-blocking bug found and fixed

Working toward the DigitalOcean + MongoDB Atlas hosting plan agreed for public launch.

**Object storage abstraction**: uploaded documents (policies, bills, ID proofs) previously lived only on local disk, which doesn't survive a redeploy on any PaaS. Added a storage layer that works with either local disk (unchanged default, so docker-compose setups keep working exactly as before) or an S3-compatible bucket like DigitalOcean Spaces, switched with one env var (`STORAGE_BACKEND=s3`). Downloads redirect to a short-lived presigned URL rather than proxying file bytes through our own server - faster and cheaper at any real scale.

**Found a genuinely serious bug while reviewing the codebase for this**: the backend already required `consent_given: true` on registration (a real DPDP Act consent requirement, sensibly added), but the frontend never sent it - meaning **every single registration attempt was silently failing** with "please agree to the Privacy Policy and Terms of Service," including for the existing Google Sign-In path, which had no consent requirement at all despite needing one equally. Fixed both:
- Added a required "I agree to the Privacy Policy and Terms of Service" checkbox to the registration form - the submit button stays disabled until it's checked.
- Google Sign-In is now gated behind the same checkbox for new accounts specifically - existing users signing back in aren't asked again, since they already consented when they first registered.
- Consent timestamp (`consent_given_at`) is recorded on the user record either way, giving real evidence of consent if it's ever needed.

Verified: 49 backend tests (including new S3-storage tests using a mocked bucket - real upload, presigned-download-redirect, and delete behavior confirmed, not just assumed - plus dedicated consent-requirement tests) + a full browser end-to-end run confirming the exact failure mode (submit disabled, Google button gated) and that checking the box actually allows a real registration to succeed.

## 2026-08-16 (continued) — DigitalOcean deployment spec

- Added `.do/app.yaml` - a DigitalOcean App Platform spec defining two components: the backend as a Docker web service (from the existing `backend/Dockerfile`, unchanged), and the frontend as a **native static site** rather than a custom Docker+nginx setup.
- That second choice was a deliberate pivot: I initially built a production Dockerfile + nginx config for the frontend, then realized I had no way to actually test it in this environment (no Docker daemon, network restrictions blocked even installing nginx to check the config syntax). Rather than ship untested infrastructure code, switched to DigitalOcean's native static site hosting, which needs no custom Docker/nginx at all and handles SPA routing automatically - and confirmed the one thing that actually mattered (`REACT_APP_BACKEND_URL` correctly getting baked into the production bundle at build time) with a real, verified build.
- Extended `.env.example` with the `STORAGE_BACKEND`/`S3_*` variables added earlier, with inline guidance on what each DigitalOcean Spaces value maps to.

**What's still manual, and needs your action next**: pushing the repo to GitHub (App Platform deploys from a connected repo), creating the actual DigitalOcean app from this spec, filling in the real Atlas connection string / JWT secret / Spaces credentials as DO's own encrypted environment variables, and adding your GoDaddy domain in DO's app settings - which will then show the exact DNS record to add, more reliably than me guessing GoDaddy's current UI from possibly-stale knowledge.

## What's genuinely working right now





















- Email/password auth with secure JWT cookies, silent refresh, and lockout protection
- Real Google Sign-In (once you add your own Client ID)
- Household roles: owner, member, read-only agent — with invite links and enforced permissions
- Claims: create, track through stages, notes, insurer queries, settlements, status changes (settled/rejected/appealed/reopened), optionally linked to a specific policy
- Policies, Evidence/Inventory, and Documents modules with full CRUD
- Policy status (Active/Grace period/Expired) with real days-remaining, and remaining sum insured tracked through actual settlements
- Documents organized by category with policy summary cards showing status, limits, and AI insights
- Claim document packet compilation — insurer-standard document order with attach/suggest/missing status per claim
- Private file storage with real upload validation
- Policy document auto-scan (PDF/DOCX/TXT → auto-filled form fields), including automatic detection on any document upload
- SLA countdown timers on claims, grounded in real IRDAI regulatory windows
- AI-powered policy analysis (Gemini, opt-in) — maternity caps, sub-limits, exclusions, plain-language summaries
- Reimbursement claim compilation — hospitalization details, maternity-aware document checklist, bills auto-bucketed into pre/during/post-hospitalization, downloadable claim summary PDF
- Network hospital locator — links to verified insurer sources, with "Use my location" reverse geocoding
- Coverage & waiting-period checker — ask about any condition, get a real answer computed against your actual policy start date
- Maximize your policy — health checkup eligibility tracking, restoration/NCB awareness, already-usable conditions, renewal portability rights
- Dashboard reflects real data only — no fabricated tasks or deadlines

## Known gaps (honest, not hidden)
- **Deadlines**: now populated from SLA clocks and policy renewal windows; still no way to set custom manual reminders
- **Packet export**: documents can be compiled and viewed in order, but not yet exported as a single downloadable PDF packet
- **Controlled sharing / revoke flow / device management**: not built
- **OCR for scanned documents**: the policy-scan feature only reads digital text, not photos of paper documents
- **AI-based extraction**: current parsing is regex/keyword heuristics, not a language model — reliable for well-formatted policy schedules, less so for unusual layouts
- **Notifications**: not built
