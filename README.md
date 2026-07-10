# ELA TCYA Volunteer Service Hours

A modern web app for the **East Los Angeles Tzu Chi Youth Association** to
manage volunteers, hand out personal **QR "ID cards"**, **scan volunteers in and
out of events** with a phone camera, and track cumulative service hours.

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: Node.js + Express (shared route layer)
- **Database**: **Postgres (Neon)** — one source of truth for volunteers,
  events, attendance, and submissions, shared across all deployments.
- **Hosting options**: Netlify (serverless function + CDN) **or** AWS EC2 —
  both talk to the same Neon database via `DATABASE_URL`.
- **Branding**: Tzu Chi-inspired navy palette with warm gold accents.

> **Note on branding**: The header logo is `client/public/tzu-chi-logo.png`.
> Replace that file to swap it.

## Features

**Public (no login required)**

- Hero dashboard with total confirmed hours and active volunteers.
- Alphabetical volunteer roster — click a name to see every confirmed log.
- One-click **Download Excel Report** and per-volunteer / per-event
  **certificate PDFs**.
- Auto-refreshes when the tab regains focus.

**Admin (login required)** — a sticky tab bar switches between **Roster ·
Volunteers · Events** so nothing needs scrolling.

- **Volunteers panel** — the heart of the QR feature:
  - Add / edit / delete volunteers. Each gets a unique code (`TCYA-0001`, …).
  - Store name, email, phone, grade, and any number of **custom fields**
    ("T-shirt size", "Guardian", "Allergies", …) — think of it as an ID card.
  - **QR ID Card** modal per volunteer: view the QR, **Copy image** to
    clipboard, **Download PNG**, **ID card PDF**, or **Email** (opens a
    pre-filled draft) — an easy way for staff to send each volunteer their code.
  - Bulk **QR ID Cards (PDF)** — a printable sheet of every volunteer's card —
    and **Export Roster (Excel)** (contact info + QR payload text).
- **Events panel** — create events, manage attendance.
- **Event Detail** page:
  - **Scan QR** — open the phone camera and scan volunteers' QR codes to
    **check them in** (records a check-in time) or **check them out** (records a
    check-out time). Continuous scanning with a duplicate-scan guard, an audible
    beep, live feedback, and a manual code / volunteer fallback if the camera
    isn't available.
  - Attendance table shows each volunteer's code, check-in time, and check-out
    time. **Edit the times manually** any time.
  - Pre-register volunteers from the picker, or just scan them in on the day.
- **Service hours are derived from the check-in / check-out times**
  (hours = checkout − checkin). There is no separate "log hours" form.
- Admin data tools: `POST /api/admin/reset` (clears events + hours, keeps the
  roster), `GET /api/admin/export` (full backup JSON), and `POST /api/admin/import`
  (restore / migrate — see below).

## How the QR check-in flow works

1. **Admin adds volunteers** (or the seeded roster is used) — each gets a code.
2. **Admin sends each volunteer their QR** (copy/download/email from the QR
   modal, or hand out the bulk PDF).
3. **Admin creates an event.**
4. **At the event, staff open the event → Scan QR** and scan each volunteer's
   phone: "Check In" stamps a check-in time, "Check Out" stamps a check-out
   time (or set them by hand on the attendance table).
5. **Once a volunteer has both a check-in and a check-out time, their hours for
   that event = checkout − checkin** and appear on the roster automatically.

## The database (Neon Postgres)

All app data lives in Postgres. The schema (see `server/src/db/schema.js`):

| Table | Purpose |
|---|---|
| `volunteers` | id, **code** (`TCYA-####`, from a sequence), name, email, phone, grade, `custom_fields` (JSONB), timestamps |
| `events` | id, name, custom_name, date (`YYYY-MM-DD` text), created_at |
| `attendance` | event_id (FK, cascades on event delete), volunteer_id (FK, set null on volunteer delete), volunteer_name, staff_checkin + `checkin_at`, volunteer_checkout + `checkout_at`, self_added |
| `submissions` | a read-only projection of complete attendance (one per volunteer per event with both times): id, event_id (**no FK**; deleted explicitly on event delete), volunteer_name, grade, event/date snapshot, sign-in/out HH:MM, hours, submitted_at |

Design choices that keep behavior correct:

- **Dates/times are TEXT** (`YYYY-MM-DD`, `HH:MM`) — a Postgres `date` column is
  parsed to a UTC-midnight `Date` and shifts a day in US timezones. Text keeps
  the exact string identity the app compares on.
- **`submissions.event_id` has no foreign key.** Deleting an event must leave
  its submissions in place but stop them counting (their event lookup fails).
- **Volunteer codes come from a sequence**, so concurrent inserts never collide.
- **Check-in / check-out are atomic upserts** (`INSERT … ON CONFLICT DO UPDATE`),
  so a check-in rush from multiple devices can't lose an update.
- Storage sits behind a small **Store interface** with a Postgres implementation
  (`store-postgres.js`) and an in-memory reference (`store-memory.js`) kept in
  lock-step by a shared test suite.

On first boot the schema is created (idempotent `CREATE … IF NOT EXISTS`) and
the roster is seeded once from `server/src/data/seed-volunteers.js` (guarded by a
transaction-scoped advisory lock so concurrent cold starts never double-seed).
Editing the seed list later does **not** change existing rows — add volunteers
through the admin UI.

## Configuration (environment variables)

| Key | Purpose |
|---|---|
| `DATABASE_URL` | **Neon (or any Postgres) connection string.** When set, the app uses Postgres. When absent, it falls back to an **in-memory** store (fine for a quick local run / tests, but **not persisted**). |
| `ADMIN_USERNAME` | Admin login (default `admin`). |
| `ADMIN_PASSWORD` | Admin login (default `1013` — change for production). |
| `SESSION_SECRET` | Optional; signs admin tokens. Defaults to a value derived from the credentials. |

Get a `DATABASE_URL` from the [Neon console](https://console.neon.tech) →
your project → **Connection string** (use the pooled `-pooler` host). Never
commit it — it's read from the environment only, and `.env` is git-ignored.

## Local development

```bash
npm run install:all

# terminal 1 — API on :4000 (set DATABASE_URL to use Neon; omit for in-memory)
DATABASE_URL='postgres://…' npm run dev:server

# terminal 2 — Vite dev server on :5173 (proxies /api to :4000)
npm run dev:client
```

Open http://localhost:5173 . The camera scanner needs a secure context; it works
on `localhost` and on any `https` deployment (its manual fallback works anywhere).

Initialize / seed the database once (optional — the app also does this lazily):

```bash
cd server && DATABASE_URL='postgres://…' npm run migrate
```

## Deploy to Netlify (recommended)

1. Push this repo to GitHub and import it in Netlify. `netlify.toml` provides the
   build command, publish dir, and the `/api/*` → function redirect.
2. **Site configuration → Environment variables**, set:
   - `DATABASE_URL` = your Neon connection string
   - `ADMIN_USERNAME`, `ADMIN_PASSWORD` (and optionally `SESSION_SECRET`)
3. Deploy. The function connects to Neon over HTTP (no persistent pool), creates
   the schema and seeds the roster on first request.

## Deploy to EC2

Same as before, but set `DATABASE_URL` (and admin vars) in the systemd unit /
PM2 env. Express serves both the API and the built client on one port. Run
`cd server && npm run migrate` once (optional) to pre-create the schema.

## Migrating existing data into Neon

If you have data in the old file/Blobs backend, export it from the old deploy
(`GET /api/admin/export` while logged in as admin, or `netlify blobs:get
volunteer-data main`) and import it into the new Neon-backed deploy:

```bash
curl -X POST https://your-site/api/admin/import \
  -H "X-Admin-Token: <admin-token-from-localStorage>" \
  -H "Content-Type: application/json" \
  --data @backup.json
```

Import accepts `{ events, submissions, volunteers? }`, dedupes submissions per
(event, volunteer), rebuilds attendance from each event's `attendance` array,
and links names to the seeded roster. Volunteers are optional — omit them to
keep the seeded roster.

## Backups & reset

- **Backup**: `GET /api/admin/export` (admin) downloads the full data as JSON.
- **Reset for a new cycle**: `POST /api/admin/reset` (admin) or
  `cd server && npm run reset` — clears events, attendance, and submissions but
  **keeps the volunteer roster and their QR codes**.

## Project layout

```
client/                         React + TS app (Vite)
  src/
    components/                 Header, VolunteerTable, SubmissionForm, ExportButton…
      admin/                    EventsPanel, EventDetailPage, CreateEventModal,
                                VolunteersPanel, VolunteerFormModal, VolunteerQRModal,
                                ScannerModal
    qr.ts                       QR payload build/parse + image rendering
    volunteerExports.ts         Bulk QR ID-card PDF + roster Excel
    api.ts / types.ts / utils.ts
server/
  src/
    routes.js                   Shared Express router (used by both deployments)
    db/
      schema.js                 Postgres DDL + seed helpers
      store-postgres.js         Postgres implementation of the Store
      store-memory.js           In-memory reference implementation (+ dev fallback)
      create-store.js           Picks the backend from DATABASE_URL
    data/seed-volunteers.js     Initial roster (seeded once)
    index.js                    EC2 entry (serves /api + built client)
    migrate.js / reset.js       CLI: init schema+seed / clear a cycle
  test/
    suite.js                    Shared behavioral suite (both backends)
    routes.test.js              Runs the suite against the in-memory store
    store-parity.test.js        Runs the SAME suite against live Postgres (TEST_DATABASE_URL)
netlify/functions/api/api.mjs   Netlify Function entry (wraps Express)
netlify.toml                    Build + /api/* redirect
```

## Tests

```bash
npm test                 # server (in-memory suite) + client (vitest)
```

To prove the Postgres store matches the reference against a **throwaway**
database (each test truncates + reseeds it):

```bash
cd server && TEST_DATABASE_URL='postgres://throwaway…' npm test
```

`TEST_DATABASE_URL` is deliberately separate from `DATABASE_URL` so a normal
`npm test` never touches a real database.
