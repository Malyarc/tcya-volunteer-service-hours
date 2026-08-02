# Handoff — ELA TCYA Volunteer Service Hours

Single source of truth for the project's current state. Last updated: 2026-08-01.

## Round 5 (latest) — GO LIVE: real roster + hours, new ID-card design

**Production now holds REAL data** (was dummy/seed before). Both tasks shipped +
verified live on https://tcyavolunteers.netlify.app.

### 1. Data go-live (imported from the chapter's Hours spreadsheet)

- **48 volunteers**, codes `TCYA-0001..0048` in ALPHABETICAL order. New students
  added later just increment (next `TCYA-0049`) and never renumber existing IDs;
  the roster still displays alphabetically (this is how the code sequence +
  name-sorted list already work).
- **13 reconstructed historical events** (Apr–Jul 2026) + the **1 pre-existing
  future event** ("Welcome Kick-off/Orientation", 2026-08-16) which was PRESERVED
  through the import.
- **195 attendance rows + 195 derived submissions**; grand total **745.25 hrs**.
  Hours were reconstructed as COMPLETE attendance rows (checkin = real sign-in,
  checkout = checkin + credited hours) so the app's derive-from-timestamps model
  produces exactly the sheet's numbers. Food Distribution = flat 5.00/event.
- **Verified live**: replayed the client's own `buildSummaries`/`isCountableSubmission`
  against the live public API → 745.25 exact; per-student + per-event totals all
  reconcile against the sheet's Student/Event Totals tabs. A pre-import backup of
  the old dummy state was taken (session scratch).
- `server/src/data/seed-volunteers.js` was regenerated to the real 48 names so a
  FRESH DB seeds the same roster (grades/hours live in the DB, not the seed).

### 2. New QR ID-card design (the chapter's own design)

- New card = light-blue header band (lotus logo + "Tzu Chi Youth Association US" /
  "East LA 東洛慈少"), big bold name, QR, and a branded **ELA-TCYA-###** ID under it.
  Contact details are intentionally NOT on the card (data minimization); the QR
  still encodes only `{t,v,id,code,name}`.
- One canvas renderer (`client/src/cardRenderer.ts`) feeds the modal preview, the
  PNG download, clipboard copy, and the single + bulk PDFs — WYSIWYG.
- **Display ID `ELA-TCYA-001` is shown everywhere** (card, QR modal, admin roster,
  Excel export, event attendance list, edit-volunteer modal, scanner manual pick)
  via `formatDisplayId()`; the stored `code` + QR payload stay the canonical
  `TCYA-0001`, so scanning/identity are unchanged.
- Verified in the running app: cards render correctly; every name (longest fits at
  60px) clears the QR; display IDs show on the roster; no console errors.

### Post-launch adversarial review (bugs found + fixed)

A multi-agent adversarial bug hunt over the go-live diff confirmed the imported
data is invariant-consistent (submissions exactly equal what reconcile re-derives)
and found 3 real defects in the new card feature, all now fixed + verified:

- **Card name-wrap was dead code** — `fitOneLine` returned its `min` on both fit and
  non-fit, so the two-line wrap never ran and a long admin-added name would overflow
  the QR. Fixed (returns 0 on non-fit); long names now wrap ("Maria Guadalupe /
  Hernandez Rodriguez") or shrink, verified in-app.
- **`loadImage` cached rejected promises** — one transient logo-load failure poisoned
  every card render until reload. Now evicts on failure.
- **Manual check-in rejected the branded ID** — the card only shows `ELA-TCYA-###`;
  `parseScannedCode` now normalizes that back to `TCYA-####` (unit-tested), and the
  scanner placeholder was updated.

### Full live UX/UI/a11y audit (2026-08-02) — done + fixed

Full live clickthrough (prod read-only + local for mutations) of every screen,
button, modal, and state at desktop/tablet/mobile, plus a 30-agent code-level
audit (22 confirmed findings). All real issues fixed + verified live:

- **AdminTabs** no longer overflows horizontally (removed `-mx-4/-mx-6`); the page
  no longer scrolls sideways on any admin screen (0px overflow, verified prod).
- **Volunteers panel** shows "Loading volunteers…" instead of flashing
  "No volunteers yet" (looked wiped) before the first fetch resolves.
- **Duplicate-name flow**: one "Add anyway?" prompt, branded `ELA-TCYA-###`, and a
  plain "Not added…" message on decline (was a dangling raw-code question).
- Fixed stale copy: custom fields are NOT on the new card (roster export instead).
- **a11y**: shared `useFocusTrap` on all 5 modals (Tab containment + focus restore);
  `PasscodeGate` role=dialog; aria-labels on placeholder-only inputs; Toast
  aria-live; CreateEvent autofocus; password eye keyboard-reachable; low-contrast
  slate-400 sentences → slate-500.
- **VolunteerQRModal** scrolls on short/landscape viewports (close button reachable).
- **EventDetailPage** per-row pending (toggling one attendee no longer greys all);
  larger tap targets. **ScannerModal** recent-scan truncation + picker reset.
- **VolunteerTable** cause-aware empty state.

Interactive flows all verified working: passcode (wrong/right), roster expand +
search + filter + certificate download, add/edit/duplicate volunteer, QR card
copy/PNG/PDF/email, bulk PDF + Excel, create event (preset + Others custom), event
detail add/toggle/edit-times (hours derive) + scanner manual entry (branded ID).

### Durability posture (operator: the data is real now — protect it)

- The single-replace go-live import is DONE. Do NOT run another replace-all import,
  `/admin/reset`, `npm run reset`, or the parity suite against prod. Updates happen
  only via the admin UI (add/edit volunteers, scan/edit attendance → hours derive)
  or a careful assisted change.
- **TOP ACTION — set a strong `ADMIN_PASSWORD`** (+ `SESSION_SECRET`) in Netlify env.
  It is still the default `1013`; anyone who knows it has full edit/wipe power over
  the now-real data. This is the #1 data-loss/security vector.
- **Enable Neon PITR / automated backups** on the primary branch as an
  app-independent safety net.

## Round 4 — data durability: never lose data again

**Root cause of "events don't persist":** NOT an app bug. The app stores events
durably in Neon (verified by reading Neon directly + confirming an event survived
minutes later across instances). The loss came from **destructive testing against
prod** — the parity suite + reset scripts were pointed at the production Neon DB to
"leave it pristine" after each session, wiping real events. That practice is now
forbidden and guarded.

Hardening (all landed, green bar passing):

- **Fail-closed store** (`create-store.js`): resolves the DB URL from
  `DATABASE_URL || NETLIFY_DATABASE_URL || DATABASE_URL_UNPOOLED ||
  NETLIFY_DATABASE_URL_UNPOOLED`; in a prod-like env with no URL it THROWS instead
  of silently using the ephemeral in-memory store. `api.mjs` catches → 503, never
  serves RAM. (Fixes the silent-in-memory landmine + the circular prod guard.)
- **`GET /api/health`** → `{ ok, backend, persistent, dbOk }` with a live `SELECT 1`
  probe. `persistent:false` = non-durable deploy.
- **Non-destructive import**: `importAll` (both stores) only wipes+replaces the
  categories present in the payload — a volunteers-only restore no longer nukes
  events/hours.
- **Prod-wipe guards**: parity suite throws if `TEST_DATABASE_URL` == `DATABASE_URL`
  or lacks a throwaway marker (override `CONFIRM_TRUNCATE=1`); `reset.js` needs
  `CONFIRM_RESET=1`; `/admin/reset` needs `{"confirm":"RESET"}` + logs counts.
- **Client "looks-wiped" fixes**: `refresh()` uses `Promise.allSettled` (one failed
  fetch no longer blanks events); `checkAdminSession` returns `"unknown"` on
  transient 5xx/network (no spurious logout); admin tab persists across reload.
- **Green:** server memory **76 pass** + create-store/hours unit tests, client
  **25 pass**, build clean, parity-guard refusal verified.

**DEFERRED (needs user):** run live-Postgres parity against a **throwaway**
`TEST_DATABASE_URL` (I will not wipe prod to run it). See "User actions" below.

### User actions (owns Netlify env + Neon)

1. **Confirm `DATABASE_URL` targets the durable Neon PRIMARY branch** (not an
   expiring/preview branch) and is scoped to ALL Netlify deploy contexts.
2. **Provision a throwaway Neon branch/DB** with `test`/`scratch` in its name; use
   its URL as `TEST_DATABASE_URL` for the parity gate. Never use the prod string.
3. **Set a strong `ADMIN_PASSWORD`** (+ `SESSION_SECRET`) — still `1013` on prod.
4. **Enable Neon PITR / automated backups** on the primary as an app-independent
   safety net.

## Round 3 — from-scratch code-review, security + a11y + tests

Full multi-agent review of everything, findings applied, re-verified, deployed.

- **Security — public reads tightened:** `GET /submissions` is now admin-gated.
  Public callers get a projection WITHOUT minors' exact check-in/out clock times,
  free-text comments, or internal submit timestamps (mirrors `publicEvent()` on
  `/events`). Admins still get full rows for the Excel export + attendance detail.
- **Volunteer certificate reachable on mobile:** the cumulative "Download
  certificate" button now shows in the expanded roster row on phones (its desktop
  column is hidden below `sm`). Non-admins no longer see Sign In/Out/Comments
  columns (those fields are stripped server-side; `isAdmin` threads through
  `VolunteerTable`).
- **Import parity fix:** Postgres `importAll` now skips a duplicate event id
  entirely (including its attendance), matching the memory store — a dup id can no
  longer smuggle in new attendance rows.
- **Accessibility:** Events + roster rows are keyboard-activatable (Enter/Space,
  visible focus ring) and their handlers ignore keys bubbling from nested buttons;
  `role="dialog"`/`aria-modal`/`aria-labelledby` on the login + create-event modals.
- **Scanner (iOS):** the AudioContext is unlocked on the first tap anywhere in the
  scanner, so a check-in-only session (default mode, no mode-button tap) still
  beeps on iPhone/iPad.
- **Tests:** added `server/test/hours.test.js` (14 unit tests: 0.25h rounding +
  PST/PDT/EDT/UTC/midnight/invalid-tz for `localHHMM`, `isComplete` decoupling) and
  reconcile-edge + public-projection behavioral tests in the shared suite.
- **Green:** server memory **58 pass**, **live Neon parity 43 pass**, client build
  clean. Prod verified: public roster (90, name+grade only), admin login + full-PII
  `/volunteers`, events 200. Prod DB left pristine (90 roster, 0 events).

## Round 2 — hours from check-in/out, tab nav, mobile

Deployed + verified on prod. Changes on top of the QR feature below:

- **Service hours are now DERIVED from attendance check-in/out times**
  (`hours = checkout − checkin`, rounded 0.25, sign-in/out HH:MM in `CHAPTER_TZ`).
  `reconcileSubmission` (both stores) upserts/deletes the derived submission
  after every attendance mutation. The public "Log Volunteer Hours" form + button
  + `POST /submissions` are removed.
- **Bug fixed:** deleting an event / removing a volunteer deletes the derived
  hours, so no stuck "pending" badge. Volunteer **grade** is editable + reflected
  on the roster.
- **Admin tab nav:** sticky Roster · Volunteers · Events (no scrolling).
- **Mobile/iPad:** tables collapse columns on small screens, bottom-sheet modals,
  thumb-sized tabs. (Live mobile screenshotting was unavailable — the Chrome
  extension was disconnected — verify on-device.)
- Green: server 39, live Neon parity 39, client 25, build clean. Prod verified:
  hours=3 from 09:00→12:00, delete clears hours, form gone (404).

## What just landed (round 1)

A large feature + storage migration, built, audited, code-reviewed, and verified:

- **Neon Postgres backend.** Storage moved from a single JSON doc (file/Blobs) to
  Postgres behind a `Store` interface. `store-postgres.js` (real) +
  `store-memory.js` (reference + local-dev fallback) are kept in lock-step by a
  shared test suite. `create-store.js` picks the backend from `DATABASE_URL`.
  Schema/seed init lazily (advisory-locked) on first request.
- **Volunteer records + QR "ID cards."** Volunteers now have `code` (TCYA-0001…),
  email, phone, grade, and custom fields. Admin Volunteers panel: add/edit/delete,
  per-volunteer QR modal (copy PNG / download / ID-card PDF / email), bulk **QR ID
  Cards (PDF)** + **Roster (Excel)** exports.
- **Camera check-in/out.** Scan volunteer QR codes at an event to check in/out
  (records timestamps); jsQR + native BarcodeDetector fast-path; continuous scan
  with de-dupe, beep, manual fallback. Attendance table shows + lets you edit times.
- **Migration/back-compat.** `POST /api/admin/import` loads an old `{events,
  submissions, volunteers?}` backup into Neon. `GET /api/admin/export` backs up.
  `reset` clears events/attendance/submissions but keeps the roster (+ writes a
  pre-wipe backup file).

## Quality gates passed

- Server memory suite **40 pass**, **live Neon parity 40 pass**, client **24 pass**,
  client build clean.
- **Multi-agent audit** (30 findings) — all fixed.
- **/code-review max** (15 findings, incl. 2 self-introduced HIGH bugs) — all fixed.
  Notable: spoofable rate-limit key hardened; admin-login-on-stale-events timestamp
  wipe fixed (re-fetch on login + editor dirty-tracking).

## Current state / what's left

- **DEPLOYED to prod and verified end-to-end (2026-07-10):**
  https://tcyavolunteers.netlify.app on Neon. Verified live: public roster (90
  from Neon), auth gating (401), admin login, volunteer create + custom fields +
  code sequence, duplicate-name 409, event create, QR check-in/out with
  timestamps, manual time edit preserving the check-in time, public submission +
  self-added flip, PII/QR-code not leaked publicly, export. Prod left pristine
  (90 roster, 0 events/submissions).
- **Code:** complete and green. See `CLAUDE.md` for invariants + test layout.
- **⚠️ ACTION FOR OPERATOR:** `ADMIN_PASSWORD` is currently the weak default
  `1013`. Change it to a strong value in Netlify → Environment variables (and set
  `SESSION_SECRET`). The login throttle + fail-closed default help, but a strong
  password is the real control.
- **Known non-blocking gaps** (from the audit, accepted): the per-instance in-memory
  login throttle is best-effort on serverless — the real controls are the
  fail-closed default + a strong `ADMIN_PASSWORD`. No CI yet; the Postgres parity
  suite (`TEST_DATABASE_URL=… npm test` in `server/`) is a **mandatory manual
  pre-deploy gate** because default `npm test` is memory-only.

## Deploy checklist

1. Netlify env: `DATABASE_URL` (Neon pooled string), `ADMIN_PASSWORD`,
   `SESSION_SECRET`.
2. `cd server && TEST_DATABASE_URL=<throwaway> npm test` (parity gate).
3. Push to `main` → Netlify builds. First request creates schema + seeds roster.
4. Smoke-test: `/api/health`, `/api/roster`, admin login, create event, scan.
