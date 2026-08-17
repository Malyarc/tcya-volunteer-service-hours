// Volunteer roles.
//
// The chapter has exactly two kinds of people on the roster:
//
//   "volunteer" (default) — an ordinary student. Their credited service hours
//       for an event are capped at the event's Expected Volunteer Hours, so
//       showing up early (or forgetting to check out) can never earn more
//       credit than the event is actually worth.
//
//   "officer" — a student leader. Officers arrive before the event starts to
//       set up and stay after to clean up, and that time counts, so their hours
//       are NEVER capped: they get the full span between their own check-in and
//       check-out.
//
// Kept in its own module because both the storage layer (which derives hours)
// and the router (which validates the field) need it, and neither should have
// to import the other.

export const ROLE_VOLUNTEER = "volunteer";
export const ROLE_OFFICER = "officer";
export const VOLUNTEER_ROLES = [ROLE_VOLUNTEER, ROLE_OFFICER];

// Anything that isn't explicitly "officer" is an ordinary volunteer. Failing
// CLOSED this way means a corrupt/unknown role can only ever remove the cap
// exemption, never grant it.
export function normalizeRole(value) {
  return String(value ?? "").trim().toLowerCase() === ROLE_OFFICER
    ? ROLE_OFFICER
    : ROLE_VOLUNTEER;
}

export function isOfficerRole(value) {
  return normalizeRole(value) === ROLE_OFFICER;
}
