import type { Submission, VolunteerEvent } from "./types";

// Today's date as a local YYYY-MM-DD. Using `new Date().toISOString()` would
// yield the UTC date, which is already "tomorrow" for US timezones in the
// evening — that mis-labels a same-day event as "Past" and defaults new-event
// forms to the wrong day. Event dates are local calendar dates, so compare
// against the local date.
export function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatHours(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value.toFixed(2).replace(/\.00$/, "").replace(/(\.[1-9])0$/, "$1");
}

export function displayEventName(s: Submission): string {
  if (s.customEventName && s.customEventName.length > 0) {
    return s.customEventName;
  }
  return s.eventName;
}

export function formatDate(date: string): string {
  if (!date) return "";
  // Parse as a local date so the display doesn't shift by a day in some
  // timezones (which `new Date("2025-01-15")` would otherwise do).
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const parsed = new Date(y, m - 1, d);
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateLong(date: string): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const parsed = new Date(y, m - 1, d);
  return parsed.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatTime12h(hhmm: string): string {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return hhmm;
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// ---------- Check-in / check-out timestamp helpers (ISO <-> local) ----------

// A short local clock time, e.g. "3:45 PM", from an ISO timestamp.
export function formatClockFromIso(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

// ISO -> value for <input type="datetime-local"> (local 'YYYY-MM-DDTHH:MM').
export function isoToLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate()
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// <input type="datetime-local"> value (local) -> ISO string (or null if blank).
export function localInputToIso(val: string): string | null {
  if (!val) return null;
  const d = new Date(val); // parsed as local time
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// A submission's hours only count when:
//   - the event still exists, AND
//   - the volunteer's attendance row has BOTH staff check-in and volunteer
//     check-out marked green.
// Legacy submissions (no eventId, kept for migration safety) count by default.
export function isCountableSubmission(
  s: Submission,
  events: VolunteerEvent[]
): boolean {
  if (!s.eventId) return true;
  const event = events.find((e) => e.id === s.eventId);
  if (!event) return false;
  const att = (event.attendance || []).find(
    (a) => a.volunteerName === s.volunteerName
  );
  if (!att) return false;
  return Boolean(att.staffCheckin && att.volunteerCheckout);
}

export function getEventDisplayName(event: VolunteerEvent): string {
  return event.customName ? event.customName : event.name;
}

export interface VolunteerSummary {
  name: string;
  latestGrade: string;
  totalHours: number;
  // Only the submissions that count toward the volunteer's hours (both
  // check-ins are green). The expanded row only shows these.
  submissions: Submission[];
  // Total submissions including pending ones, useful as a UI hint.
  pendingCount: number;
}

// Collapse a volunteer's submissions to one per event (keeping the most
// recently submitted), so duplicate submissions for the same event never
// double-count. This is the read-side guard that mirrors the server's upsert:
// even if legacy duplicate rows exist in storage (from before the upsert was
// added), the displayed / exported / certified hours stay correct. The
// attendance list holds a single row per volunteer per event, so a volunteer's
// hours for one event are always a single logical entry. Rows without an
// eventId (legacy, pre-event-model) are kept as-is.
export function dedupeSubmissionsByEvent(subs: Submission[]): Submission[] {
  const byEvent = new Map<string, Submission>();
  const noEvent: Submission[] = [];
  for (const s of subs) {
    if (!s.eventId) {
      noEvent.push(s);
      continue;
    }
    const cur = byEvent.get(s.eventId);
    if (!cur || (s.submittedAt || "") > (cur.submittedAt || "")) {
      byEvent.set(s.eventId, s);
    }
  }
  return [...byEvent.values(), ...noEvent];
}

export function buildSummaries(
  volunteerNames: readonly string[],
  submissions: Submission[],
  events: VolunteerEvent[]
): VolunteerSummary[] {
  const allByName = new Map<string, Submission[]>();
  for (const name of volunteerNames) allByName.set(name, []);
  for (const s of submissions) {
    if (!allByName.has(s.volunteerName)) allByName.set(s.volunteerName, []);
    allByName.get(s.volunteerName)!.push(s);
  }

  const summaries: VolunteerSummary[] = [];
  for (const [name, rawItems] of allByName.entries()) {
    const items = dedupeSubmissionsByEvent(rawItems);
    const counted = items
      .filter((s) => isCountableSubmission(s, events))
      .sort((a, b) =>
        a.eventDate < b.eventDate ? 1 : a.eventDate > b.eventDate ? -1 : 0
      );
    const totalHours =
      Math.round(counted.reduce((sum, s) => sum + (s.hours || 0), 0) * 100) /
      100;
    const latestGrade =
      counted.length > 0 ? counted[0].grade : items[0]?.grade ?? "—";
    const pendingCount = items.length - counted.length;
    summaries.push({
      name,
      latestGrade,
      totalHours,
      submissions: counted,
      pendingCount,
    });
  }

  summaries.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
  return summaries;
}

// Sort attendance: admin-added rows first (alphabetical), self-added rows last
// (alphabetical within their group), so volunteers who submitted without
// being pre-added are visually separated.
export function sortAttendance(event: VolunteerEvent): {
  staff: VolunteerEvent["attendance"];
  selfAdded: VolunteerEvent["attendance"];
} {
  const all = [...(event.attendance || [])];
  const staff = all
    .filter((a) => !a.selfAdded)
    .sort((a, b) =>
      a.volunteerName.localeCompare(b.volunteerName, undefined, {
        sensitivity: "base",
      })
    );
  const selfAdded = all
    .filter((a) => a.selfAdded)
    .sort((a, b) =>
      a.volunteerName.localeCompare(b.volunteerName, undefined, {
        sensitivity: "base",
      })
    );
  return { staff, selfAdded };
}
