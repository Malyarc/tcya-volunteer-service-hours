import type {
  Submission,
  VolunteerEvent,
  NewEvent,
  Volunteer,
  NewVolunteer,
  VolunteerPatch,
  RosterEntry,
  ScanResult,
} from "./types";
import { clearAdminToken, getAdminToken } from "./auth";

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
      clearAdminToken();
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

export async function adminLogin(
  username: string,
  password: string
): Promise<string> {
  const res = await fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await handle<{ token: string }>(res);
  return data.token;
}

export async function checkAdminSession(): Promise<boolean> {
  const res = await fetch(`${API_BASE}/session`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { admin?: boolean };
  return Boolean(data.admin);
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

// ---------- QR check-in / check-out (admin scanner) ----------

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
