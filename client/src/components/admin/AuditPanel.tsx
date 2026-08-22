import { useCallback, useEffect, useMemo, useState } from "react";
import type { AccountRole, AuditAction, AuditEntry } from "../../types";
import { fetchAudit } from "../../api";
import { formatDisplayId } from "../../qr";
import {
  formatPacificDayLabel,
  formatPacificTime,
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
      return { family: "checkin", verb: "checked in", method,
        detail: d.to ? `Check-in set to ${formatPacificTime(str(d.to))}` : "" };
    case "checkout":
      return { family: "checkout", verb: "checked out", method,
        detail: d.to ? `Check-out set to ${formatPacificTime(str(d.to))}` : "" };
    case "checkin_cleared":
    case "checkout_cleared":
      return { family: "cleared", verb: `had their ${side.toLowerCase()} cleared`, method: "",
        detail: d.from ? `Was ${formatPacificTime(str(d.from))} — these hours stopped counting` : "" };
    case "time_corrected":
      return { family: "correct", verb: "had a time corrected", method: "",
        detail: `${side} ${formatPacificTime(str(d.from))} → ${formatPacificTime(str(d.to))}` };
    case "strike_set": {
      const up = num(d.to) > num(d.from);
      return { family: up ? "strike" : "cleared",
        verb: up ? "was given a strike" : "had a strike cleared", method: "",
        detail: `${num(d.from)} → ${num(d.to)}` };
    }
    case "attendee_added":
      return { family: "roster", verb: "was added to the event", method: "", detail: "" };
    case "attendee_removed": {
      const bits: string[] = [];
      if (d.checkinAt) bits.push(`check-in ${formatPacificTime(str(d.checkinAt))}`);
      if (d.checkoutAt) bits.push(`check-out ${formatPacificTime(str(d.checkoutAt))}`);
      if (num(d.strikes) > 0) bits.push(`${num(d.strikes)} strike${num(d.strikes) === 1 ? "" : "s"}`);
      return { family: "danger", verb: "was removed from the event", method: "",
        detail: bits.length ? `Removed with ${bits.join(", ")}` : "" };
    }
    case "volunteer_created":
      return { family: "roster", verb: "was added to the roster", method: "",
        detail: [str(d.grade), str(d.role)].filter(Boolean).join(" · ") };
    case "volunteer_updated": {
      const bits: string[] = [];
      if (d.nameTo) bits.push(`name ${str(d.nameFrom)} → ${str(d.nameTo)}`);
      if (d.roleTo) bits.push(`role ${str(d.roleFrom)} → ${str(d.roleTo)}`);
      if (d.gradeTo) bits.push(`grade ${str(d.gradeFrom)} → ${str(d.gradeTo)}`);
      if (d.email) bits.push("email changed");
      if (d.phone) bits.push("phone changed");
      if (d.customFields) bits.push("custom fields changed");
      return { family: "correct", verb: "had their record edited", method: "",
        detail: bits.join(" · ") };
    }
    case "volunteer_deleted":
      return { family: "danger", verb: "was removed from the roster", method: "", detail: "" };
    default:
      return { family: "roster", verb: "was updated", method: "", detail: "" };
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

interface Props {
  // Roster roles, so a name in the log can carry the same badges it carries
  // everywhere else.
  rolesByName: Map<string, "volunteer" | "officer">;
}

export function AuditPanel({ rolesByName }: Props) {
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

  // Grouped by the PACIFIC day, newest day first. The server already sorts
  // newest-first, so insertion order into the map is the display order.
  const days = useMemo(() => {
    const todayKey = pacificTodayKey();
    const map = new Map<string, AuditEntry[]>();
    for (const e of filtered) {
      const key = pacificDayKey(e.at);
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
    return [...map.entries()].map(([key, list]) => ({
      key,
      label: formatPacificDayLabel(key, todayKey),
      list,
    }));
  }, [filtered]);

  const zone = pacificAbbrev();
  const filtersActive = Boolean(action || actor || query.trim() || range !== "7");
  // When the visible entries all belong to one person, the log IS that
  // volunteer's history — worth naming rather than leaving as "12 entries".
  const soleVolunteer = useMemo(() => {
    if (!query.trim() || filtered.length === 0) return null;
    const names = new Set(filtered.map((e) => e.volunteerName));
    return names.size === 1 ? [...names][0] : null;
  }, [filtered, query]);

  return (
    <section className="space-y-4">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Audit Log</h2>
              <span className="badge bg-accent-100 text-accent-700">Admin</span>
            </div>
            <p className="text-sm text-slate-500">
              Every action staff have taken on a volunteer, newest first.
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
            <button
              onClick={load}
              className="btn-secondary py-1.5 text-sm"
              disabled={loading}
              title="Re-read the log"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Filters */}
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
            onChange={(e) => {
              setAction(e.target.value);
              setLimit(PAGE);
            }}
            className="input"
          >
            {ACTION_FILTERS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by who did it"
            value={actor}
            onChange={(e) => {
              setActor(e.target.value as "" | AccountRole);
              setLimit(PAGE);
            }}
            className="input"
          >
            <option value="">Anyone</option>
            <option value="admin">Admin</option>
            <option value="officer">Officer</option>
          </select>
          <select
            aria-label="Filter by date range"
            value={range}
            onChange={(e) => {
              setRange(e.target.value);
              setLimit(PAGE);
            }}
            className="input"
          >
            {RANGE_FILTERS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
          <span>
            Showing <span className="font-semibold tabular-nums text-slate-700">{filtered.length}</span>{" "}
            {filtered.length === 1 ? "entry" : "entries"}
            {soleVolunteer ? (
              <>
                {" "}for <span className="font-semibold text-slate-700">{soleVolunteer}</span>
              </>
            ) : (
              filtersActive && " matching your filters"
            )}
          </span>
          {filtersActive && (
            <button
              onClick={() => {
                setAction("");
                setActor("");
                setRange("7");
                setQuery("");
                setLimit(PAGE);
              }}
              className="font-semibold text-brand-700 hover:text-brand-900"
            >
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

      <div className="card overflow-hidden">
        {loading && entries.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-slate-500">Loading the log…</div>
        ) : days.length === 0 ? (
          <div className="px-5 py-16 text-center">
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
              <div key={day.key}>
                <div className="flex items-baseline gap-2.5 border-b border-slate-100 bg-slate-50/70 px-5 py-2.5">
                  <span className="text-[13px] font-bold text-slate-900">{day.label}</span>
                  <span className="text-xs text-slate-400">{formatFullDay(day.key)}</span>
                  <span className="ml-auto text-xs text-slate-400">
                    {day.list.length} {day.list.length === 1 ? "entry" : "entries"}
                  </span>
                </div>
                {day.list.map((e) => (
                  <AuditRow
                    key={e.id}
                    entry={e}
                    role={rolesByName.get(e.volunteerName)}
                    onPickVolunteer={setQuery}
                  />
                ))}
              </div>
            ))}
            {entries.length >= limit && (
              <div className="flex items-center justify-center border-t border-slate-100 px-5 py-3.5">
                <button
                  onClick={() => setLimit((n) => n + PAGE)}
                  className="btn-secondary py-1.5 text-sm"
                  disabled={loading}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                  {loading ? "Loading…" : "Load older entries"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function formatFullDay(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
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
  const { family, verb, detail, method } = describeEntry(entry);
  return (
    <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 hover:bg-slate-50/50 sm:items-center sm:gap-4 sm:px-5">
      <div
        className={`flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full border ${FAMILY_STYLE[family]}`}
        aria-hidden
      >
        <FamilyIcon family={family} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {entry.volunteerName ? (
            <button
              type="button"
              onClick={() => onPickVolunteer(entry.volunteerName)}
              title={`Show everything recorded for ${entry.volunteerName}`}
              className="whitespace-nowrap rounded text-sm font-semibold text-slate-900 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-400"
            >
              {entry.volunteerName}
            </button>
          ) : (
            <span className="text-sm font-semibold text-slate-400">—</span>
          )}
          <VolunteerBadges name={entry.volunteerName} role={role} size="sm" />
          <span className="text-sm text-slate-600">{verb}</span>
          {method && (
            <span className="inline-flex flex-none items-center rounded-md bg-slate-100 px-1.5 py-px text-[11px] font-semibold text-slate-500">
              {method}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-col gap-x-1.5 text-xs text-slate-400 sm:flex-row sm:flex-wrap sm:items-center">
          {entry.eventName && <span className="sm:truncate">{entry.eventName}</span>}
          {entry.eventName && detail && (
            <span className="hidden text-slate-300 sm:inline">·</span>
          )}
          {detail && <span className="text-slate-500">{detail}</span>}
          {!entry.eventName && !detail && entry.volunteerCode && (
            <span>{formatDisplayId(entry.volunteerCode)}</span>
          )}
        </div>
      </div>

      <div className="flex flex-none flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        <div className="text-right leading-tight">
          <div className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-slate-700">
            {formatPacificTime(entry.at)}
          </div>
          <div className="text-[11px] text-slate-400">{pacificAbbrev(entry.at)}</div>
        </div>
        <ActorBadge role={entry.actorRole} />
      </div>
    </div>
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
      className={`inline-flex min-w-[66px] flex-none items-center justify-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
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
