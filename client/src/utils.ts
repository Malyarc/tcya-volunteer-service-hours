import type {
  RosterEntry,
  Submission,
  VolunteerEvent,
  VolunteerRole,
} from "./types";

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

// ---------- Derived hours, mirrored from the server ----------
//
// The SERVER owns hours: `server/src/hours.js` derives them from the check-in /
// check-out timestamps and stores them on the submission. These helpers are a
// faithful mirror of that rule, used ONLY to show the admin what a set of times
// will be worth BEFORE they save (and to fill the event page's Hours column
// straight from the timestamps, with no extra round-trip).
//
// They must stay byte-identical in behaviour to hours.js — `utils.test.ts` pins
// the same cases the server's `hours.test.js` pins. If you change one, change
// both, or the number the admin is shown stops matching the number that is
// actually credited.

// checkout − checkin in hours, rounded to the nearest quarter (the app's
// 15-minute granularity). 0 when either is missing or checkout is not after
// check-in. Mirrors hoursBetween().
export function hoursBetweenIso(
  checkinAt?: string | null,
  checkoutAt?: string | null
): number {
  if (!checkinAt || !checkoutAt) return 0;
  const ms = Date.parse(checkoutAt) - Date.parse(checkinAt);
  if (!(ms > 0)) return 0;
  return Math.round((ms / 3600000) * 4) / 4;
}

// Both timestamps set, checkout strictly after check-in. Deliberately SEPARATE
// from the rounded hours so a genuine but very short (< 7.5 min) shift still
// counts as complete service worth 0 hours, rather than vanishing. Mirrors
// isComplete().
export function isCompleteAttendance(
  checkinAt?: string | null,
  checkoutAt?: string | null
): boolean {
  if (!checkinAt || !checkoutAt) return false;
  return Date.parse(checkoutAt) > Date.parse(checkinAt);
}

// The hours a person is actually CREDITED: capped at the event's expected hours
// for ordinary volunteers, uncapped for officers, uncapped for everyone when
// the event sets no expected hours. Mirrors creditedHours().
export function creditedHoursFor(
  rawHours: number,
  expectedHours: number | null | undefined,
  role: VolunteerRole | undefined
): number {
  const raw = Number(rawHours) || 0;
  // Fail-closed exactly like the server: anything that is not explicitly
  // "officer" is an ordinary, capped volunteer.
  if (role === "officer") return raw;
  if (expectedHours === null || expectedHours === undefined) return raw;
  const cap = Number(expectedHours);
  if (!Number.isFinite(cap) || cap < 0) return raw;
  return Math.min(raw, Math.round(cap * 4) / 4);
}

// What one attendance row is worth, in the shape the UI needs.
//   complete — is this countable service at all (⇒ a submission exists)?
//   raw      — the full span between the two timestamps
//   credited — what actually counts, after the cap
//   capped   — the cap bit, so the UI can explain the difference instead of
//              looking like a rounding bug
export interface DerivedHours {
  complete: boolean;
  raw: number;
  credited: number;
  capped: boolean;
}

export function deriveHours(
  checkinAt: string | null | undefined,
  checkoutAt: string | null | undefined,
  expectedHours: number | null | undefined,
  role: VolunteerRole | undefined
): DerivedHours {
  const complete = isCompleteAttendance(checkinAt, checkoutAt);
  if (!complete) return { complete: false, raw: 0, credited: 0, capped: false };
  const raw = hoursBetweenIso(checkinAt, checkoutAt);
  const credited = creditedHoursFor(raw, expectedHours, role);
  return { complete: true, raw, credited, capped: credited < raw };
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

// The number of cumulative strikes at which a volunteer is surfaced on the
// admin watchlist. Three strikes is the chapter's threshold.
export const STRIKE_WATCHLIST_THRESHOLD = 3;

// One line in a volunteer's expanded roster row: an event they were credited
// hours for, an event where they picked up a strike, or both.
export interface VolunteerEventRow {
  key: string;
  eventId: string | null;
  eventDate: string;
  eventName: string;
  // null when the row exists only because of a strike (no countable hours yet).
  hours: number | null;
  strikes: number;
  submission: Submission | null;
}

export interface VolunteerSummary {
  name: string;
  latestGrade: string;
  role: VolunteerRole;
  totalHours: number;
  // Only the submissions that count toward the volunteer's hours (both
  // check-ins are green). The expanded row only shows these.
  submissions: Submission[];
  // Total submissions including pending ones, useful as a UI hint.
  pendingCount: number;
  // Cumulative strikes across every event.
  totalStrikes: number;
  // Every event worth showing in the expanded row — counted hours AND any event
  // carrying a strike, so a strike can never be invisible just because the
  // volunteer's hours for that event aren't complete.
  eventRows: VolunteerEventRow[];
}

// Strikes live on attendance (the source of truth), not on the derived
// submissions — so they survive an incomplete check-out and are still visible
// when no hours were credited.
export function buildStrikeIndex(
  events: VolunteerEvent[]
): Map<string, Map<string, number>> {
  const byName = new Map<string, Map<string, number>>();
  for (const e of events) {
    for (const a of e.attendance || []) {
      const n = a.strikes || 0;
      if (n <= 0) continue;
      let forVolunteer = byName.get(a.volunteerName);
      if (!forVolunteer) {
        forVolunteer = new Map();
        byName.set(a.volunteerName, forVolunteer);
      }
      forVolunteer.set(e.id, n);
    }
  }
  return byName;
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

// The roster IS the volunteer list.
//
// This function is deliberately roster-DRIVEN: a submission whose volunteerName
// has no roster entry is ignored entirely. Previously any leftover submission
// name (a former member whose volunteer record was deleted but whose hours
// stayed behind) silently appeared as an extra roster row, which is exactly how
// the Roster tab and the Volunteers tab drifted apart. Now they cannot: both are
// projections of the same `volunteers` table.
export function buildSummaries(
  roster: ReadonlyArray<RosterEntry>,
  submissions: Submission[],
  events: VolunteerEvent[]
): VolunteerSummary[] {
  const gradeByName = new Map<string, string>();
  const roleByName = new Map<string, VolunteerRole>();
  const allByName = new Map<string, Submission[]>();
  for (const r of roster) {
    allByName.set(r.name, []);
    if (r.grade) gradeByName.set(r.name, r.grade);
    roleByName.set(r.name, r.role === "officer" ? "officer" : "volunteer");
  }
  for (const s of submissions) {
    // Roster-only: no ghost rows. See the note above.
    const bucket = allByName.get(s.volunteerName);
    if (bucket) bucket.push(s);
  }

  const strikeIndex = buildStrikeIndex(events);
  const eventById = new Map(events.map((e) => [e.id, e]));

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
    // Prefer the volunteer's own (editable) grade; fall back to the grade on
    // their latest counted service, then any submission.
    const latestGrade =
      gradeByName.get(name) ||
      (counted.length > 0 ? counted[0].grade : items[0]?.grade) ||
      "—";
    // Pending = a submission that exists but doesn't count AND whose event still
    // exists (a deleted event's rows are cleaned up server-side, so they never
    // linger here).
    const pendingCount = items.filter(
      (s) =>
        s.eventId &&
        events.some((e) => e.id === s.eventId) &&
        !isCountableSubmission(s, events)
    ).length;

    const strikesForVolunteer = strikeIndex.get(name);
    const totalStrikes = strikesForVolunteer
      ? [...strikesForVolunteer.values()].reduce((a, b) => a + b, 0)
      : 0;

    // Rows = every counted event, PLUS any event carrying a strike that has no
    // counted submission (otherwise that strike would be invisible here).
    const eventRows: VolunteerEventRow[] = counted.map((s) => ({
      key: s.id,
      eventId: s.eventId || null,
      eventDate: s.eventDate,
      eventName: displayEventName(s),
      hours: s.hours || 0,
      strikes: (s.eventId && strikesForVolunteer?.get(s.eventId)) || 0,
      submission: s,
    }));
    if (strikesForVolunteer) {
      const covered = new Set(counted.map((s) => s.eventId));
      for (const [eventId, strikes] of strikesForVolunteer.entries()) {
        if (covered.has(eventId)) continue;
        const ev = eventById.get(eventId);
        if (!ev) continue;
        eventRows.push({
          key: `strike:${eventId}`,
          eventId,
          eventDate: ev.date,
          eventName: getEventDisplayName(ev),
          hours: null,
          strikes,
          submission: null,
        });
      }
    }
    eventRows.sort((a, b) =>
      a.eventDate < b.eventDate ? 1 : a.eventDate > b.eventDate ? -1 : 0
    );

    summaries.push({
      name,
      latestGrade,
      role: roleByName.get(name) || "volunteer",
      totalHours,
      submissions: counted,
      pendingCount,
      totalStrikes,
      eventRows,
    });
  }

  summaries.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
  return summaries;
}

// ---------- Events grouped by type (the Events page) ----------

export interface EventGroup {
  // The event's display name — the grouping identity. A custom "Others" event
  // gets its own group under its own name, so a new event type creates a new
  // section automatically.
  name: string;
  occurrences: VolunteerEvent[];
  totalOccurrences: number;
  totalAttendees: number;
  totalConfirmed: number;
  totalHours: number;
  upcomingCount: number;
  // Soonest upcoming date, else null.
  nextDate: string | null;
  // Most recent past date, else null.
  lastDate: string | null;
}

// Credited hours actually logged at one event, from the derived submissions.
export function eventHours(
  event: VolunteerEvent,
  submissions: Submission[],
  events: VolunteerEvent[]
): number {
  const total = submissions
    .filter((s) => s.eventId === event.id && isCountableSubmission(s, events))
    .reduce((sum, s) => sum + (s.hours || 0), 0);
  return Math.round(total * 100) / 100;
}

// Group events into one section per event type, each listing its dates.
//
// Ordering is chosen for an admin scanning the page: groups with something
// upcoming float to the top (soonest first) because those are the actionable
// ones; the rest follow by how recently they last ran. Within a group the same
// rule applies to the individual dates.
export function groupEventsByName(
  events: VolunteerEvent[],
  submissions: Submission[],
  today: string = todayYmd(),
  // The admin's saved section order (names, most-important first). Empty = use
  // the automatic order for everything.
  order: readonly string[] = []
): EventGroup[] {
  const byName = new Map<string, VolunteerEvent[]>();
  for (const e of events) {
    const key = getEventDisplayName(e);
    const list = byName.get(key);
    if (list) list.push(e);
    else byName.set(key, [e]);
  }

  const groups: EventGroup[] = [];
  for (const [name, listRaw] of byName.entries()) {
    const upcoming = listRaw
      .filter((e) => e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    const past = listRaw
      .filter((e) => e.date < today)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const occurrences = [...upcoming, ...past];
    groups.push({
      name,
      occurrences,
      totalOccurrences: occurrences.length,
      totalAttendees: occurrences.reduce((n, e) => n + (e.attendance?.length ?? 0), 0),
      totalConfirmed: occurrences.reduce(
        (n, e) =>
          n + (e.attendance?.filter((a) => a.staffCheckin && a.volunteerCheckout).length ?? 0),
        0
      ),
      totalHours:
        Math.round(
          occurrences.reduce((sum, e) => sum + eventHours(e, submissions, events), 0) * 100
        ) / 100,
      upcomingCount: upcoming.length,
      nextDate: upcoming[0]?.date ?? null,
      lastDate: past[0]?.date ?? null,
    });
  }

  return sortEventGroups(groups, order);
}

// The automatic order, used for any section the admin has NOT placed by hand:
// anything with an upcoming date floats to the top (soonest first) because
// those are the actionable ones; the rest follow by how recently they last ran.
export function compareEventGroupsAutomatically(
  a: EventGroup,
  b: EventGroup
): number {
  if (a.nextDate && b.nextDate) return a.nextDate.localeCompare(b.nextDate);
  if (a.nextDate) return -1;
  if (b.nextDate) return 1;
  return (b.lastDate || "").localeCompare(a.lastDate || "");
}

// Apply the admin's saved section order.
//
// Sections the admin placed come first, in exactly that order. Anything not in
// the saved order — a brand-new event type created after the last drag — keeps
// the automatic order and follows below, so a new event can never be hidden by
// a stale ordering. Returns a NEW array; the input is not mutated.
export function sortEventGroups(
  groups: EventGroup[],
  order: readonly string[] = []
): EventGroup[] {
  const rank = new Map<string, number>();
  order.forEach((name, i) => {
    if (!rank.has(name)) rank.set(name, i);
  });
  return [...groups].sort((a, b) => {
    const ra = rank.get(a.name);
    const rb = rank.get(b.name);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return compareEventGroupsAutomatically(a, b);
  });
}

// Does this Events page section need a dropdown at all?
//
// A section holding a single date has nothing to collapse — the chevron would
// hide one row and reveal one row — so it renders as a plain heading instead.
// Lives here, next to the grouping, so the page and its tests share one rule.
export function isCollapsibleGroup(group: EventGroup): boolean {
  return group.totalOccurrences > 1;
}

// Move one item to a new index, returning a new array. The shared primitive
// behind both the drag-and-drop and the up/down buttons on the Events page, so
// the two can never disagree. Out-of-range indices are clamped/ignored.
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  if (target === from) return next;
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
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
