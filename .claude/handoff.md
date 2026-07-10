# Handoff — ELA TCYA Volunteer Service Hours

Single source of truth for the project's current state. Last updated: 2026-07-10.

## Round 3 (latest) — from-scratch code-review, security + a11y + tests

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
