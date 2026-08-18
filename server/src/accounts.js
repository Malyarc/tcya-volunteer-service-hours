// The two sign-in accounts the chapter uses.
//
//   "admin"   — the chapter's staff account. Can do everything: create and edit
//               events, manage the volunteer roster, correct check-in/out times
//               by hand, record conduct strikes, export/import, reorder the
//               events page.
//
//   "officer" — a student leader running the door at an event. Can ONLY open an
//               event an admin already created and check volunteers in / out by
//               scanning their QR ID card. Officers cannot create or edit
//               events, cannot add or remove volunteers, cannot touch anyone's
//               hours or times by hand, and cannot record strikes. Their whole
//               capability is "stamp now() on a scanned volunteer's row".
//
// Note this is the LOGIN role, which is a different axis from a volunteer's
// role on the roster (`roles.js`, volunteer | officer, which governs the hours
// cap). Someone can be a roster officer without holding the officer passcode,
// and vice versa.
//
// The passcodes are chapter-shared 4-digit codes owned by the app itself rather
// than by deploy configuration: the chapter changes them here, in one place,
// and a redeploy is the rotation. See CLAUDE.md ("Accounts & passcodes") for
// why, and what that trade-off means.

export const ACCOUNT_ADMIN = "admin";
export const ACCOUNT_OFFICER = "officer";
export const ACCOUNT_ROLES = [ACCOUNT_ADMIN, ACCOUNT_OFFICER];

// The shipped credentials. `createRouter` takes them as parameters so the tests
// can drive it with their own, but every real entry point passes these.
export const ADMIN_USERNAME = "admin";
export const ADMIN_PASSWORD = "0314";
export const OFFICER_USERNAME = "officer";
export const OFFICER_PASSWORD = "1013";

// Normalize a role name off the wire. Anything unrecognized is NOT a role —
// failing closed, so a typo can never be read as "admin".
export function normalizeAccountRole(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return ACCOUNT_ROLES.includes(v) ? v : null;
}
