import type {
  NewSubmission,
  Submission,
  VolunteerEvent,
  NewEvent,
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
    try {
      const data = await res.json();
      if (Array.isArray(data?.errors)) message = data.errors.join(", ");
      else if (data?.error) message = data.error;
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }
  return res.json();
}

// ---------- Auth ----------

export async function adminLogin(password: string): Promise<string> {
  const res = await fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
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

// ---------- Submissions ----------

export async function fetchSubmissions(): Promise<Submission[]> {
  const res = await fetch(`${API_BASE}/submissions`, {
    cache: "no-store",
    headers: headers(),
  });
  return handle<Submission[]>(res);
}

export async function createSubmission(
  payload: NewSubmission
): Promise<Submission> {
  const res = await fetch(`${API_BASE}/submissions`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify(payload),
  });
  const data = await handle<{ submission: Submission }>(res);
  return data.submission;
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
  patch: { staffCheckin?: boolean; volunteerCheckout?: boolean }
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
