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

  `CREATE TABLE IF NOT EXISTS events (
     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     name        text NOT NULL,
     custom_name text,
     date        text NOT NULL,
     created_at  timestamptz NOT NULL DEFAULT now()
   )`,

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

  `CREATE INDEX IF NOT EXISTS attendance_event_idx ON attendance (event_id)`,
  `CREATE INDEX IF NOT EXISTS attendance_volunteer_idx ON attendance (volunteer_id)`,
  `CREATE INDEX IF NOT EXISTS submissions_event_idx ON submissions (event_id)`,
  `CREATE INDEX IF NOT EXISTS submissions_volunteer_idx ON submissions (volunteer_name)`,
  `CREATE INDEX IF NOT EXISTS volunteers_name_idx ON volunteers (lower(name))`,
];

// A stable, arbitrary key for the transaction-scoped advisory lock that
// serializes concurrent first-boot seeders (see seedVolunteers).
export const SEED_LOCK_KEY = 727401;

export function formatVolunteerCode(n) {
  return "TCYA-" + String(n).padStart(4, "0");
}
