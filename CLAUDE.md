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
- Frontend: `client/` (Vite + React + Tailwind). QR generation in `client/src/qr.ts`
  (payload) + `volunteerExports.ts` (bulk PDF/Excel). Scanner in
  `client/src/components/admin/ScannerModal.tsx`.

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
7. **Admin fails closed in production:** if `DATABASE_URL` is set (or
   `NODE_ENV=production`) and `ADMIN_PASSWORD` is unset, admin routes + `/login`
   return 503. Set `ADMIN_PASSWORD` (and ideally `SESSION_SECRET`) in prod.

## Tests & the green bar

```bash
npm test                 # server (in-memory suite) + client (vitest)
npm run build --prefix client   # tsc -b && vite build
```

- `server/test/suite.js` — the shared behavioral suite (run against both stores).
- `server/test/hours.test.js` — pure unit tests for the hours-derivation helpers
  (0.25h rounding, `isComplete` decoupling, `localHHMM` timezone/DST edge cases).
- `server/test/routes.test.js` — runs the suite on the in-memory store + a
  fail-closed-admin test.
- `server/test/store-parity.test.js` — runs the SAME suite against **live
  Postgres**, gated on `TEST_DATABASE_URL` (separate from `DATABASE_URL` so a
  normal `npm test` never touches a real DB).
- Client: `client/src/{utils,qr,volunteerExports}.test.ts`.

**MANDATORY pre-deploy gate:** the default `npm test` is memory-only. Because the
production data layer is Postgres, run the parity suite against a **dedicated
throwaway** Neon DB before every deploy:

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

**Production is the single source of truth and is never "reset to pristine."** Do
NOT run the parity suite, `npm run reset`, `POST /api/admin/reset`, or a
replace-all `POST /api/admin/import` against the prod database. (Real data was lost
once this way.) Safeguards now in place:

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
  `NETLIFY_DATABASE_URL`), `ADMIN_PASSWORD` (and ideally `SESSION_SECRET`) in Site
  config → Environment variables, scoped to **all** deploy contexts (Production +
  Deploy Previews + Branch deploys) so preview URLs don't run in-memory. The
  function creates the schema + seeds the roster on first request.
- **Post-deploy smoke check:** `curl https://<site>/api/health` → expect
  `{"backend":"postgres","persistent":true,"dbOk":true}`.
- **EC2**: `npm run build` then `npm start` with the same env vars. `cd server &&
  npm run migrate` pre-creates the schema; `CONFIRM_RESET=1 npm run reset` clears
  events/attendance/submissions but keeps the roster (backup written first).
- **Data migration** from an old file/Blobs backup: `POST /api/admin/import`
  (admin) with `{ events, submissions, volunteers? }`.

## Conventions

- Match existing patterns. Server is ESM Node; client is TS + React.
- Never commit secrets — `DATABASE_URL` comes from env; `.env` is git-ignored.
