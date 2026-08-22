// The audit log's vocabulary — the one place that says what an action is
// CALLED, so the router, both stores and the client can never disagree.
//
// What the log is: an append-only record of every action a staff account took
// ON a volunteer. It is written after a mutation succeeds and is never read to
// make a decision — nothing in the app branches on it. That is deliberate: a
// log that feeds behaviour is state, and state gets "corrected".
//
// What the log is NOT: an identity trail. Both passcodes are chapter-shared
// (see accounts.js), so `actorRole` says an OFFICER did this, never which
// officer. Anywhere this is surfaced must say so rather than implying a name.

export const AUDIT_ACTIONS = {
  // Attendance — the check-in / check-out pair the chapter most wants to see.
  CHECKIN: "checkin",
  CHECKOUT: "checkout",
  CHECKIN_CLEARED: "checkin_cleared",
  CHECKOUT_CLEARED: "checkout_cleared",
  TIME_CORRECTED: "time_corrected",

  // Conduct.
  STRIKE_SET: "strike_set",

  // An event's attendance list.
  ATTENDEE_ADDED: "attendee_added",
  ATTENDEE_REMOVED: "attendee_removed",

  // The volunteer's own record.
  VOLUNTEER_CREATED: "volunteer_created",
  VOLUNTEER_UPDATED: "volunteer_updated",
  VOLUNTEER_DELETED: "volunteer_deleted",
};

const ALL_ACTIONS = new Set(Object.values(AUDIT_ACTIONS));

export function isAuditAction(value) {
  return ALL_ACTIONS.has(String(value ?? ""));
}

// How a check-in / check-out time came to be set. The chapter's question is
// usually "was this scanned at the door, or typed in afterwards?", so it is a
// first-class field rather than something buried in the details blob.
export const AUDIT_METHODS = {
  SCAN: "scan", // a QR code was scanned
  MANUAL: "manual", // a staff member set it by hand
};

// Normalize one entry on its way into a store. Everything is bounded and
// defaulted here so a store never has to trust its caller, and so the two
// stores cannot normalize differently.
export function normalizeAuditEntry(entry) {
  const e = entry || {};
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  return {
    at: normalizeIso(e.at) || new Date().toISOString(),
    actorRole: e.actorRole === "officer" ? "officer" : "admin",
    action: isAuditAction(e.action) ? e.action : "",
    volunteerName: str(e.volunteerName, 200),
    volunteerCode: str(e.volunteerCode, 60) || null,
    eventId: typeof e.eventId === "string" && e.eventId ? e.eventId : null,
    eventName: str(e.eventName, 200),
    eventDate: str(e.eventDate, 10),
    details: sanitizeDetails(e.details),
  };
}

function normalizeIso(v) {
  if (typeof v !== "string") return "";
  const t = Date.parse(v);
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}

// The details blob is written by us, not by a client, but it is bounded anyway
// so one malformed call can never store an unbounded document.
function sanitizeDetails(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out = {};
  let n = 0;
  for (const [k, val] of Object.entries(v)) {
    if (val === undefined || val === null) continue;
    const key = String(k).slice(0, 40);
    if (!key) continue;
    out[key] =
      typeof val === "number" || typeof val === "boolean"
        ? val
        : String(val).slice(0, 300);
    if (++n >= 20) break;
  }
  return out;
}

// A one-line, human-readable summary of an entry. Lives here, server-side, so
// an exported CSV and the on-screen log read identically — and so a future
// consumer (a digest email, a printout) never has to re-invent the wording.
export function describeAuditEntry(entry) {
  const e = entry || {};
  const who = e.volunteerName || "Someone";
  const d = e.details || {};
  switch (e.action) {
    case AUDIT_ACTIONS.CHECKIN:
      return `${who} checked in`;
    case AUDIT_ACTIONS.CHECKOUT:
      return `${who} checked out`;
    case AUDIT_ACTIONS.CHECKIN_CLEARED:
      return `${who}'s check-in was cleared`;
    case AUDIT_ACTIONS.CHECKOUT_CLEARED:
      return `${who}'s check-out was cleared`;
    case AUDIT_ACTIONS.TIME_CORRECTED:
      return `${who} had a time corrected`;
    case AUDIT_ACTIONS.STRIKE_SET:
      return Number(d.to) > Number(d.from)
        ? `${who} was given a strike`
        : `${who} had a strike cleared`;
    case AUDIT_ACTIONS.ATTENDEE_ADDED:
      return `${who} was added to the event`;
    case AUDIT_ACTIONS.ATTENDEE_REMOVED:
      return `${who} was removed from the event`;
    case AUDIT_ACTIONS.VOLUNTEER_CREATED:
      return `${who} was added to the roster`;
    case AUDIT_ACTIONS.VOLUNTEER_UPDATED:
      return `${who}'s record was edited`;
    case AUDIT_ACTIONS.VOLUNTEER_DELETED:
      return `${who} was removed from the roster`;
    default:
      return `${who} was updated`;
  }
}
