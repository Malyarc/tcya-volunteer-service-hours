import { useMemo, useState } from "react";
import type { VolunteerSummary } from "../utils";
import { displayEventName, formatDate, formatHours, formatTime12h } from "../utils";

interface Props {
  summaries: VolunteerSummary[];
}

export function VolunteerTable({ summaries }: Props) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hideEmpty, setHideEmpty] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return summaries.filter((s) => {
      if (hideEmpty && s.submissions.length === 0) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.latestGrade.toLowerCase().includes(q)
      );
    });
  }, [summaries, query, hideEmpty]);

  function toggle(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Volunteer Roster
          </h2>
          <p className="text-sm text-slate-500">
            Click a volunteer to see every event they've signed in for.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={hideEmpty}
              onChange={(e) => setHideEmpty(e.target.checked)}
            />
            Only show with hours
          </label>
          <div className="relative">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search name or grade…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input pl-9 sm:w-72"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50/70">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                Volunteer
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                Grade
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                Events
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                Total Hours
              </th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-10 text-center text-sm text-slate-500"
                >
                  No volunteers match your search.
                </td>
              </tr>
            )}
            {filtered.map((v) => {
              const isOpen = expanded.has(v.name);
              const hasHours = v.totalHours > 0;
              return (
                <FragmentRow
                  key={v.name}
                  v={v}
                  isOpen={isOpen}
                  hasHours={hasHours}
                  onToggle={() => toggle(v.name)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FragmentRow({
  v,
  isOpen,
  hasHours,
  onToggle,
}: {
  v: VolunteerSummary;
  isOpen: boolean;
  hasHours: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer transition hover:bg-brand-50/40 ${
          isOpen ? "bg-brand-50/30" : ""
        }`}
      >
        <td className="whitespace-nowrap px-5 py-3">
          <div className="flex items-center gap-3">
            <Avatar name={v.name} />
            <div className="font-medium text-slate-900">{v.name}</div>
          </div>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
          {v.latestGrade}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
          {v.submissions.length}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-right">
          <span
            className={`badge ${
              hasHours
                ? "bg-brand-100 text-brand-800"
                : "bg-slate-100 text-slate-500"
            }`}
          >
            {formatHours(v.totalHours)} hrs
          </span>
        </td>
        <td className="px-4 py-3 text-right text-slate-400">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-4 w-4 transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-slate-50/60">
          <td colSpan={5} className="px-5 py-5">
            {v.submissions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
                No service hours logged yet.
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">
                        Date
                      </th>
                      <th className="px-4 py-2 text-left font-semibold">
                        Event
                      </th>
                      <th className="px-4 py-2 text-left font-semibold">
                        Sign In
                      </th>
                      <th className="px-4 py-2 text-left font-semibold">
                        Sign Out
                      </th>
                      <th className="px-4 py-2 text-right font-semibold">
                        Hours
                      </th>
                      <th className="px-4 py-2 text-left font-semibold">
                        Comments
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {v.submissions.map((s) => (
                      <tr key={s.id} className="align-top">
                        <td className="whitespace-nowrap px-4 py-2 text-slate-700">
                          {formatDate(s.eventDate)}
                        </td>
                        <td className="px-4 py-2 text-slate-700">
                          {displayEventName(s)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-700">
                          {formatTime12h(s.arrivalTime)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-700">
                          {formatTime12h(s.endTime)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-right font-medium text-brand-700">
                          {formatHours(s.hours)}
                        </td>
                        <td className="px-4 py-2 text-slate-600">
                          {s.comments || (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Avatar({ name }: { name: string }) {
  // Use initials inside a colored circle. The hue is derived from the name
  // so each volunteer gets a stable, distinguishable avatar.
  const initials = name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  const hue = Array.from(name).reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-white shadow-sm"
      style={{ backgroundColor: `hsl(${hue}, 55%, 45%)` }}
      aria-hidden
    >
      {initials || "?"}
    </div>
  );
}
