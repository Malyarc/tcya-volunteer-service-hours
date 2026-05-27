import { useMemo, useState } from "react";
import type { VolunteerEvent } from "../../types";
import { VOLUNTEERS } from "../../data/volunteers";
import {
  formatDateLong,
  getEventDisplayName,
  sortAttendance,
} from "../../utils";
import {
  addAttendees,
  deleteEvent,
  patchAttendee,
  removeAttendee,
} from "../../api";

interface Props {
  event: VolunteerEvent;
  onBack: () => void;
  onEventUpdated: (next: VolunteerEvent) => void;
  onEventDeleted: () => void;
}

export function EventDetailPage({
  event,
  onBack,
  onEventUpdated,
  onEventDeleted,
}: Props) {
  const [pickerQuery, setPickerQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { staff, selfAdded } = useMemo(() => sortAttendance(event), [event]);

  // Volunteers available to add (i.e. not already in attendance).
  const availableVolunteers = useMemo(() => {
    const inList = new Set(event.attendance.map((a) => a.volunteerName));
    const q = pickerQuery.trim().toLowerCase();
    return VOLUNTEERS.filter((n) => !inList.has(n)).filter((n) =>
      q ? n.toLowerCase().includes(q) : true
    );
  }, [event.attendance, pickerQuery]);

  const stats = useMemo(() => {
    const total = event.attendance.length;
    const both = event.attendance.filter(
      (a) => a.staffCheckin && a.volunteerCheckout
    ).length;
    const onlyStaff = event.attendance.filter(
      (a) => a.staffCheckin && !a.volunteerCheckout
    ).length;
    const onlyVol = event.attendance.filter(
      (a) => !a.staffCheckin && a.volunteerCheckout
    ).length;
    return { total, both, onlyStaff, onlyVol };
  }, [event.attendance]);

  function togglePick(name: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handleAddSelected() {
    if (picked.size === 0) return;
    try {
      setBusy(true);
      setError(null);
      const updated = await addAttendees(event.id, Array.from(picked));
      onEventUpdated(updated);
      setPicked(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSelectAllVisible() {
    if (availableVolunteers.length === 0) return;
    setPicked(new Set(availableVolunteers));
  }

  async function handleToggleCheck(
    volunteerName: string,
    field: "staffCheckin" | "volunteerCheckout",
    next: boolean
  ) {
    try {
      setBusy(true);
      setError(null);
      const updated = await patchAttendee(event.id, volunteerName, {
        [field]: next,
      });
      onEventUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(volunteerName: string) {
    if (!window.confirm(`Remove ${volunteerName} from this event?`)) return;
    try {
      setBusy(true);
      setError(null);
      const updated = await removeAttendee(event.id, volunteerName);
      onEventUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteEvent() {
    if (
      !window.confirm(
        `Delete this event? Submissions linked to it will remain in the data file but won't count toward hours.`
      )
    )
      return;
    try {
      setBusy(true);
      setError(null);
      await deleteEvent(event.id);
      onEventDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card overflow-hidden">
        <div className="bg-gradient-to-br from-brand-700 to-brand-600 px-6 py-5 text-white">
          <button
            onClick={onBack}
            className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/30 backdrop-blur-sm transition hover:bg-white/25"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back to Dashboard
          </button>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-accent-200">
                Event Detail
              </div>
              <h1 className="mt-1 text-2xl font-bold leading-tight">
                {getEventDisplayName(event)}
              </h1>
              <p className="mt-1 text-sm text-white/85">
                {formatDateLong(event.date)}
              </p>
            </div>
            <button
              onClick={handleDeleteEvent}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-semibold text-white shadow ring-1 ring-red-400/40 transition hover:bg-red-500"
              disabled={busy}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              Delete Event
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 px-6 py-4 sm:grid-cols-4">
          <Stat label="Total Attendees" value={stats.total} />
          <Stat label="Fully Confirmed" value={stats.both} tone="green" />
          <Stat label="Awaiting Volunteer" value={stats.onlyStaff} />
          <Stat label="Awaiting Staff" value={stats.onlyVol} tone="amber" />
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.5fr]">
        {/* Volunteer picker */}
        <section className="card overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">
              Add Volunteers
            </h2>
            <p className="text-xs text-slate-500">
              Select volunteers to add to the attendance list.
            </p>
          </div>
          <div className="px-5 pb-2 pt-3">
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
                placeholder="Search volunteers…"
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                className="input pl-9"
              />
            </div>
          </div>
          <div className="max-h-[420px] overflow-y-auto px-3 pb-3">
            {availableVolunteers.length === 0 ? (
              <div className="px-2 py-8 text-center text-sm text-slate-500">
                {pickerQuery
                  ? "No matches."
                  : "All volunteers are already on the list."}
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {availableVolunteers.map((n) => {
                  const isPicked = picked.has(n);
                  return (
                    <li key={n}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-brand-50/50">
                        <input
                          type="checkbox"
                          checked={isPicked}
                          onChange={() => togglePick(n)}
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                        <span className="text-sm text-slate-800">{n}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
            <button
              onClick={handleSelectAllVisible}
              className="text-xs font-semibold text-brand-700 hover:text-brand-900"
              disabled={availableVolunteers.length === 0 || busy}
            >
              Select all visible
            </button>
            <button
              onClick={handleAddSelected}
              className="btn-primary"
              disabled={picked.size === 0 || busy}
            >
              Add {picked.size > 0 ? `(${picked.size})` : ""}
            </button>
          </div>
        </section>

        {/* Attendance table */}
        <section className="card overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">
              Attendance List
            </h2>
            <p className="text-xs text-slate-500">
              Click an icon to toggle. Hours count only when both are green.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Volunteer
                  </th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Staff Check-in
                  </th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Volunteer Check-out
                  </th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {staff.length === 0 && selfAdded.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-10 text-center text-sm text-slate-500"
                    >
                      No attendees yet. Add volunteers from the panel on the
                      left, or wait for them to submit their hours.
                    </td>
                  </tr>
                )}

                {staff.map((a) => (
                  <AttendanceRow
                    key={a.volunteerName}
                    volunteerName={a.volunteerName}
                    staffCheckin={a.staffCheckin}
                    volunteerCheckout={a.volunteerCheckout}
                    busy={busy}
                    onToggle={handleToggleCheck}
                    onRemove={handleRemove}
                  />
                ))}

                {selfAdded.length > 0 && (
                  <tr>
                    <td colSpan={4} className="bg-amber-50/60 px-4 py-2">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-800">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-3.5 w-3.5"
                        >
                          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                        Submitted hours but not pre-added by staff
                      </div>
                    </td>
                  </tr>
                )}

                {selfAdded.map((a) => (
                  <AttendanceRow
                    key={a.volunteerName}
                    volunteerName={a.volunteerName}
                    staffCheckin={a.staffCheckin}
                    volunteerCheckout={a.volunteerCheckout}
                    busy={busy}
                    onToggle={handleToggleCheck}
                    onRemove={handleRemove}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function AttendanceRow({
  volunteerName,
  staffCheckin,
  volunteerCheckout,
  busy,
  onToggle,
  onRemove,
}: {
  volunteerName: string;
  staffCheckin: boolean;
  volunteerCheckout: boolean;
  busy: boolean;
  onToggle: (
    name: string,
    field: "staffCheckin" | "volunteerCheckout",
    next: boolean
  ) => void;
  onRemove: (name: string) => void;
}) {
  return (
    <tr className="hover:bg-slate-50/60">
      <td className="px-4 py-2.5 font-medium text-slate-900">
        {volunteerName}
      </td>
      <td className="px-4 py-2.5 text-center">
        <CheckToggle
          checked={staffCheckin}
          disabled={busy}
          onClick={() => onToggle(volunteerName, "staffCheckin", !staffCheckin)}
          ariaLabel={`Toggle staff check-in for ${volunteerName}`}
        />
      </td>
      <td className="px-4 py-2.5 text-center">
        <CheckToggle
          checked={volunteerCheckout}
          disabled={busy}
          onClick={() =>
            onToggle(volunteerName, "volunteerCheckout", !volunteerCheckout)
          }
          ariaLabel={`Toggle volunteer check-out for ${volunteerName}`}
        />
      </td>
      <td className="px-2 py-2.5 text-right">
        <button
          onClick={() => onRemove(volunteerName)}
          disabled={busy}
          className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
          aria-label={`Remove ${volunteerName}`}
          title="Remove from event"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </td>
    </tr>
  );
}

function CheckToggle({
  checked,
  disabled,
  onClick,
  ariaLabel,
}: {
  checked: boolean;
  disabled: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition focus:outline-none focus:ring-2 focus:ring-offset-2 ${
        checked
          ? "bg-emerald-500 text-white shadow ring-emerald-200 focus:ring-emerald-500 hover:bg-emerald-600"
          : "bg-red-500 text-white shadow ring-red-200 focus:ring-red-500 hover:bg-red-600"
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {checked ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      )}
    </button>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "green" | "amber";
}) {
  const palette =
    tone === "green"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-100"
      : tone === "amber"
        ? "bg-amber-50 text-amber-800 ring-amber-100"
        : "bg-slate-50 text-slate-800 ring-slate-100";
  return (
    <div className={`rounded-xl px-3 py-2 ring-1 ${palette}`}>
      <div className="text-[11px] font-medium uppercase tracking-wider opacity-70">
        {label}
      </div>
      <div className="mt-0.5 text-xl font-bold">{value}</div>
    </div>
  );
}
