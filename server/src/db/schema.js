// Postgres schema for the volunteer tracker (Neon or any Postgres).
//
// Design notes that keep exact parity with the app's original JSON model:
//   - Calendar dates (event.date, submission.eventDate) are stored as TEXT
//     'YYYY-MM-DD', never as a `date` column. The neon/pg driver parses a
//     `date` into a JS Date at UTC-midnight, which shifts by a day in US
//     timezones — the very bug utils.ts already guards against. Text keeps the
//     string identity the whole app relies on (lexical date comparisons, etc.).
//   - Clock times (arrival/end) are TEXT 'HH:MM'.
//   - submissions.event_id is a plain uuid with NO foreign key: when an event
//     is deleted its submissions must remain but STOP counting toward hours
//     (they become orphans whose event lookup fails). A FK with ON DELETE SET
//     NULL would instead null the id and make them count as "legacy" rows —
//     the opposite of the intended behavior.
//   - attendance.event_id IS a FK with ON DELETE CASCADE: attendance lived
//     "inside" the event in the old model, so deleting the event removes it.
//   - Volunteer codes come from a SEQUENCE so concurrent inserts never collide
//     and codes read as friendly running numbers (TCYA-0001, TCYA-0002, …).

export const SCHEMA_STATEMENTS = [
  `CREATE SEQUENCE IF NOT EXISTS volunteer_code_seq`,

  `CREATE TABLE IF NOT EXISTS volunteers (
     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     code          text NOT NULL UNIQUE,
     name          text NOT NULL,
     email         text NOT NULL DEFAULT '',
     phone         text NOT NULL DEFAULT '',
     grade         text NOT NULL DEFAULT '',
     custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
     active        boolean NOT NULL DEFAULT true,
     created_at    timestamptz NOT NULL DEFAULT now(),
     updated_at    timestamptz NOT NULL DEFAULT now()
   )`,

  // `role` is 'volunteer' (default) or 'officer'; officers are exempt from the
  // per-event hours cap. ADD COLUMN keeps existing databases in sync.
  `ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'volunteer'`,

  `CREATE TABLE IF NOT EXISTS events (
     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     name        text NOT NULL,
     custom_name text,
     date        text NOT NULL,
     created_at  timestamptz NOT NULL DEFAULT now()
   )`,
  // Scheduling + the hours cap. start/end are TEXT 'HH:MM' for the same reason
  // dates are TEXT (the driver tz-shifts a real `time`), and are display-only —
  // credited hours still come from the volunteer's OWN check-in/out timestamps.
  // expected_hours is NULLABLE on purpose: NULL means "no cap set", which is
  // what every pre-existing event has, so adding this column cannot change a
  // single already-recorded hour.
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS start_time text NOT NULL DEFAULT ''`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS end_time text NOT NULL DEFAULT ''`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS expected_hours numeric`,

  `CREATE TABLE IF NOT EXISTS attendance (
     id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     seq                bigserial,
     event_id           uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
     volunteer_id       uuid REFERENCES volunteers(id) ON DELETE SET NULL,
     volunteer_name     text NOT NULL,
     staff_checkin      boolean NOT NULL DEFAULT false,
     checkin_at         timestamptz,
     volunteer_checkout boolean NOT NULL DEFAULT false,
     checkout_at        timestamptz,
     self_added         boolean NOT NULL DEFAULT false,
     created_at         timestamptz NOT NULL DEFAULT now(),
     UNIQUE (event_id, volunteer_name)
   )`,
  // `seq` gives a stable monotonic display order (matches the memory store's
  // insertion order) even when many rows share the same created_at from a
  // batch insert. ADD COLUMN keeps existing databases in sync.
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS seq bigserial`,
  // Conduct strikes recorded against this volunteer AT THIS EVENT, by an admin
  // or by the officer running the door. 0 = clean. Purely a human judgement
  // call; it never affects hours.
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS strikes integer NOT NULL DEFAULT 0`,

  `CREATE TABLE IF NOT EXISTS submissions (
     id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     event_id          uuid,
     volunteer_name    text NOT NULL,
     grade             text NOT NULL DEFAULT '',
     event_name        text NOT NULL DEFAULT '',
     custom_event_name text,
     event_date        text,
     arrival_time      text NOT NULL DEFAULT '',
     end_time          text NOT NULL DEFAULT '',
     hours             numeric NOT NULL DEFAULT 0,
     comments          text NOT NULL DEFAULT '',
     submitted_at      timestamptz NOT NULL DEFAULT now(),
     UNIQUE (event_id, volunteer_name)
   )`,

  // The UNCAPPED checkout−checkin span. `hours` is what the volunteer is
  // credited (capped for non-officers); keeping the raw figure lets the UI
  // explain the difference instead of looking like a bug.
  `ALTER TABLE submissions ADD COLUMN IF NOT EXISTS raw_hours numeric`,

  // The Events page's section order. One row per event GROUP NAME (an event's
  // display name — its custom name for an "Others" event), holding the position
  // an admin dragged it to. Deliberately keyed by NAME, not by event id: the
  // page orders event TYPES, and a type outlives any one of its dates.
  // A name with no row here simply falls back to the automatic order, so this
  // table is optional data — losing it degrades to the previous behavior.
  `CREATE TABLE IF NOT EXISTS event_order (
     name     text PRIMARY KEY,
     position integer NOT NULL
   )`,

  // One-time data migrations that have already been applied (see
  // data-migrations.js). Presence of the row is the guard — a migration must
  // never re-run and undo an admin's later edit.
  `CREATE TABLE IF NOT EXISTS app_migrations (
     name       text PRIMARY KEY,
     applied_at timestamptz NOT NULL DEFAULT now()
   )`,

  // Rows a destructive migration removed, kept verbatim as JSON so any purge is
  // recoverable. Never read by the app — it exists purely so "delete" is not
  // one-way.
  `CREATE TABLE IF NOT EXISTS archived_records (
     id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     reason     text NOT NULL,
     payload    jsonb NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE INDEX IF NOT EXISTS attendance_event_idx ON attendance (event_id)`,
  `CREATE INDEX IF NOT EXISTS attendance_volunteer_idx ON attendance (volunteer_id)`,
  `CREATE INDEX IF NOT EXISTS submissions_event_idx ON submissions (event_id)`,
  `CREATE INDEX IF NOT EXISTS submissions_volunteer_idx ON submissions (volunteer_name)`,
  `CREATE INDEX IF NOT EXISTS volunteers_name_idx ON volunteers (lower(name))`,
  // Exact-name lookups (reconcile, addAttendees, attendance upserts run one on
  // every attendance mutation) can't use the lower(name) functional index.
  `CREATE INDEX IF NOT EXISTS volunteers_name_exact_idx ON volunteers (name)`,
];

// A stable, arbitrary key for the transaction-scoped advisory lock that
// serializes concurrent first-boot seeders (see seedVolunteers).
export const SEED_LOCK_KEY = 727401;

export function formatVolunteerCode(n) {
  return "TCYA-" + String(n).padStart(4, "0");
}

// Conduct strikes are whole, non-negative and bounded, so a typo or a hostile
// payload can't store an absurd value. Anything unparseable reads as 0 (=no
// strike) — failing to the harmless value for the person being judged.
export const MAX_STRIKES = 99;
export function normalizeStrikes(value) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_STRIKES);
}
