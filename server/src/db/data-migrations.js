// One-time, chapter-specific DATA migrations.
//
// Schema changes live in schema.js and are re-runnable by construction (CREATE
// / ALTER ... IF NOT EXISTS). The changes here rewrite ROWS, so each one is
// guarded by a marker in `app_migrations`: it applies exactly once per database
// and never again — otherwise a later admin edit (demoting an officer,
// re-adding a former member) would be silently undone on the next cold start.
//
// Both stores execute these, so the in-memory reference store and Postgres stay
// behaviorally identical (see the shared suite).

// Student leaders confirmed by the chapter on 2026-08-16. Matched on the EXACT
// roster name — a name that isn't on the roster is simply skipped, so this is
// safe against a fresh/partial database. Officers are exempt from the per-event
// hours cap (see roles.js).
export const OFFICER_NAMES = [
  "Amber Wang",
  "Amelia Lin",
  "Andrew Luo",
  "Clarissa Tran",
  "Dawson Thai",
  "Elise Hoang",
  "Evan Chen",
  "Issac Cao",
  "Jaden Liu (Gr.10)",
  "Jaden Liu (Gr.11)",
  "Summer (Xia Qiu)",
  "Ziming Liu",
];

// Former members who were removed from the roster but whose attendance rows and
// derived hours were left behind, so they still surfaced on the public roster
// (which is built from hours) while being absent from the admin Volunteers list
// — the exact Roster/Volunteers divergence the chapter asked us to end.
//
// Their records are ARCHIVED (verbatim JSON in `archived_records`) before being
// deleted, and only rows whose name has NO volunteer record are touched: if any
// of them is ever re-added to the roster, their new attendance is untouchable
// by this migration.
export const RETIRED_MEMBER_NAMES = [
  "Erika Hsieh",
  "Ethan de la Cruz",
  "Jocelin Wang",
  "Justin Lee",
  "Xiqiao Ma",
];

// Audit entries written against PRODUCTION while verifying the audit feature
// itself. The scratch events they refer to were created and deleted during that
// check, so these lines describe work nobody did on a real event — clutter in a
// log whose whole value is that everything in it is real.
//
// Matched on the event-name prefix the scratch events all carried. The audit
// table is otherwise append-only by design; this is the one sanctioned way to
// remove from it, and like every migration here it archives first and runs once.
export const TEST_AUDIT_EVENT_PREFIX = "ZZ TEMP";

export const MIGRATION_PROMOTE_OFFICERS = "2026-08-16-promote-officers";
export const MIGRATION_PURGE_RETIRED = "2026-08-16-purge-retired-member-records";
export const MIGRATION_PURGE_TEST_AUDIT =
  "2026-08-21-purge-verification-audit-entries";

export const ARCHIVE_REASON_TEST_AUDIT =
  "Audit entries created by scratch events while verifying the audit log " +
  "against production (migration " + MIGRATION_PURGE_TEST_AUDIT + ")";

export const ARCHIVE_REASON_RETIRED =
  "Attendance + derived hours of former members removed from the roster " +
  "(migration " + MIGRATION_PURGE_RETIRED + ")";

export const DATA_MIGRATION_NAMES = [
  MIGRATION_PROMOTE_OFFICERS,
  MIGRATION_PURGE_RETIRED,
  MIGRATION_PURGE_TEST_AUDIT,
];
