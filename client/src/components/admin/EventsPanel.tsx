import { useMemo, useState } from "react";
import type { Submission, VolunteerEvent } from "../../types";
import {
  eventHours,
  formatDate,
  formatHours,
  formatTime12h,
  getEventDisplayName,
  groupEventsByName,
  isCollapsibleGroup,
  moveItem,
  todayYmd,
  type EventGroup,
} from "../../utils";
import { saveEventOrder, updateEvent } from "../../api";
import {
  expectedHoursToInput,
  parseExpectedHoursInput,
  ExpectedHoursHint,
} from "./eventFields";

interface Props {
  events: VolunteerEvent[];
  submissions: Submission[];
  // The saved section order (names, in display order). Empty = automatic.
  eventOrder: string[];
  onCreate: () => void;
  onOpenEvent: (eventId: string) => void;
  onEventUpdated: (next: VolunteerEvent) => void;
  onEventOrderChanged: (names: string[]) => void;
  // Officers open events to scan; they never edit one. In read-only mode every
  // control that would mutate an event is absent, not just disabled — the
  // server enforces the same rule, this keeps the page honest about it.
  readOnly?: boolean;
}

// The column grid, declared once so the header and every row stay aligned.
//
// It engages at `md` (768px), NOT `sm`: six columns of dates, times, expected
// hours, attendance and actions genuinely do not fit in 640px without clipping
// the trailing controls. Below that each occurrence becomes a stacked card with
// its own labels, which is the better phone layout anyway.
const GRID =
  "md:grid md:grid-cols-[minmax(7.5rem,1.3fr)_5rem_5rem_6.5rem_5rem_auto] md:items-center md:gap-x-3";

export function EventsPanel({
  events,
  submissions,
  eventOrder,
  onCreate,
  onOpenEvent,
  onEventUpdated,
  onEventOrderChanged,
  readOnly = false,
}: Props) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Index of the section being dragged, and the one it is hovering over.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const today = todayYmd();

  // One section per event NAME, each listing that event's dates, in the order
  // an admin dragged them into (anything unplaced keeps the automatic order and
  // follows below — so a brand-new event type still shows up immediately).
  const groups = useMemo(
    () => groupEventsByName(events, submissions, today, eventOrder),
    [events, submissions, today, eventOrder]
  );

  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => {
        if (g.name.toLowerCase().includes(q)) return g;
        const occurrences = g.occurrences.filter(
          (e) => formatDate(e.date).toLowerCase().includes(q) || e.date.includes(q)
        );
        return occurrences.length > 0 ? { ...g, occurrences } : null;
      })
      .filter((g): g is EventGroup => g !== null);
  }, [groups, query]);

  const totals = useMemo(
    () => ({
      types: groups.length,
      occurrences: groups.reduce((n, g) => n + g.totalOccurrences, 0),
      upcoming: groups.reduce((n, g) => n + g.upcomingCount, 0),
      hours: Math.round(groups.reduce((n, g) => n + g.totalHours, 0) * 100) / 100,
    }),
    [groups]
  );

  // Reordering acts on the FULL list by index, so it is only offered when the
  // full list is what's on screen: a search shows a subset, and saving that
  // subset would silently drop every filtered-out section from the order.
  const searching = query.trim().length > 0;
  const canReorder = !readOnly && !searching && groups.length > 1;

  // Only sections with more than one date collapse — a section holding a single
  // event has nothing to hide behind a dropdown (see isCollapsibleGroup).
  const collapsibleGroups = visibleGroups.filter(isCollapsibleGroup);
  const allCollapsed =
    collapsibleGroups.length > 0 &&
    collapsibleGroups.every((g) => collapsed.has(g.name));

  function toggleGroup(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll() {
    setCollapsed(
      allCollapsed
        ? new Set()
        : new Set(groups.filter(isCollapsibleGroup).map((g) => g.name))
    );
  }

  // Persist a new section order for EVERYONE. Optimistic: the page reorders
  // immediately and rolls back if the save fails, so a dropped request can
  // never leave the screen disagreeing with the database.
  async function commitOrder(names: string[]) {
    const previous = eventOrder;
    onEventOrderChanged(names);
    setError(null);
    try {
      setSavingOrder(true);
      const saved = await saveEventOrder(names);
      onEventOrderChanged(saved.map((r) => r.name));
    } catch (err) {
      onEventOrderChanged(previous);
      setError(
        err instanceof Error
          ? `Could not save the new order — ${err.message}`
          : "Could not save the new order."
      );
    } finally {
      setSavingOrder(false);
    }
  }

  function moveGroup(from: number, to: number) {
    if (!canReorder) return;
    if (to < 0 || to >= groups.length || to === from) return;
    commitOrder(moveItem(groups, from, to).map((g) => g.name));
  }

  function handleDrop(target: number) {
    const from = dragIndex;
    setDragIndex(null);
    setDropIndex(null);
    if (from === null) return;
    moveGroup(from, target);
  }

  // The order is custom when the saved list actually places a section that is
  // on screen — that's what "Reset to automatic order" would undo.
  const hasCustomOrder =
    eventOrder.length > 0 && groups.some((g) => eventOrder.includes(g.name));

  return (
    <section className="space-y-4">
      {/* ---- Page header + roll-up ---- */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Events</h2>
              <span
                className={`badge ${
                  readOnly
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-accent-100 text-accent-700"
                }`}
              >
                {readOnly ? "Officer" : "Admin"}
              </span>
            </div>
            <p className="text-sm text-slate-500">
              {readOnly
                ? "Open an event to scan volunteers in and out. Only an admin can change an event."
                : "Each event type has its own section listing every date it ran. Edit a date, its times or its expected hours right here."}
            </p>
          </div>
          {!readOnly && (
            <button onClick={onCreate} className="btn-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Create Event
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-4">
          <Stat label="Event Types" value={String(totals.types)} />
          <Stat label="Total Dates" value={String(totals.occurrences)} />
          <Stat label="Upcoming" value={String(totals.upcoming)} tone="brand" />
          <Stat label="Hours Credited" value={formatHours(totals.hours)} tone="green" />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-5 py-3">
          <div className="relative flex-1 sm:max-w-xs">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              aria-label="Search events by name or date"
              placeholder="Search event or date…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input pl-9"
            />
          </div>
          {collapsibleGroups.length > 1 && (
            <button
              onClick={toggleAll}
              className="text-xs font-semibold text-brand-700 hover:text-brand-900"
            >
              {allCollapsed ? "Expand all" : "Collapse all"}
            </button>
          )}
          {canReorder && hasCustomOrder && (
            <button
              onClick={() => commitOrder([])}
              disabled={savingOrder}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-50"
              title="Go back to sorting by soonest upcoming date"
            >
              Reset order
            </button>
          )}
        </div>

        {canReorder && (
          <p className="border-t border-slate-100 bg-slate-50/60 px-5 py-2 text-xs text-slate-500">
            <span className="font-semibold text-slate-600">Tip:</span> drag a
            section by its handle — or use the arrows — to set the order of the
            list. The order is saved for everyone.
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ---- One section per event type ---- */}
      {visibleGroups.length === 0 ? (
        <div className="card px-5 py-12 text-center text-sm text-slate-500">
          {events.length === 0 ? (
            readOnly ? (
              "No events yet — an admin needs to create one before you can scan."
            ) : (
              <>
                No events yet — click <strong>Create Event</strong> to add one.
              </>
            )
          ) : (
            "No events match your search."
          )}
        </div>
      ) : (
        visibleGroups.map((group, index) => {
          const collapsible = isCollapsibleGroup(group);
          const isCollapsed = collapsible && collapsed.has(group.name);
          const isDropTarget =
            canReorder && dragIndex !== null && dropIndex === index && dragIndex !== index;
          return (
            <section
              key={group.name}
              onDragOver={(e) => {
                if (!canReorder || dragIndex === null) return;
                e.preventDefault();
                setDropIndex(index);
              }}
              onDrop={(e) => {
                if (!canReorder) return;
                e.preventDefault();
                handleDrop(index);
              }}
              className={`card overflow-hidden transition ${
                isDropTarget ? "ring-2 ring-brand-400" : ""
              } ${canReorder && dragIndex === index ? "opacity-60" : ""}`}
            >
              <GroupHeader
                group={group}
                collapsible={collapsible}
                collapsed={isCollapsed}
                onToggle={() => toggleGroup(group.name)}
                reorder={
                  canReorder
                    ? {
                        index,
                        total: groups.length,
                        busy: savingOrder,
                        onMoveUp: () => moveGroup(index, index - 1),
                        onMoveDown: () => moveGroup(index, index + 1),
                        onDragStart: () => {
                          setDragIndex(index);
                          setDropIndex(index);
                        },
                        onDragEnd: () => {
                          setDragIndex(null);
                          setDropIndex(null);
                        },
                      }
                    : null
                }
              />

              {!isCollapsed && (
                <div>
                  {/* Column headings — Date, Start, End, Expected Hours, in the
                      same order as the create-event form. */}
                  <div
                    className={`hidden border-y border-slate-100 bg-slate-50/70 px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 ${GRID}`}
                  >
                    <div>Date</div>
                    <div>Start</div>
                    <div>End</div>
                    <div>Expected Hrs</div>
                    <div>Checked In</div>
                    <div className="text-right">{readOnly ? "" : "Actions"}</div>
                  </div>

                  <ul className="divide-y divide-slate-100">
                    {group.occurrences.map((ev) => (
                      <li key={ev.id}>
                        <OccurrenceRow
                          event={ev}
                          today={today}
                          hours={eventHours(ev, submissions, events)}
                          readOnly={readOnly}
                          editing={editingId === ev.id}
                          onEdit={() => {
                            setError(null);
                            setEditingId(ev.id);
                          }}
                          onCancel={() => setEditingId(null)}
                          onOpen={() => onOpenEvent(ev.id)}
                          onSaved={(next) => {
                            onEventUpdated(next);
                            setEditingId(null);
                          }}
                          onError={setError}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          );
        })
      )}

      <div className="px-1">
        <ExpectedHoursHint />
      </div>
    </section>
  );
}

interface ReorderControls {
  index: number;
  total: number;
  busy: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

function GroupHeader({
  group,
  collapsible,
  collapsed,
  onToggle,
  reorder,
}: {
  group: EventGroup;
  collapsible: boolean;
  collapsed: boolean;
  onToggle: () => void;
  reorder: ReorderControls | null;
}) {
  // The summary line is identical whether or not the section can collapse, so
  // it lives here once and is wrapped in a button only when there is something
  // to toggle.
  const summary = (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-slate-900">{group.name}</h3>
        {group.upcomingCount > 0 && (
          <span className="badge bg-brand-100 text-brand-800">
            {group.upcomingCount} upcoming
          </span>
        )}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
        <span>
          {group.totalOccurrences} date{group.totalOccurrences === 1 ? "" : "s"}
        </span>
        <span aria-hidden>·</span>
        <span>{group.totalConfirmed} of {group.totalAttendees} checked in</span>
        <span aria-hidden>·</span>
        <span className="font-medium text-brand-700">
          {formatHours(group.totalHours)} hrs credited
        </span>
        {group.nextDate && (
          <>
            <span aria-hidden>·</span>
            <span>Next {formatDate(group.nextDate)}</span>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex items-stretch">
      {reorder && (
        <div className="flex flex-none items-center gap-0.5 border-r border-slate-100 py-2 pl-2 pr-1.5">
          {/* Drag handle (desktop) — the arrows below are the same action, and
              are what actually works on a phone or with a keyboard. */}
          <span
            draggable
            onDragStart={reorder.onDragStart}
            onDragEnd={reorder.onDragEnd}
            aria-hidden
            title="Drag to reorder"
            className="cursor-grab select-none rounded-md p-1.5 text-slate-300 transition hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
              <circle cx="9" cy="6" r="1.6" />
              <circle cx="15" cy="6" r="1.6" />
              <circle cx="9" cy="12" r="1.6" />
              <circle cx="15" cy="12" r="1.6" />
              <circle cx="9" cy="18" r="1.6" />
              <circle cx="15" cy="18" r="1.6" />
            </svg>
          </span>
          <div className="flex flex-col">
            <button
              type="button"
              onClick={reorder.onMoveUp}
              disabled={reorder.busy || reorder.index === 0}
              aria-label={`Move ${group.name} up`}
              title="Move up"
              className="rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <path d="m18 15-6-6-6 6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={reorder.onMoveDown}
              disabled={reorder.busy || reorder.index === reorder.total - 1}
              aria-label={`Move ${group.name} down`}
              title="Move down"
              className="rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex flex-1 items-center gap-3 px-5 py-3.5 text-left transition hover:bg-brand-50/40 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-400"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className={`h-4 w-4 flex-none text-slate-400 transition-transform ${collapsed ? "" : "rotate-90"}`}
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          {summary}
        </button>
      ) : (
        // A single date has nothing to collapse, so this is a plain heading —
        // no chevron, nothing to click that does nothing.
        <div className="flex flex-1 items-center gap-3 px-5 py-3.5">{summary}</div>
      )}
    </div>
  );
}

function OccurrenceRow({
  event,
  today,
  hours,
  readOnly,
  editing,
  onEdit,
  onCancel,
  onOpen,
  onSaved,
  onError,
}: {
  event: VolunteerEvent;
  today: string;
  hours: number;
  readOnly: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onOpen: () => void;
  onSaved: (next: VolunteerEvent) => void;
  onError: (msg: string | null) => void;
}) {
  const isUpcoming = event.date >= today;
  const total = event.attendance?.length ?? 0;
  const confirmed =
    event.attendance?.filter((a) => a.staffCheckin && a.volunteerCheckout).length ?? 0;

  if (editing) {
    return (
      <InlineEditor
        event={event}
        onCancel={onCancel}
        onSaved={onSaved}
        onError={onError}
      />
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${getEventDisplayName(event)} on ${formatDate(event.date)}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`w-full cursor-pointer px-5 py-3 text-sm transition hover:bg-brand-50/40 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-400 ${GRID}`}
    >
      {/* Date */}
      <div className="flex items-center gap-2 font-medium text-slate-900">
        {formatDate(event.date)}
        {isUpcoming && (
          <span className="badge flex-none bg-brand-100 text-[10px] text-brand-800 lg:hidden">
            Upcoming
          </span>
        )}
      </div>

      {/* On phones the remaining columns become labelled pairs. */}
      <Cell label="Start">{event.startTime ? formatTime12h(event.startTime) : <Dash />}</Cell>
      <Cell label="End">{event.endTime ? formatTime12h(event.endTime) : <Dash />}</Cell>
      <Cell label="Expected Hrs">
        {event.expectedHours === null ? (
          <span className="text-slate-400">No cap</span>
        ) : (
          <span className="font-medium text-slate-700">
            {formatHours(event.expectedHours)} hrs
          </span>
        )}
      </Cell>
      <Cell label="Checked In">
        <span className="tabular-nums text-slate-700">
          {confirmed} / {total}
        </span>
      </Cell>

      <div className="mt-2 flex items-center justify-between gap-2 md:mt-0 md:justify-end">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 md:hidden">
            {formatHours(hours)} hrs credited
          </span>
          <span
            className={`badge hidden lg:inline-flex ${
              isUpcoming ? "bg-brand-100 text-brand-800" : "bg-slate-100 text-slate-600"
            }`}
          >
            {isUpcoming ? "Upcoming" : "Past"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {!readOnly && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              aria-label={`Edit ${getEventDisplayName(event)} on ${formatDate(event.date)}`}
              title="Edit date, times and expected hours"
              className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          )}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4 flex-none text-slate-300">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </div>
      </div>
    </div>
  );
}

// The inline row editor. Every column an admin can see on this page is editable
// here, without leaving the page or opening a modal.
function InlineEditor({
  event,
  onCancel,
  onSaved,
  onError,
}: {
  event: VolunteerEvent;
  onCancel: () => void;
  onSaved: (next: VolunteerEvent) => void;
  onError: (msg: string | null) => void;
}) {
  const [date, setDate] = useState(event.date);
  const [startTime, setStartTime] = useState(event.startTime || "");
  const [endTime, setEndTime] = useState(event.endTime || "");
  const [expected, setExpected] = useState(expectedHoursToInput(event.expectedHours));
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function save() {
    setLocalError(null);
    if (!date) {
      setLocalError("A date is required.");
      return;
    }
    if (startTime && endTime && endTime <= startTime) {
      setLocalError("End time must be after the start time.");
      return;
    }
    const parsed = parseExpectedHoursInput(expected);
    if (!parsed.ok) {
      setLocalError(parsed.error);
      return;
    }
    try {
      setBusy(true);
      onError(null);
      const next = await updateEvent(event.id, {
        date,
        startTime,
        endTime,
        expectedHours: parsed.value,
      });
      onSaved(next);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save the event.");
      setBusy(false);
    }
  }

  // Deliberately a wrapping flex row rather than the read-only GRID: four inputs
  // plus Save/Cancel need more width than four values, and a fixed grid would
  // clip the buttons on a narrow tablet instead of wrapping them.
  return (
    <div className="bg-brand-50/40 px-5 py-3 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <FieldCell label="Date" className="min-w-[9rem] flex-1">
          <input
            type="date"
            aria-label="Event date"
            className="input py-1.5 text-sm"
            value={date}
            disabled={busy}
            onChange={(e) => setDate(e.target.value)}
          />
        </FieldCell>
        <FieldCell label="Start" className="w-28">
          <input
            type="time"
            aria-label="Start time"
            className="input px-2 py-1.5 text-sm"
            value={startTime}
            disabled={busy}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </FieldCell>
        <FieldCell label="End" className="w-28">
          <input
            type="time"
            aria-label="End time"
            className="input px-2 py-1.5 text-sm"
            value={endTime}
            disabled={busy}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </FieldCell>
        <FieldCell label="Expected Hrs" className="w-28">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            max="24"
            step="0.25"
            placeholder="No cap"
            aria-label="Expected volunteer hours"
            className="input px-2 py-1.5 text-sm"
            value={expected}
            disabled={busy}
            onChange={(e) => setExpected(e.target.value)}
          />
        </FieldCell>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={save} className="btn-primary px-3 py-1.5 text-xs" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button onClick={onCancel} className="btn-secondary px-3 py-1.5 text-xs" disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
      {localError && (
        <p className="mt-2 text-xs font-medium text-red-600">{localError}</p>
      )}
    </div>
  );
}

// A read-only cell: a plain grid cell on md+, a labelled row on phones.
function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-1 flex items-baseline justify-between gap-2 md:mt-0 md:block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400 md:hidden">
        {label}
      </span>
      <span className="text-slate-700">{children}</span>
    </div>
  );
}

// The editable equivalent. Its label is ALWAYS shown: once the fields wrap there
// is no column heading above them to rely on.
function FieldCell({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </span>
      {children}
    </div>
  );
}

function Dash() {
  return <span className="text-slate-300">—</span>;
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "brand" | "green";
}) {
  const palette =
    tone === "green"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-100"
      : tone === "brand"
        ? "bg-brand-50 text-brand-800 ring-brand-100"
        : "bg-slate-50 text-slate-800 ring-slate-100";
  return (
    <div className={`rounded-xl px-3 py-2 ring-1 ${palette}`}>
      <div className="text-[11px] font-medium uppercase tracking-wider opacity-70">
        {label}
      </div>
      <div className="mt-0.5 text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
