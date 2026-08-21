# CLAUDE.md — ELA TCYA Volunteer Service Hours

Project-specific guidance for Claude sessions in this repo. See `README.md` for
user-facing docs and `.claude/handoff.md` for current project state.

## What this app is

A React + Express app for a Tzu Chi youth chapter to manage volunteers, hand out
personal **QR "ID cards,"** **scan volunteers in/out of events** with a phone
camera (recording timestamps), and track cumulative service hours. Deployed on
Netlify (serverless function + CDN) or EC2; both talk to the same **Neon
Postgres** database.

## Architecture

- **Storage is injected as a `store`** (see `server/src/db/`). Two implementations
  behind one interface:
  - `store-postgres.js` — Postgres via `@neondatabase/serverless` (HTTP, no pool;
    works on EC2 and serverless alike).
  - `store-memory.js` — in-memory **reference** implementation; also the local-dev
    fallback when `DATABASE_URL` is unset.
  - `create-store.js` picks the backend from `DATABASE_URL`.
- `server/src/routes.js` is the shared Express router (used by both entry points:
  `server/src/index.js` for EC2 and `netlify/functions/api/api.mjs` for Netlify).
- **Hours derivation lives in ONE place**, `server/src/hours.js`
  (`deriveSubmissionFields`), used by both stores and by all three reconcile
  paths (one row / one event / one volunteer) so they cannot drift.
  `server/src/roles.js` defines the two VOLUNTEER roles (the hours cap);
  `server/src/accounts.js` defines the two LOGIN accounts (admin / officer) and
  holds their passcodes; `server/src/db/data-migrations.js` holds the one-time,
  marker-guarded DATA migrations (officer promotion, purge of former members'
  leftover records).
- Frontend: `client/` (Vite + React + Tailwind). QR generation in `client/src/qr.ts`
  (payload + `formatDisplayId`). The ID **card** is drawn by one canvas renderer,
  `client/src/cardRenderer.ts`, which feeds the modal preview, PNG/copy, and the
  single + bulk PDFs (`volunteerExports.ts`) — WYSIWYG. The **bulk** PDF lays the
  cards on the **Avery 74461** clip-badge grid (8/sheet, exact template coords in
  `AVERY_74461` + the pure `avery74461Placements`); `buildQrIdCardsPdf` returns
  the doc, `downloadQrIdCardsPdf` saves it. Scanner in
  `client/src/components/admin/ScannerModal.tsx`.
- **Brand logo:** the lotus + cupped-hands + candle emblem is `/cert-logo.png`
  (header, passcode gate, ID card, certificate). `/tzu-chi-logo.png` is the older
  ship emblem — now unused; do not reintroduce it into the chrome.
- **Events page order:** the page renders one section per event display NAME.
  Admins drag (or arrow) those sections into an order stored in the `event_order`
  table and served by `GET /event-order` (public read) / `PUT /event-order`
  (admin). `sortEventGroups` in `client/src/utils.ts` puts placed sections first
  in the saved order and leaves everything else in the automatic order BELOW, so
  a new event type is never hidden by a stale order. A section with a single date
  renders flat — `isCollapsibleGroup` is the one rule the page and its tests share.
- **Display ID vs canonical code:** the human-facing ID is the branded
  `ELA-TCYA-001` form (`formatDisplayId(code)`), shown on the card, QR modal, admin
  roster, and Excel export. The stored `code` and the QR payload keep the canonical
  `TCYA-0001` form — never derive identity from the display string.

## Critical invariants (do not break)

1. **Hours are DERIVED from attendance check-in/out timestamps.** When an
   attendance row is complete (both `checkinAt` and `checkoutAt` set, checkout
   after check-in), the store's `reconcileSubmission` upserts a submission with
   `hours = checkout − checkin` (rounded to 0.25) and HH:MM sign-in/out in the
   chapter timezone (`server/src/hours.js`, `CHAPTER_TZ`). When incomplete, the
   derived submission is deleted. Submissions are therefore a read-only
   projection of attendance — there is NO public self-submit form. `GET
   /submissions` still serves these rows (roster/certificate/export read them).
   Call `reconcileSubmission` after every attendance mutation in BOTH stores.
1b. **Credited hours are CAPPED for ordinary volunteers, never for officers.**
   `hours = min(checkout − checkin, event.expectedHours)` when the event has
   expected hours set; `volunteers.role = 'officer'` is exempt (officers set up
   before and clean up after). `expectedHours = NULL` means no cap for anyone —
   which is why every pre-existing event's hours were untouched when this
   shipped. `submissions.raw_hours` keeps the uncapped span (admin-only).
   Anything that changes an input to the derivation must RE-DERIVE the affected
   rows: editing an event's name/date/expectedHours re-reconciles the whole
   event; changing a volunteer's role/grade re-reconciles all of theirs.

1c. **The Roster tab is exactly the Volunteers tab.** `buildSummaries` is
   roster-DRIVEN — a submission whose `volunteerName` has no roster entry is
   ignored. Never re-introduce "also add names found in submissions": that is
   precisely how deleted members reappeared as Roster-only ghost rows. The
   shared suite asserts `GET /roster` equals `GET /volunteers`.

1d. **Strikes never touch hours.** `attendance.strikes` is a separate axis, a
   human judgement call. It is read from attendance (not submissions) so a
   strike stays visible even when the attendance row is incomplete. Recorded by
   admins AND by officers (the door staff witness the conduct) through the one
   narrow route `PATCH /events/:id/attendance/strikes`, which can write nothing
   but `strikes` — that structural narrowness IS the officer boundary, so never
   widen it to accept another field. `parseStrikes` rejects rather than coerces:
   bare `Number()` maps `null`/`false`/`""`/`[]` to 0 (silently CLEARING a
   conduct record) and `true` to 1.

1e. **The client MIRRORS the hours rule; the server OWNS it.** `deriveHours` /
   `hoursBetweenIso` / `creditedHoursFor` in `client/src/utils.ts` are a faithful
   copy of `server/src/hours.js`. They fill the "Hours (auto)" field while an
   admin types check-in/out times, and the event page's Hours column, straight
   from the timestamps. DISPLAY only — nothing is posted back; the server
   re-derives on save. If you change the rule (rounding, the cap, the officer
   exemption) change BOTH: `client/src/utils.test.ts` pins the same cases as
   `server/test/hours.test.js` precisely so a drift fails the bar instead of
   promising an admin one number and crediting another.

1f. **Badges are labels, never permissions.** `client/src/badges.ts` holds the
   hard-coded TC Academy list; `VolunteerBadges` (components/RoleBadge.tsx)
   renders Officer + TC Academy together everywhere a name appears — roster,
   Volunteers tab, watchlist, event attendance. The Officer badge reflects
   `volunteers.role`, which really does lift the hours cap; TC Academy affects
   nothing at all, so never feed it into a calculation or a guard. Names match
   normalized (trim / collapse inner space / case-fold) and an entry may carry
   `alsoSpelled` variants — the roster says "Issac Cao", the chapter writes
   "Isaac", and both must badge. A name matching nobody is a SILENT no-op, which
   is why `tcAcademyNamesMissingFrom` surfaces it as an amber note in the
   Volunteers panel. `VolunteerBadges` returns a fragment so the badges are
   direct flex children of the caller's name row; that is what keeps
   name-to-badge and badge-to-badge spacing identical and lets a second badge
   wrap rather than widen the column.

2. **Deleting an event (or removing a volunteer from one) deletes the derived
   submissions** so no orphaned "pending" rows linger in the roster.
   `submissions.event_id` has **no foreign key**; `deleteEvent` deletes the
   submissions explicitly (and `removeAttendance` reconciles the one row).
3. **The Postgres and in-memory stores must stay behaviorally identical.** The
   shared suite (`server/test/suite.js`) runs against both. Any change to one
   store must be mirrored in the other and covered by the suite.
4. **Dates/times are TEXT** (`YYYY-MM-DD`, `HH:MM`), never Postgres `date`/`time`
   (driver tz-shifts them). Timestamps (`checkin_at`, etc.) are `timestamptz`,
   mapped to ISO strings.
5. **Public endpoints must not leak PII or QR codes.** `GET /roster` returns names +
   grade only. `GET /events` strips `code`/`volunteerId`/`checkinAt`/`checkoutAt`
   from attendance for non-admins (`publicEvent` in routes.js). The QR payload
   (`qr.ts`) encodes only `{t,v,id,code,name}` — never email/phone/custom fields.
6. **Volunteer codes come from a Postgres sequence** (`volunteer_code_seq`); seeding
   runs once, guarded by a transaction-scoped advisory lock.
7. **There are TWO accounts, and the officer one is door-duty-only.**
   `server/src/accounts.js` holds both passcodes (admin `0314`, officer `1013`) —
   deploy configuration no longer supplies them, and a stale `ADMIN_PASSWORD` in
   an environment is deliberately ignored, so every deployment signs in the same
   way. `/login` returns `{token, role}`; the two tokens are HMACs with distinct
   derivation prefixes and can never collide.
   - `requireAdmin` guards everything; `requireScanner` (admin OR officer) guards
     ONLY the three door-duty routes: `POST /events/:id/checkin|checkout` and
     `PATCH /events/:id/attendance/strikes`. Each is deliberately narrow — the
     scan writes a timestamp, the strike writes one integer — so the officer
     boundary is structural rather than a per-field allowlist. The general
     `PATCH /events/:id/attendance` stays admin-only and still accepts `strikes`
     for admins; do NOT relax it to serve officers, or a forged `checkinAt`
     rides in beside the strike. An officer hitting an admin route
     gets **403**, never 401 — the client clears its token on a 401, and signing
     an officer out mid-event over a blocked action would be worse than the
     action it blocked.
   - Officers never receive QR codes, volunteer ids or contact details:
     `officerEvent` / `officerAttendance` / `officerVolunteer` project every
     response they can reach — including the event a strike returns. They see
     check-in/out TIMES (they run the door).
   - The UI mirrors this (event page with only the Strike column live,
     camera-only scanner, no Volunteers tab) but is not the enforcement — the
     server is. `EventDetailPage` keeps `readOnly` (no admin editing) separate
     from `canRecordStrikes` for exactly that reason. Any new mutating route
     must be added under `requireAdmin` unless door staff genuinely need it, and
     the shared suite's "an officer CAN/CANNOT …" tests are where that gets
     proved.
   - `adminEnabled: false` remains as a kill switch: nobody can sign in and every
     privileged route returns 503, while public reads keep working.

## Tests & the green bar

```bash
npm test                 # server (in-memory suite) + client (vitest)
npm run build --prefix client   # tsc -b && vite build
```

- `server/test/suite.js` — the shared behavioral suite (run against both stores).
  Fixture names are derived from `SEED_VOLUNTEERS` (`V1`/`V2`), so editing the
  roster never breaks it.
- `server/test/hours.test.js` — pure unit tests for the hours-derivation helpers
  (0.25h rounding, `isComplete` decoupling, `localHHMM` timezone/DST edge cases).
- `server/test/routes.test.js` — runs the suite on the in-memory store + a
  fail-closed-admin test.
- `server/test/store-parity.test.js` — runs the SAME suite against **live
  Postgres**, gated on `TEST_DATABASE_URL` (separate from `DATABASE_URL` so a
  normal `npm test` never touches a real DB). Every test truncates all tables
  (markers included) and boots a FRESH store, so each one re-runs the real cold
  start: DDL + seed + data migrations. Also holds the Postgres-only migration
  tests (marker guards, archive-before-purge).
- Client: `client/src/{utils,qr,volunteerExports,badges}.test.ts` — incl. the
  roster==volunteers guard, strike aggregation, event grouping, the saved
  section order (`sortEventGroups` / `moveItem`), `isCollapsibleGroup`, the
  TC Academy badge list (+ its missing-name check) and the hours mirror, whose
  cases deliberately duplicate `server/test/hours.test.js`.

**MANDATORY pre-deploy gate:** the default `npm test` is memory-only. Because the
production data layer is Postgres, run the parity suite before every deploy.
The easiest and safest target is the bundled LOCAL throwaway stack (a
`postgres:17` container behind a Neon-HTTP proxy — the driver speaks Neon's
SQL-over-HTTP, not the Postgres wire protocol, so the proxy is required):

```bash
cd server && docker compose -f test/docker-compose.parity.yml up -d
TEST_DATABASE_URL='postgres://postgres:postgres@db.localtest.me:5432/scratchdb' \
  TEST_NEON_HTTP_PROXY=1 npm test
docker compose -f test/docker-compose.parity.yml down -v
```

A dedicated throwaway Neon branch works too:

```bash
cd server && TEST_DATABASE_URL='postgres://…-test…/scratchdb' npm test
```

The parity suite TRUNCATEs every table before each test, so it is **guarded**: it
refuses to run when `TEST_DATABASE_URL` equals `DATABASE_URL`, or when the URL has
no `test|throwaway|scratch|ephemeral|staging|local|dev` marker (override only with
`CONFIRM_TRUNCATE=1` if you are certain). There is no CI yet; treat this parity run
as a required manual gate (a SQL typo in `store-postgres.js` passes the memory-only
bar but breaks prod).

## Durability — NEVER wipe production

**As of 2026-08-01 prod holds REAL data** (48 volunteers, 745.25 hrs, 13 historical
+ 1 future event) — the one-time dummy→real go-live import is DONE. From here it is
the single source of truth, updated ONLY via the admin UI or a careful assisted
change. **Production is never "reset to pristine."** Do NOT run the parity suite,
`npm run reset`, `POST /api/admin/reset`, or a replace-all `POST /api/admin/import`
against the prod database. (Real data was lost once this way.) The `client/`-side
`seed-volunteers.js` reflects the real roster but only seeds a FRESH/empty DB — it
never touches prod (the table is non-empty). Safeguards now in place:

- **Fail-closed store** (`create-store.js`): in a prod-like env
  (`NETLIFY`/`AWS_LAMBDA_FUNCTION_NAME`/`NODE_ENV=production`) with no DB URL it
  THROWS instead of silently using the ephemeral in-memory store; `api.mjs` returns
  503 rather than serving RAM. It resolves the URL from `DATABASE_URL ||
  NETLIFY_DATABASE_URL || DATABASE_URL_UNPOOLED || NETLIFY_DATABASE_URL_UNPOOLED`.
- **`GET /api/health`** returns `{ ok, backend, persistent, dbOk }` with a live DB
  probe. `persistent:false` (in-memory) ⇒ a non-durable deploy — alert on it.
- **`importAll` is non-destructive by category:** only wipes+replaces the tables
  present in the payload (a volunteers-only import preserves events/hours).
- **Reset is confirmation-gated:** `reset.js` needs `CONFIRM_RESET=1`;
  `/api/admin/reset` needs `{"confirm":"RESET"}`.

## Deploy

- **Netlify** (primary): push to `main` → auto-build. Requires `DATABASE_URL` (or
  `NETLIFY_DATABASE_URL`) in Site config → Environment variables, scoped to
  **all** deploy contexts (Production + Deploy Previews + Branch deploys) so
  preview URLs don't run in-memory. Sign-in needs no environment variable (see
  invariant 7) — a leftover `ADMIN_PASSWORD` there is ignored. The function
  creates the schema + seeds the roster on first request.
- **Post-deploy smoke check:** `curl https://<site>/api/health` → expect
  `{"backend":"postgres","persistent":true,"dbOk":true}`.
- **EC2**: `npm run build` then `npm start` with the same env var. `cd server &&
  npm run migrate` pre-creates the schema; `CONFIRM_RESET=1 npm run reset` clears
  events/attendance/submissions but keeps the roster (backup written first).
- **Data migration** from an old file/Blobs backup: `POST /api/admin/import`
  (admin) with `{ events, submissions, volunteers? }`.

## Conventions

- Match existing patterns. Server is ESM Node; client is TS + React.
- Never commit secrets — `DATABASE_URL` comes from env; `.env` is git-ignored.
