import { useMemo, useState } from "react";
import type { Submission } from "../types";
import type { VolunteerSummary } from "../utils";
import { displayEventName, formatDate, formatHours, formatTime12h } from "../utils";
import {
  downloadEventCertificate,
  downloadVolunteerCertificate,
} from "../certificate";
import { Avatar } from "./Avatar";

interface Props {
  summaries: VolunteerSummary[];
  isAdmin?: boolean;
}

export function VolunteerTable({ summaries, isAdmin = false }: Props) {
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
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={hideEmpty}
              onChange={(e) => setHideEmpty(e.target.checked)}
            />
            Only show with hours
          </label>
          <div className="relative flex-1 sm:flex-none">
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
              className="input w-full pl-9 sm:w-72"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50/70">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 sm:px-5">
                Volunteer
              </th>
              <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 sm:table-cell">
                Grade
              </th>
              <th className="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 md:table-cell">
                Events
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                Total Hours
              </th>
              <th className="hidden px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 sm:table-cell">
                Certificate
              </th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
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
                  isAdmin={isAdmin}
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
  isAdmin,
  onToggle,
}: {
  v: VolunteerSummary;
  isOpen: boolean;
  hasHours: boolean;
  isAdmin: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onKeyDown={(e) => {
          // Only respond to keys on the row itself. Enter/Space bubbling up from
          // a nested control (the certificate download button) must NOT toggle
          // the row — otherwise Enter on that button would expand the row while
          // preventDefault() swallows the button's own activation.
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className={`cursor-pointer transition hover:bg-brand-50/40 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-400 ${
          isOpen ? "bg-brand-50/30" : ""
        }`}
      >
        <td className="whitespace-nowrap px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <Avatar name={v.name} />
            <div className="min-w-0">
              <div className="font-medium text-slate-900">{v.name}</div>
              {/* On mobile, surface grade here since its column is hidden. */}
              <div className="text-xs text-slate-500 sm:hidden">
                {v.latestGrade !== "—" ? `Grade ${v.latestGrade}` : ""}
              </div>
            </div>
          </div>
        </td>
        <td className="hidden whitespace-nowrap px-4 py-3 text-sm text-slate-600 sm:table-cell">
          {v.latestGrade}
        </td>
        <td className="hidden whitespace-nowrap px-4 py-3 text-sm text-slate-600 md:table-cell">
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
        <td
          className="hidden whitespace-nowrap px-4 py-3 text-right sm:table-cell"
          onClick={(e) => e.stopPropagation()}
        >
          <CertificateButton
            label="Download"
            disabled={!hasHours}
            title={
              hasHours
                ? "Download certification letter"
                : "No confirmed hours yet"
            }
            onClick={() =>
              downloadVolunteerCertificate(v.name, v.totalHours, v.submissions)
            }
          />
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
          <td colSpan={6} className="px-4 py-5 sm:px-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium text-slate-700">
                {v.submissions.length} event{v.submissions.length === 1 ? "" : "s"} ·{" "}
                {formatHours(v.totalHours)} hrs
              </div>
              {/* Cumulative certificate — reachable here on phones (the roster
                  column that holds it is hidden below the sm breakpoint). On
                  sm+ the roster row already shows this button, so hide it here
                  to avoid a duplicate. */}
              <div className="sm:hidden">
                <CertificateButton
                  label="Download certificate"
                  disabled={!hasHours}
                  title={hasHours ? "Download full certification letter" : "No confirmed hours yet"}
                  onClick={() =>
                    downloadVolunteerCertificate(v.name, v.totalHours, v.submissions)
                  }
                />
              </div>
            </div>
            {v.submissions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
                No service hours logged yet.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">Date</th>
                      <th className="px-4 py-2 text-left font-semibold">Event</th>
                      {isAdmin && (
                        <>
                          <th className="hidden px-4 py-2 text-left font-semibold sm:table-cell">Sign In</th>
                          <th className="hidden px-4 py-2 text-left font-semibold sm:table-cell">Sign Out</th>
                        </>
                      )}
                      <th className="px-4 py-2 text-right font-semibold">Hours</th>
                      {isAdmin && (
                        <th className="hidden px-4 py-2 text-left font-semibold md:table-cell">Comments</th>
                      )}
                      <th className="px-4 py-2 text-right font-semibold">Certificate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {v.submissions.map((s) => (
                      <SubmissionRow
                        key={s.id}
                        submission={s}
                        volunteerName={v.name}
                        isAdmin={isAdmin}
                      />
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

function SubmissionRow({
  submission,
  volunteerName,
  isAdmin,
}: {
  submission: Submission;
  volunteerName: string;
  isAdmin: boolean;
}) {
  return (
    <tr className="align-top">
      <td className="whitespace-nowrap px-4 py-2 text-slate-700">
        {formatDate(submission.eventDate)}
      </td>
      <td className="px-4 py-2 text-slate-700">{displayEventName(submission)}</td>
      {isAdmin && (
        <>
          <td className="hidden whitespace-nowrap px-4 py-2 text-slate-700 sm:table-cell">
            {formatTime12h(submission.arrivalTime)}
          </td>
          <td className="hidden whitespace-nowrap px-4 py-2 text-slate-700 sm:table-cell">
            {formatTime12h(submission.endTime)}
          </td>
        </>
      )}
      <td className="whitespace-nowrap px-4 py-2 text-right font-medium text-brand-700">
        {formatHours(submission.hours)}
      </td>
      {isAdmin && (
        <td className="hidden px-4 py-2 text-slate-600 md:table-cell">
          {submission.comments || <span className="text-slate-400">—</span>}
        </td>
      )}
      <td className="whitespace-nowrap px-4 py-2 text-right">
        <CertificateButton
          label="Download"
          title="Download certification letter for this event"
          onClick={() => downloadEventCertificate(volunteerName, submission)}
        />
      </td>
    </tr>
  );
}

function CertificateButton({
  label,
  onClick,
  disabled,
  title,
}: {
  label: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  title?: string;
}) {
  const [busy, setBusy] = useState(false);
  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (disabled || busy) return;
    setBusy(true);
    try {
      await onClick();
    } catch (err) {
      console.error("Failed to generate certificate", err);
      alert("Sorry, the certificate could not be generated. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || busy}
      title={title}
      className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-2.5 py-1.5 text-xs font-medium text-brand-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:bg-slate-50"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
        aria-hidden
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {busy ? "Generating…" : label}
    </button>
  );
}

