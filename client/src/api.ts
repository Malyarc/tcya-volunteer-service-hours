import type {
  AccountRole,
  AuditEntry,
  Submission,
  VolunteerEvent,
  NewEvent,
  EventPatch,
  EventOrderEntry,
  Volunteer,
  NewVolunteer,
  VolunteerPatch,
  RosterEntry,
  ScanResult,
} from "./types";
import { clearSession, getAdminToken } from "./auth";

const API_BASE = "/api";

function headers(json: boolean = false): HeadersInit {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  const token = getAdminToken();
  if (token) h["X-Admin-Token"] = token;
  return h;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    if (res.status === 401) {
      // The token is gone or invalid — clear so the UI re-prompts for login.
      // A 403 is deliberately NOT treated this way: that is a signed-in officer
      // touching an admin-only route, and signing them out mid-event over it
      // would be worse than the (already prevented) action they attempted.
      clearSession();
    }
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const data = await res.json();
      if (Array.isArray(data?.errors)) message = data.errors.join(", ");
      else if (data?.error) message = data.error;
      if (typeof data?.code === "string") code = data.code;
    } catch {
      // ignore parse errors
    }
    const err = new Error(message) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = code;
    throw err;
  }
  return res.json();
}

// ---------- Auth ----------

// Sign in as one of the chapter's two accounts. The server decides the role
// from the credentials and echoes it back; we never infer it client-side.
export async function login(
  role: AccountRole,
  password: string
): Promise<{ token: string; role: AccountRole }> {
  const res = await fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: role, password }),
  });
  const data = await handle<{ token: string; role?: AccountRole }>(res);
  return { token: data.token, role: data.role === "officer" ? "officer" : "admin" };
}

// Result of probing what the stored token actually is, server-side.
//  - "admin" / "officer" → confirmed session of that kind
//  - null                → confirmed signed OUT → safe to drop the session
//  - "unknown"           → transient failure (5xx cold start, network blip) →
//    do NOT sign out; keep the session and try again later. Treating a
//    transient blip as "logged out" is what makes a healthy app look "wiped."
export async function checkSession(): Promise<AccountRole | null | "unknown"> {
  try {
    const res = await fetch(`${API_BASE}/session`, {
      headers: headers(),
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) return "unknown";
    const data = (await res.json()) as { role?: AccountRole | null; admin?: boolean };
    if (data.role === "admin" || data.role === "officer") return data.role;
    // Fall back to the pre-officer response shape.
    return data.admin ? "admin" : null;
  } catch {
    return "unknown";
  }
}

// ---------- Roster (public, names + grade only) ----------

export async function fetchRoster(): Promise<RosterEntry[]> {
  const res = await fetch(`${API_BASE}/roster`, {
    cache: "no-store",
    headers: headers(),
  });
  return handle<RosterEntry[]>(res);
}

// ---------- Volunteers (admin) ----------

export async function fetchVolunteers(): Promise<Volunteer[]> {
  const res = await fetch(`${API_BASE}/volunteers`, {
    cache: "no-store",
    headers: headers(),
  });
  return handle<Volunteer[]>(res);
}

export async function createVolunteer(
  payload: NewVolunteer,
  force = false
): Promise<Volunteer> {
  const res = await fetch(`${API_BASE}/volunteers`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify(force ? { ...payload, force: true } : payload),
  });
  return handle<Volunteer>(res);
}

export async function updateVolunteer(
  id: string,
  patch: VolunteerPatch
): Promise<Volunteer> {
  const res = await fetch(`${API_BASE}/volunteers/${id}`, {
    method: "PATCH",
    headers: headers(true),
    body: JSON.stringify(patch),
  });
  return handle<Volunteer>(res);
}

export async function deleteVolunteer(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/volunteers/${id}`, {
    method: "DELETE",
    headers: headers(),
  });
  await handle<{ ok: true }>(res);
}

// ---------- Submissions (read-only; derived from check-in/out times) ----------

export async function fetchSubmissions(): Promise<Submission[]> {
  const res = await fetch(`${API_BASE}/submissions`, {
    cache: "no-store",
    headers: headers(),
  });
  return handle<Submission[]>(res);
}

// ---------- Events ----------

export async function fetchEvents(): Promise<VolunteerEvent[]> {
  const res = await fetch(`${API_BASE}/events`, {
    cache: "no-store",
    headers: headers(),
  });
  return handle<VolunteerEvent[]>(res);
}

export async function createEvent(payload: NewEvent): Promise<VolunteerEvent> {
  const res = await fetch(`${API_BASE}/events`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify(payload),
  });
  return handle<VolunteerEvent>(res);
}

// Edit an event's name / date / times / expected hours. The server re-derives
// every volunteer's credited hours for the event afterwards.
export async function updateEvent(
  id: string,
  patch: EventPatch
): Promise<VolunteerEvent> {
  const res = await fetch(`${API_BASE}/events/${id}`, {
    method: "PATCH",
    headers: headers(true),
    body: JSON.stringify(patch),
  });
  return handle<VolunteerEvent>(res);
}

export async function deleteEvent(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/events/${id}`, {
    method: "DELETE",
    headers: headers(),
  });
  await handle<{ ok: true }>(res);
}

export async function addAttendees(
  eventId: string,
  volunteerNames: string[]
): Promise<VolunteerEvent> {
  const res = await fetch(`${API_BASE}/events/${eventId}/attendance`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ volunteerNames }),
  });
  return handle<VolunteerEvent>(res);
}

// Admin-only: the check marks and the hand-set times. Strikes are NOT here —
// they go through setAttendanceStrikes below, the one strike path both roles
// can use. (The server still accepts `strikes` on this route for admins; the
// client deliberately doesn't, so a strike never takes the branch an officer
// would get a 403 from.)
export async function patchAttendee(
  eventId: string,
  volunteerName: string,
  patch: {
    staffCheckin?: boolean;
    volunteerCheckout?: boolean;
    checkinAt?: string | null;
    checkoutAt?: string | null;
  }
): Promise<VolunteerEvent> {
  const res = await fetch(`${API_BASE}/events/${eventId}/attendance`, {
    method: "PATCH",
    headers: headers(true),
    body: JSON.stringify({ volunteerName, ...patch }),
  });
  return handle<VolunteerEvent>(res);
}

// Record (or clear) a conduct strike for one volunteer at one event.
//
// Its own endpoint, and the one BOTH roles use: officers may record strikes
// (they run the door and see the conduct) but nothing else on an attendance
// row, and the server enforces that by only exposing this narrow route to
// them. Routing admins through the same call means the officer path is the one
// exercised on every strike, not a rarely-trodden branch.
export async function setAttendanceStrikes(
  eventId: string,
  volunteerName: string,
  strikes: number
): Promise<VolunteerEvent> {
  const res = await fetch(`${API_BASE}/events/${eventId}/attendance/strikes`, {
    method: "PATCH",
    headers: headers(true),
    body: JSON.stringify({ volunteerName, strikes }),
  });
  return handle<VolunteerEvent>(res);
}

export async function removeAttendee(
  eventId: string,
  volunteerName: string
): Promise<VolunteerEvent> {
  const res = await fetch(`${API_BASE}/events/${eventId}/attendance`, {
    method: "DELETE",
    headers: headers(true),
    body: JSON.stringify({ volunteerName }),
  });
  return handle<VolunteerEvent>(res);
}

// ---------- Audit log (admin only) ----------

// Read the activity log. Every filter is optional; the server ignores an
// unrecognized action rather than erroring, so a stale filter degrades to
// "everything" instead of a broken page.
export async function fetchAudit(params: {
  volunteer?: string;
  actor?: AccountRole;
  action?: string;
  since?: string;
  limit?: number;
} = {}): Promise<AuditEntry[]> {
  const qs = new URLSearchParams();
  if (params.volunteer) qs.set("volunteer", params.volunteer);
  if (params.actor) qs.set("actor", params.actor);
  if (params.action) qs.set("action", params.action);
  if (params.since) qs.set("since", params.since);
  if (params.limit) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await fetch(`${API_BASE}/audit${suffix}`, {
    cache: "no-store",
    headers: headers(),
  });
  return handle<AuditEntry[]>(res);
}

// ---------- Events page order (one entry per event-type section) ----------

export async function fetchEventOrder(): Promise<EventOrderEntry[]> {
  const res = await fetch(`${API_BASE}/event-order`, {
    cache: "no-store",
    headers: headers(),
  });
  return handle<EventOrderEntry[]>(res);
}

// Persist the section order for EVERYONE (admin only). Send the full list of
// section names in the order they should appear; the server replaces the whole
// order, so names that no longer exist are pruned.
export async function saveEventOrder(
  names: string[]
): Promise<EventOrderEntry[]> {
  const res = await fetch(`${API_BASE}/event-order`, {
    method: "PUT",
    headers: headers(true),
    body: JSON.stringify({ names }),
  });
  return handle<EventOrderEntry[]>(res);
}

// ---------- QR check-in / check-out (admin + officer scanner) ----------

export async function checkInByCode(
  eventId: string,
  code: string
): Promise<ScanResult> {
  const res = await fetch(`${API_BASE}/events/${eventId}/checkin`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ code }),
  });
  return handle<ScanResult>(res);
}

export async function checkOutByCode(
  eventId: string,
  code: string
): Promise<ScanResult> {
  const res = await fetch(`${API_BASE}/events/${eventId}/checkout`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ code }),
  });
  return handle<ScanResult>(res);
}
