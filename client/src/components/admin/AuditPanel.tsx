import { useCallback, useEffect, useMemo, useState } from "react";
import type { AccountRole, AuditAction, AuditEntry, VolunteerEvent } from "../../types";
import { fetchAudit } from "../../api";
import {
  formatDate,
  formatHours,
  formatPacificDayLabel,
  formatPacificTime,
  formatTime12h,
  pacificAbbrev,
  pacificDayKey,
  pacificTodayKey,
} from "../../utils";
import { VolunteerBadges } from "../RoleBadge";

// How many entries one page of the log holds. The log grows forever, so it is
// always paged — "Load older" raises this rather than fetching everything.
const PAGE = 60;

// ---------------------------------------------------------------------------
// The action vocabulary. One place that says, for every action the server can
// record, what it looks like and how it reads. Adding an action server-side
// without adding it here falls back to a neutral row rather than breaking.
// ---------------------------------------------------------------------------

type Family = "checkin" | "checkout" | "correct" | "strike" | "cleared" | "roster" | "danger";

const FAMILY_STYLE: Record<Family, string> = {
  checkin: "bg-emerald-50 border-emerald-300/70 text-emerald-700",
  checkout: "bg-amber-50 border-amber-200 text-amber-700",
  correct: "bg-brand-50 border-brand-200 text-brand-700",
  strike: "bg-red-50 border-red-300/80 text-red-700",
  cleared: "bg-slate-50 border-slate-200 text-slate-500",
  roster: "bg-slate-50 border-slate-200 text-slate-600",
  danger: "bg-red-50 border-red-300/80 text-red-700",
};

function FamilyIcon({ family }: { family: Family }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (family) {
    case "checkin":
      return (
        <svg viewBox="0 0 24 24" {...p} className="h-4 w-4">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
          <path d="m10 17 5-5-5-5" />
          <path d="M15 12H3" />
        </svg>
      );
    case "checkout":
      return (
        <svg viewBox="0 0 24 24" {...p} className="h-4 w-4">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="m16 17 5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
      );
    case "correct":
      return (
        <svg viewBox="0 0 24 24" {...p} className="h-4 w-4">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      );
    case "strike":
      return (
        <svg viewBox="0 0 24 24" {...p} className="h-4 w-4">
          <path d="M12 9v4M12 17h.01" />
          <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
      );
    case "cleared":
      return (
        <svg viewBox="0 0 24 24" {...p} className="h-4 w-4">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      );
    case "danger":
      return (
        <svg viewBox="0 0 24 24" {...p} className="h-4 w-4">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 11h-6" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" {...p} className="h-4 w-4">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M19 8v6M22 11h-6" />
        </svg>
      );
  }
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

// The family, the sentence, and the supporting detail for one entry. Kept as a
// pure function of the entry so it can be unit-tested without rendering.
export function describeEntry(e: AuditEntry): {
  family: Family;
  // Short label for the Action column's chip ("Checked in").
  label: string;
  // Sentence form, for anywhere the entry reads as prose.
  verb: string;
  detail: string;
  method: string;
} {
  const d = e.details || {};
  const side = str(d.side) === "checkout" ? "Check-out" : "Check-in";
  const method =
    str(d.method) === "scan" ? "QR scan" : str(d.method) === "manual" ? "by hand" : "";
  switch (e.action) {
    case "checkin":
      return { family: "checkin", label: "Checked in", verb: "checked in", method,
        detail: d.to ? `Set to ${formatPacificTime(str(d.to))}` : "" };
    case "checkout":
      return { family: "checkout", label: "Checked out", verb: "checked out", method,
        detail: d.to ? `Set to ${formatPacificTime(str(d.to))}` : "" };
    case "checkin_cleared":
    case "checkout_cleared":
      return { family: "cleared", label: `${side} cleared`,
        verb: `had their ${side.toLowerCase()} cleared`, method: "",
        detail: d.from ? `Was ${formatPacificTime(str(d.from))} — these hours stopped counting` : "" };
    case "time_corrected":
      return { family: "correct", label: "Time corrected", verb: "had a time corrected", method: "",
        detail: `${side} ${formatPacificTime(str(d.from))} → ${formatPacificTime(str(d.to))}` };
    case "strike_set": {
      const up = num(d.to) > num(d.from);
      return { family: up ? "strike" : "cleared",
        label: up ? "Strike" : "Strike cleared",
        verb: up ? "was given a strike" : "had a strike cleared", method: "",
        detail: `${num(d.from)} → ${num(d.to)}` };
    }
    case "attendee_added":
      return { family: "roster", label: "Added", verb: "was added to the event",
        method: "", detail: "" };
    case "attendee_removed": {
      const bits: string[] = [];
      if (d.checkinAt) bits.push(`check-in ${formatPacificTime(str(d.checkinAt))}`);
      if (d.checkoutAt) bits.push(`check-out ${formatPacificTime(str(d.checkoutAt))}`);
      if (num(d.strikes) > 0) bits.push(`${num(d.strikes)} strike${num(d.strikes) === 1 ? "" : "s"}`);
      return { family: "danger", label: "Removed", verb: "was removed from the event", method: "",
        detail: bits.length ? `Removed with ${bits.join(", ")}` : "" };
    }
    case "volunteer_created":
      return { family: "roster", label: "Added to roster", verb: "was added to the roster",
        method: "", detail: [str(d.grade), str(d.role)].filter(Boolean).join(" · ") };
    case "volunteer_updated": {
      const bits: string[] = [];
      if (d.nameTo) bits.push(`name ${str(d.nameFrom)} → ${str(d.nameTo)}`);
      if (d.roleTo) bits.push(`role ${str(d.roleFrom)} → ${str(d.roleTo)}`);
      if (d.gradeTo) bits.push(`grade ${str(d.gradeFrom)} → ${str(d.gradeTo)}`);
      if (d.email) bits.push("email changed");
      if (d.phone) bits.push("phone changed");
      if (d.customFields) bits.push("custom fields changed");
      return { family: "correct", label: "Record edited", verb: "had their record edited",
        method: "", detail: bits.join(" · ") };
    }
    case "volunteer_deleted":
      return { family: "danger", label: "Removed from roster",
        verb: "was removed from the roster", method: "", detail: "" };
    default:
      return { family: "roster", label: "Updated", verb: "was updated", method: "", detail: "" };
  }
}

// The action filter's options. Grouped the way an admin thinks about them
// rather than by the raw action keys.
const ACTION_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "All actions" },
  { value: "checkin", label: "Check-ins" },
  { value: "checkout", label: "Check-outs" },
  { value: "time_corrected", label: "Time corrections" },
  { value: "checkin_cleared", label: "Check-ins cleared" },
  { value: "checkout_cleared", label: "Check-outs cleared" },
  { value: "strike_set", label: "Strikes" },
  { value: "attendee_added", label: "Added to an event" },
  { value: "attendee_removed", label: "Removed from an event" },
  { value: "volunteer_created", label: "Roster additions" },
  { value: "volunteer_updated", label: "Roster edits" },
  { value: "volunteer_deleted", label: "Roster removals" },
];

const RANGE_FILTERS: Array<{ value: string; label: string; days: number | null }> = [
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
  { value: "", label: "All time", days: null },
];

// A group of entries that all happened at ONE event on ONE day — or, for the
// actions that belong to no event (roster edits), the day's catch-all.
interface Group {
  key: string;
  isRoster: boolean;
  name: string;
  meta: string;
  deleted: boolean;
  rollup: Array<{ family: Family; n: number; label: string }>;
  rows: AuditEntry[];
}

const ROSTER_KEY = "__roster__";

// Count the action families in a group, in a stable order, keeping only the
// ones that actually occurred — a roll-up listing zeroes is noise, and the
// point of it is that a strike is visible before any row is read.
const ROLLUP_ORDER: Array<{ family: Family; one: string; many: string }> = [
  { family: "checkin", one: "in", many: "in" },
  { family: "checkout", one: "out", many: "out" },
  { family: "correct", one: "correction", many: "corrections" },
  { family: "strike", one: "strike", many: "strikes" },
  { family: "cleared", one: "cleared", many: "cleared" },
  { family: "danger", one: "removal", many: "removals" },
  { family: "roster", one: "added", many: "added" },
];

function buildRollup(rows: AuditEntry[]): Group["rollup"] {
  const counts = new Map<Family, number>();
  for (const r of rows) {
    const f = describeEntry(r).family;
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return ROLLUP_ORDER.filter((o) => counts.get(o.family)).map((o) => {
    const n = counts.get(o.family) as number;
    return { family: o.family, n, label: n === 1 ? o.one : o.many };
  });
}

interface Props {
  // Roster roles, so a name in the log carries the same badges it carries
  // everywhere else.
  rolesByName: Map<string, "volunteer" | "officer">;
  // Live events, used to enrich an event group's header with its schedule — and
  // to say plainly when the event it refers to no longer exists.
  events: VolunteerEvent[];
}

export function AuditPanel({ rolesByName, events }: Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  // Server-side filters (they change what is fetched).
  const [action, setAction] = useState("");
  const [actor, setActor] = useState<"" | AccountRole>("");
  const [range, setRange] = useState("7");
  // Client-side filter (free-text over what is already loaded).
  const [query, setQuery] = useState("");

  const since = useMemo(() => {
    const days = RANGE_FILTERS.find((r) => r.value === range)?.days ?? null;
    if (days === null) return undefined;
    return new Date(Date.now() - days * 86400000).toISOString();
  }, [range]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setEntries(
        await fetchAudit({
          action: action || undefined,
          actor: actor || undefined,
          since,
          limit,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the audit log.");
    } finally {
      setLoading(false);
    }
  }, [action, actor, since, limit]);

  useEffect(() => {
    load();
  }, [load]);

  const eventsById = useMemo(() => {
    const m = new Map<string, VolunteerEvent>();
    for (const e of events) m.set(e.id, e);
    return m;
  }, [events]);

  // Free-text narrowing happens on the loaded page: the server filters by the
  // structured fields, and this catches "show me Andrew" without a round-trip.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.volunteerName.toLowerCase().includes(q) ||
        e.eventName.toLowerCase().includes(q) ||
        (e.volunteerCode || "").toLowerCase().includes(q)
    );
  }, [entries, query]);

  // Day → event. Several events can run on one day, so each gets its own table;
  // the entries with no event collect in one group at the END of the day, since
  // they are bookkeeping rather than what happened at an event.
  //
  // The server already sorts newest-first, so insertion order into each map IS
  // the display order — no re-sorting, and a group's position follows its most
  // recent entry.
  const days = useMemo(() => {
    const todayKey = pacificTodayKey();
    const byDay = new Map<string, Map<string, AuditEntry[]>>();
    for (const e of filtered) {
      const dayKey = pacificDayKey(e.at);
      let groups = byDay.get(dayKey);
      if (!groups) byDay.set(dayKey, (groups = new Map()));
      const gKey = e.eventId || ROSTER_KEY;
      const rows = groups.get(gKey);
      if (rows) rows.push(e);
      else groups.set(gKey, [e]);
    }

    return [...byDay.entries()].map(([dayKey, groupMap]) => {
      const groups: Group[] = [...groupMap.entries()].map(([gKey, rows]) => {
        if (gKey === ROSTER_KEY) {
          return {
            key: gKey, isRoster: true, deleted: false,
            name: "Roster & records",
            meta: "Changes not tied to an event",
            rollup: buildRollup(rows), rows,
          };
        }
        const live = eventsById.get(gKey);
        const first = rows[0];
        const bits: string[] = [];
        // Only when it differs from the day being read: repeating the day
        // heading on every event header is noise, but a correction filed weeks
        // after the event is precisely when the event's own date matters.
        if (first.eventDate && first.eventDate !== dayKey) {
          bits.push(`Event ${formatDate(first.eventDate)}`);
        }
        if (live?.startTime) {
          bits.push(
            live.endTime
              ? `${formatTime12h(live.startTime)} – ${formatTime12h(live.endTime)}`
              : formatTime12h(live.startTime)
          );
        }
        if (live && live.expectedHours !== null) {
          bits.push(`expected ${formatHours(live.expectedHours)} hrs`);
        }
        return {
          key: gKey, isRoster: false, deleted: !live,
          name: first.eventName || "Event",
          meta: bits.join(" · "),
          rollup: buildRollup(rows), rows,
        };
      });
      // The event-less group is bookkeeping — it belongs after the events.
      groups.sort((a, b) => Number(a.isRoster) - Number(b.isRoster));

      const total = groups.reduce((n, g) => n + g.rows.length, 0);
      const eventCount = groups.filter((g) => !g.isRoster).length;
      return {
        key: dayKey,
        label: formatPacificDayLabel(dayKey, todayKey),
        full: formatFullDay(dayKey),
        summary:
          (eventCount > 0 ? `${eventCount} event${eventCount === 1 ? "" : "s"} · ` : "") +
          `${total} action${total === 1 ? "" : "s"}`,
        isToday: dayKey === todayKey,
        groups,
      };
    });
  }, [filtered, eventsById]);

  const zone = pacificAbbrev();
  const filtersActive = Boolean(action || actor || query.trim() || range !== "7");
  // When the visible entries all belong to one person, the log IS that
  // volunteer's history — worth naming rather than leaving as "12 entries".
  const soleVolunteer = useMemo(() => {
    if (!query.trim() || filtered.length === 0) return null;
    const names = new Set(filtered.map((e) => e.volunteerName));
    return names.size === 1 ? [...names][0] : null;
  }, [filtered, query]);
  const eventTotal = useMemo(
    () => days.reduce((n, d) => n + d.groups.filter((g) => !g.isRoster).length, 0),
    [days]
  );

  function clearFilters() {
    setAction("");
    setActor("");
    setRange("7");
    setQuery("");
    setLimit(PAGE);
  }

  return (
    <section className="space-y-5">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Audit Log</h2>
              <span className="badge bg-accent-100 text-accent-700">Admin</span>
            </div>
            <p className="text-sm text-slate-500">
              Every action staff have taken on a volunteer, grouped by event.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800"
              title={`Times are shown in the chapter's timezone (Pacific), whatever timezone you are reading from. Currently ${zone}.`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              All times Pacific ({zone})
            </span>
            <button onClick={load} className="btn-secondary py-1.5 text-sm" disabled={loading} title="Re-read the log">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
          <div className="relative">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              aria-label="Search the audit log by volunteer, event or ID"
              placeholder="Search a volunteer or event…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input pl-9"
            />
          </div>
          <select
            aria-label="Filter by action"
            value={action}
            onChange={(e) => { setAction(e.target.value); setLimit(PAGE); }}
            className="input"
          >
            {ACTION_FILTERS.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
          <select
            aria-label="Filter by who did it"
            value={actor}
            onChange={(e) => { setActor(e.target.value as "" | AccountRole); setLimit(PAGE); }}
            className="input"
          >
            <option value="">Anyone</option>
            <option value="admin">Admin</option>
            <option value="officer">Officer</option>
          </select>
          <select
            aria-label="Filter by date range"
            value={range}
            onChange={(e) => { setRange(e.target.value); setLimit(PAGE); }}
            className="input"
          >
            {RANGE_FILTERS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
          <span>
            Showing <span className="font-semibold tabular-nums text-slate-700">{filtered.length}</span>{" "}
            {filtered.length === 1 ? "entry" : "entries"}
            {soleVolunteer ? (
              <> for <span className="font-semibold text-slate-700">{soleVolunteer}</span></>
            ) : eventTotal > 0 ? (
              <> across <span className="font-semibold tabular-nums text-slate-700">{eventTotal}</span>{" "}
                {eventTotal === 1 ? "event" : "events"}</>
            ) : null}
          </span>
          {filtersActive && (
            <button onClick={clearFilters} className="font-semibold text-brand-700 hover:text-brand-900">
              Clear filters
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={load} className="ml-3 font-semibold underline-offset-2 hover:underline">
            Try again
          </button>
        </div>
      )}

      {loading && entries.length === 0 ? (
        <div className="card px-5 py-16 text-center text-sm text-slate-500">Loading the log…</div>
      ) : days.length === 0 ? (
        <div className="card px-5 py-16 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M12 8v4l3 2" />
              <circle cx="12" cy="12" r="9" />
            </svg>
          </div>
          <p className="text-sm font-medium text-slate-700">
            {filtersActive ? "Nothing matches those filters." : "No activity recorded yet."}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {filtersActive
              ? "Try a wider date range, or clear the filters."
              : "The log fills as staff scan volunteers in and out."}
          </p>
        </div>
      ) : (
        <>
          {days.map((day) => (
            <div key={day.key} className="space-y-3">
              {/* The day heading is the strongest divider on the page. */}
              <div className="flex items-center gap-3 px-0.5">
                <span
                  className={`inline-flex flex-none items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${
                    day.isToday ? "bg-brand-700 text-white" : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {day.label}
                </span>
                <h3 className="truncate text-base font-bold tracking-tight text-slate-900">
                  {day.full}
                </h3>
                <div className="h-px flex-1 bg-slate-200" />
                <span className="flex-none text-xs font-medium text-slate-400">{day.summary}</span>
              </div>

              {day.groups.map((g) => (
                <EventGroup
                  key={g.key}
                  group={g}
                  rolesByName={rolesByName}
                  onPickVolunteer={setQuery}
                />
              ))}
            </div>
          ))}
          {entries.length >= limit && (
            <div className="flex items-center justify-center pt-1">
              <button onClick={() => setLimit((n) => n + PAGE)} className="btn-secondary py-1.5 text-sm" disabled={loading}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="m6 9 6 6 6-6" />
                </svg>
                {loading ? "Loading…" : "Load older entries"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function formatFullDay(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// One event's table for one day. The five columns ARE the record: when, who,
// what, the before/after, and which account. Everything else the entry holds is
// already implied by the group it sits in.
//
// Desktop lays those five out as a grid; a phone stacks them. They are two
// ARRANGEMENTS of the same pieces rather than one responsive grid — a single
// grid with reordered, column-spanning cells collapses into a jumble at narrow
// widths, which is exactly what it did before this was split.
const DESKTOP_GRID =
  "grid-cols-[74px_minmax(0,1.05fr)_150px_minmax(0,1.2fr)_76px] gap-x-3";

function EventGroup({
  group,
  rolesByName,
  onPickVolunteer,
}: {
  group: Group;
  rolesByName: Map<string, "volunteer" | "officer">;
  onPickVolunteer: (name: string) => void;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={`flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border ${
              group.isRoster
                ? "border-slate-200 bg-slate-50 text-slate-600"
                : "border-brand-100 bg-brand-50 text-brand-700"
            }`}
            aria-hidden
          >
            {group.isRoster ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <circle cx="9" cy="10" r="2" />
                <path d="M15 9h3M15 13h3M7 16h10" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[15px] font-semibold text-slate-900">{group.name}</span>
              {group.deleted && (
                <span
                  className="inline-flex flex-none items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-px text-[10px] font-semibold uppercase tracking-wide text-slate-500"
                  title="This event has since been deleted — the log kept its name so the history still reads."
                >
                  Deleted
                </span>
              )}
            </div>
            {group.meta && <div className="mt-px text-xs text-slate-400">{group.meta}</div>}
          </div>
        </div>
        {/* Only the kinds that actually occurred, so a strike is visible before
            a single row has been read. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {group.rollup.map((r) => (
            <span
              key={r.family}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${FAMILY_STYLE[r.family]}`}
            >
              <span className="tabular-nums">{r.n}</span>
              <span>{r.label}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Column headings — desktop only; on a phone each row is self-labelling. */}
      <div
        className={`hidden border-y border-slate-100 bg-slate-50/70 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 sm:grid ${DESKTOP_GRID}`}
      >
        <div>Time</div>
        <div>Volunteer</div>
        <div>Action</div>
        <div>Detail</div>
        <div className="text-right">By</div>
      </div>

      {group.rows.map((e) => (
        <AuditRow
          key={e.id}
          entry={e}
          role={rolesByName.get(e.volunteerName)}
          onPickVolunteer={onPickVolunteer}
        />
      ))}
    </div>
  );
}

function AuditRow({
  entry,
  role,
  onPickVolunteer,
}: {
  entry: AuditEntry;
  role?: "volunteer" | "officer";
  // Clicking a name narrows the log to that person — the "everything about
  // this volunteer" view, without a second page to navigate to and back from.
  onPickVolunteer: (name: string) => void;
}) {
  const { family, label, detail, method } = describeEntry(entry);

  const time = (
    <span className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-slate-700">
      {formatPacificTime(entry.at)}
    </span>
  );

  const volunteer = entry.volunteerName ? (
    <button
      type="button"
      onClick={() => onPickVolunteer(entry.volunteerName)}
      title={`Show everything recorded for ${entry.volunteerName}`}
      className="whitespace-nowrap rounded text-[13px] font-semibold text-slate-900 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-400"
    >
      {entry.volunteerName}
    </button>
  ) : (
    <span className="text-[13px] font-semibold text-slate-400">—</span>
  );

  // The colour lives on the chip, not the row: tinting every row turns the
  // table into stripes and nothing stands out.
  const chip = (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${FAMILY_STYLE[family]}`}
    >
      <FamilyIcon family={family} />
      {label}
    </span>
  );

  const detailCell = (detail || method) && (
    <>
      {detail}
      {method && (
        <span className="ml-1.5 inline-flex items-center rounded bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-500">
          {method}
        </span>
      )}
    </>
  );

  return (
    <>
      {/* Phone: chip + time lead, then who, then the detail. */}
      <div className="border-t border-slate-100 px-4 py-2.5 sm:hidden">
        <div className="flex items-center justify-between gap-2">
          {chip}
          {time}
        </div>
        {/* The volunteer's own Officer badge and the acting account's Officer
            badge are both green pills; side by side they read as one thing. On
            desktop separate columns keep them apart — here, opposite ends do. */}
        <div className="mt-1.5 flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            {volunteer}
            <VolunteerBadges name={entry.volunteerName} role={role} size="sm" />
          </div>
          <ActorBadge role={entry.actorRole} />
        </div>
        {detailCell && <div className="mt-1 text-xs text-slate-500">{detailCell}</div>}
      </div>

      {/* Desktop: the five columns. */}
      <div
        className={`hidden items-center border-t border-slate-100 px-5 py-2 hover:bg-slate-50/60 sm:grid ${DESKTOP_GRID}`}
      >
        <div>{time}</div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          {volunteer}
          <VolunteerBadges name={entry.volunteerName} role={role} size="sm" />
        </div>
        <div>{chip}</div>
        <div className="min-w-0 text-xs text-slate-500">{detailCell}</div>
        <div className="justify-self-end">
          <ActorBadge role={entry.actorRole} />
        </div>
      </div>
    </>
  );
}

// Who did it — the ACCOUNT, not a person. The tooltip says so, because a log
// that looks like it names an individual would be read as if it did.
function ActorBadge({ role }: { role: AccountRole }) {
  const officer = role === "officer";
  return (
    <span
      title={
        officer
          ? "Recorded by the Officer account. The passcode is shared, so this identifies the account, not a person."
          : "Recorded by the Admin account. The passcode is shared, so this identifies the account, not a person."
      }
      className={`inline-flex min-w-[64px] flex-none items-center justify-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        officer
          ? "border-emerald-300/70 bg-emerald-50 text-emerald-700"
          : "border-accent-200 bg-accent-50 text-accent-700"
      }`}
    >
      {officer ? "Officer" : "Admin"}
    </span>
  );
}

export type { AuditAction };
