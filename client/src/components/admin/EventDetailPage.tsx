import { useMemo, useState } from "react";
import type { AttendanceEntry, Volunteer, VolunteerEvent } from "../../types";
import {
  formatClockFromIso,
  formatDateLong,
  getEventDisplayName,
  isoToLocalInput,
  localInputToIso,
  sortAttendance,
} from "../../utils";
import {
  addAttendees,
  deleteEvent,
  patchAttendee,
  removeAttendee,
} from "../../api";
import { ScannerModal } from "./ScannerModal";

interface Props {
  event: VolunteerEvent;
  rosterNames: string[];
  volunteers: Volunteer[];
  onBack: () => void;
  onEventUpdated: (next: VolunteerEvent) => void;
  onEventDeleted: () => void;
}

export function EventDetailPage({
  event,
  rosterNames,
  volunteers,
  onBack,
  onEventUpdated,
  onEventDeleted,
}: Props) {
  const [pickerQuery, setPickerQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<string | null>(null);

  const attendees = useMemo(() => {
    const { staff, selfAdded } = sortAttendance(event);
    return [...staff, ...selfAdded];
  }, [event]);

  const availableVolunteers = useMemo(() => {
    const inList = new Set(event.attendance.map((a) => a.volunteerName));
    const q = pickerQuery.trim().toLowerCase();
    return rosterNames
      .filter((n) => !inList.has(n))
      .filter((n) => (q ? n.toLowerCase().includes(q) : true));
  }, [event.attendance, pickerQuery, rosterNames]);

  const stats = useMemo(() => {
    const total = event.attendance.length;
    const completed = event.attendance.filter(
      (a) => a.staffCheckin && a.volunteerCheckout
    ).length;
    const inProgress = event.attendance.filter(
      (a) => a.staffCheckin && !a.volunteerCheckout
    ).length;
    const notIn = event.attendance.filter((a) => !a.staffCheckin).length;
    return { total, completed, inProgress, notIn };
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
    // Warn before un-confirming a fully-confirmed row — that quietly stops the
    // volunteer's hours from counting.
    if (!next) {
      const row = event.attendance.find((a) => a.volunteerName === volunteerName);
      if (
        row &&
        row.staffCheckin &&
        row.volunteerCheckout &&
        !window.confirm(
          `Un-check ${volunteerName}? Their attendance is confirmed — un-checking will stop their hours for this event from counting until both are green again.`
        )
      ) {
        return;
      }
    }
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

  async function handleSaveTimes(
    volunteerName: string,
    patch: { checkinAt?: string | null; checkoutAt?: string | null }
  ) {
    // Nothing edited — just close (don't send a no-op / destructive PATCH).
    if (Object.keys(patch).length === 0) {
      setEditingRow(null);
      return;
    }
    try {
      setBusy(true);
      setError(null);
      const updated = await patchAttendee(event.id, volunteerName, patch);
      onEventUpdated(updated);
      setEditingRow(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save times.");
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
        `Delete this event? Its attendance and the service-hour records derived from it will be permanently removed.`
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
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
            <div className="flex items-center gap-2">
              <button
                onClick={() => setScannerOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 shadow ring-1 ring-white/40 transition hover:bg-brand-50"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
                  <line x1="7" y1="12" x2="17" y2="12" />
                </svg>
                Scan QR
              </button>
              <button
                onClick={handleDeleteEvent}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-semibold text-white shadow ring-1 ring-red-400/40 transition hover:bg-red-500"
                disabled={busy}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
                Delete Event
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 px-6 py-4 sm:grid-cols-4">
          <Stat label="On the List" value={stats.total} />
          <Stat label="Completed" value={stats.completed} tone="green" />
          <Stat label="Checked In" value={stats.inProgress} />
          <Stat label="Not Checked In" value={stats.notIn} tone="amber" />
        </div>
        <div className="border-t border-slate-100 px-6 py-2.5 text-xs text-slate-500">
          <span className="font-semibold text-slate-600">Note:</span> a volunteer's{" "}
          <em>service hours</em> are credited automatically from their check-in and
          check-out times (hours = check-out − check-in). Scan their QR or set the
          times by hand below.
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.6fr]">
        {/* Volunteer picker */}
        <section className="card overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">
              Add Volunteers
            </h2>
            <p className="text-xs text-slate-500">
              Pre-register volunteers, or use{" "}
              <button
                onClick={() => setScannerOpen(true)}
                className="font-semibold text-brand-700 hover:underline"
              >
                Scan QR
              </button>{" "}
              to check them in live.
            </p>
          </div>
          <div className="px-5 pb-2 pt-3">
            <div className="relative">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400">
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
                {pickerQuery ? "No matches." : "All volunteers are already on the list."}
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
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Attendance List
              </h2>
              <p className="text-xs text-slate-500">
                Tap a check to stamp / clear that time, or edit the times directly.
                Both times set ⇒ hours are credited (check-out − check-in).
              </p>
            </div>
            <button
              onClick={() => setScannerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-700"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
                <line x1="7" y1="12" x2="17" y2="12" />
              </svg>
              Scan QR
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Volunteer</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">Check-in</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">Check-out</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {attendees.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">
                      No one on the list yet. Add volunteers from the left, or scan
                      their QR codes to check them in.
                    </td>
                  </tr>
                )}

                {attendees.map((a) => (
                  <AttendanceRow
                    key={a.volunteerName}
                    entry={a}
                    busy={busy}
                    editing={editingRow === a.volunteerName}
                    onToggle={handleToggleCheck}
                    onRemove={handleRemove}
                    onEdit={() => setEditingRow(a.volunteerName)}
                    onCancelEdit={() => setEditingRow(null)}
                    onSaveTimes={handleSaveTimes}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <ScannerModal
        open={scannerOpen}
        event={event}
        volunteers={volunteers}
        onClose={() => setScannerOpen(false)}
        onScanned={(updated) => onEventUpdated(updated)}
      />
    </div>
  );
}

function AttendanceRow({
  entry,
  busy,
  editing,
  onToggle,
  onRemove,
  onEdit,
  onCancelEdit,
  onSaveTimes,
}: {
  entry: AttendanceEntry;
  busy: boolean;
  editing: boolean;
  onToggle: (
    name: string,
    field: "staffCheckin" | "volunteerCheckout",
    next: boolean
  ) => void;
  onRemove: (name: string) => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveTimes: (
    name: string,
    patch: { checkinAt?: string | null; checkoutAt?: string | null }
  ) => void;
}) {
  const [inVal, setInVal] = useState(isoToLocalInput(entry.checkinAt));
  const [outVal, setOutVal] = useState(isoToLocalInput(entry.checkoutAt));
  // The values as they were when the editor OPENED. We diff against these (not
  // the live `entry`, which a concurrent scan may have changed) so an untouched
  // field is never sent — a scan that lands while the editor is open survives.
  const [seedIn, setSeedIn] = useState("");
  const [seedOut, setSeedOut] = useState("");
  const [timeError, setTimeError] = useState<string | null>(null);

  function startEdit() {
    const si = isoToLocalInput(entry.checkinAt);
    const so = isoToLocalInput(entry.checkoutAt);
    setSeedIn(si);
    setSeedOut(so);
    setInVal(si);
    setOutVal(so);
    setTimeError(null);
    onEdit();
  }

  function saveTimes() {
    // Guard: with both set, check-out must be after check-in (else the row
    // shows "confirmed" but credits 0 hours).
    if (inVal && outVal && new Date(outVal).getTime() <= new Date(inVal).getTime()) {
      setTimeError("Check-out must be after check-in.");
      return;
    }
    const patch: { checkinAt?: string | null; checkoutAt?: string | null } = {};
    if (inVal !== seedIn) patch.checkinAt = localInputToIso(inVal);
    if (outVal !== seedOut) patch.checkoutAt = localInputToIso(outVal);
    onSaveTimes(entry.volunteerName, patch);
  }

  return (
    <>
      <tr className="hover:bg-slate-50/60">
        <td className="px-4 py-2.5">
          <div className="font-medium text-slate-900">{entry.volunteerName}</div>
          {entry.code && (
            <div className="text-[11px] font-medium text-slate-400">{entry.code}</div>
          )}
        </td>
        <td className="px-4 py-2.5 text-center">
          <CheckToggle
            checked={entry.staffCheckin}
            disabled={busy}
            onClick={() => onToggle(entry.volunteerName, "staffCheckin", !entry.staffCheckin)}
            ariaLabel={`Toggle staff check-in for ${entry.volunteerName}`}
          />
          {entry.checkinAt && (
            <div className="mt-1 text-[11px] text-slate-500">{formatClockFromIso(entry.checkinAt)}</div>
          )}
        </td>
        <td className="px-4 py-2.5 text-center">
          <CheckToggle
            checked={entry.volunteerCheckout}
            disabled={busy}
            onClick={() => onToggle(entry.volunteerName, "volunteerCheckout", !entry.volunteerCheckout)}
            ariaLabel={`Toggle volunteer check-out for ${entry.volunteerName}`}
          />
          {entry.checkoutAt && (
            <div className="mt-1 text-[11px] text-slate-500">{formatClockFromIso(entry.checkoutAt)}</div>
          )}
        </td>
        <td className="px-2 py-2.5 text-right">
          <div className="inline-flex items-center gap-0.5">
            <button
              onClick={startEdit}
              disabled={busy}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label={`Edit times for ${entry.volunteerName}`}
              title="Edit check-in / out times"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            <button
              onClick={() => onRemove(entry.volunteerName)}
              disabled={busy}
              className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
              aria-label={`Remove ${entry.volunteerName}`}
              title="Remove from event"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr className="bg-slate-50/70">
          <td colSpan={4} className="px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Check-in time
                </label>
                <input
                  type="datetime-local"
                  className="input py-1.5 text-sm"
                  value={inVal}
                  onChange={(e) => setInVal(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Check-out time
                </label>
                <input
                  type="datetime-local"
                  className="input py-1.5 text-sm"
                  value={outVal}
                  onChange={(e) => setOutVal(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={saveTimes} className="btn-primary py-1.5 text-sm" disabled={busy}>
                  Save times
                </button>
                <button onClick={onCancelEdit} className="btn-secondary py-1.5 text-sm" disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
            {timeError && (
              <p className="mt-2 text-[11px] font-medium text-red-600">{timeError}</p>
            )}
            <p className="mt-2 text-[11px] text-slate-400">
              Setting a time marks that side checked; hours = check-out − check-in.
              Clear a field to remove its time.
            </p>
          </td>
        </tr>
      )}
    </>
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
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition focus:outline-none focus:ring-2 focus:ring-offset-2 ${
        checked
          ? "border-transparent bg-emerald-500 text-white shadow focus:ring-emerald-500 hover:bg-emerald-600"
          : "border-slate-300 bg-white text-slate-400 hover:border-slate-400 hover:text-slate-600 focus:ring-slate-400"
      } disabled:cursor-not-allowed disabled:opacity-60`}
      title={checked ? "Checked — tap to clear" : "Not yet — tap to stamp now"}
    >
      {checked ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        // Neutral empty circle — "not yet", not an error.
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
          <circle cx="12" cy="12" r="7" strokeDasharray="2 2" />
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
