import { useEffect, useMemo, useState } from "react";
import { VOLUNTEERS } from "../data/volunteers";
import { EVENT_NAMES, GRADES, OTHER_EVENT } from "../data/events";
import { createSubmission } from "../api";
import type { NewSubmission } from "../types";
import { formatHours, formatTime12h } from "../utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}

interface FormState {
  volunteerName: string;
  grade: string;
  eventName: string;
  customEventName: string;
  eventDate: string;
  arrivalTime: string;
  endTime: string;
  comments: string;
}

const EMPTY: FormState = {
  volunteerName: "",
  grade: "",
  eventName: "",
  customEventName: "",
  eventDate: new Date().toISOString().slice(0, 10),
  arrivalTime: "",
  endTime: "",
  comments: "",
};

export function SubmissionForm({ open, onClose, onSubmitted }: Props) {
  const [state, setState] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameQuery, setNameQuery] = useState("");
  const [showNameMenu, setShowNameMenu] = useState(false);

  useEffect(() => {
    if (open) {
      setState({ ...EMPTY, eventDate: new Date().toISOString().slice(0, 10) });
      setNameQuery("");
      setError(null);
    }
  }, [open]);

  // Close on Escape for keyboard accessibility.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filteredNames = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    if (!q) return VOLUNTEERS;
    return VOLUNTEERS.filter((n) => n.toLowerCase().includes(q));
  }, [nameQuery]);

  const computedHours = useMemo(() => {
    if (!state.arrivalTime || !state.endTime) return 0;
    const [aH, aM] = state.arrivalTime.split(":").map(Number);
    const [eH, eM] = state.endTime.split(":").map(Number);
    const minutes = eH * 60 + eM - (aH * 60 + aM);
    return minutes > 0 ? Math.round((minutes / 60) * 100) / 100 : 0;
  }, [state.arrivalTime, state.endTime]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!state.volunteerName) return setError("Please select your name.");
    if (!VOLUNTEERS.includes(state.volunteerName)) {
      return setError("Pick your name from the suggestions.");
    }
    if (!state.grade) return setError("Please select your grade.");
    if (!state.eventName) return setError("Please select an event.");
    if (state.eventName === OTHER_EVENT && !state.customEventName.trim()) {
      return setError("Please specify the event name.");
    }
    if (!state.eventDate) return setError("Please pick the event date.");
    if (!state.arrivalTime) return setError("Please enter your arrival time.");
    if (!state.endTime) return setError("Please enter your end time.");
    if (computedHours <= 0) {
      return setError("End time must be after arrival time.");
    }

    const payload: NewSubmission = {
      volunteerName: state.volunteerName,
      grade: state.grade,
      eventName: state.eventName,
      customEventName:
        state.eventName === OTHER_EVENT ? state.customEventName.trim() : null,
      eventDate: state.eventDate,
      arrivalTime: state.arrivalTime,
      endTime: state.endTime,
      comments: state.comments.trim(),
    };

    try {
      setSubmitting(true);
      await createSubmission(payload);
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Log Volunteer Hours
            </h2>
            <p className="text-sm text-slate-500">
              Sign in and out for an event you participated in.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost -mr-2"
            aria-label="Close form"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="max-h-[75vh] overflow-y-auto px-6 py-5"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="volunteer-name">
                Volunteer Name
              </label>
              <div className="relative">
                <input
                  id="volunteer-name"
                  type="text"
                  className="input"
                  placeholder="Start typing your name…"
                  value={
                    state.volunteerName ||
                    (showNameMenu ? nameQuery : nameQuery)
                  }
                  onChange={(e) => {
                    setNameQuery(e.target.value);
                    update("volunteerName", "");
                    setShowNameMenu(true);
                  }}
                  onFocus={() => setShowNameMenu(true)}
                  onBlur={() =>
                    // Delay so a click on the menu can register first.
                    setTimeout(() => setShowNameMenu(false), 150)
                  }
                  autoComplete="off"
                />
                {showNameMenu && filteredNames.length > 0 && (
                  <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                    {filteredNames.slice(0, 60).map((n) => (
                      <li key={n}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            update("volunteerName", n);
                            setNameQuery(n);
                            setShowNameMenu(false);
                          }}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-brand-50"
                        >
                          <span>{n}</span>
                          {state.volunteerName === n && (
                            <span className="text-brand-600">✓</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="grade">
                Grade
              </label>
              <select
                id="grade"
                className="input"
                value={state.grade}
                onChange={(e) => update("grade", e.target.value)}
              >
                <option value="">Select grade…</option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g} grade
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="event-date">
                Event Date
              </label>
              <input
                id="event-date"
                type="date"
                className="input"
                value={state.eventDate}
                onChange={(e) => update("eventDate", e.target.value)}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="label" htmlFor="event-name">
                Volunteer Event
              </label>
              <select
                id="event-name"
                className="input"
                value={state.eventName}
                onChange={(e) => update("eventName", e.target.value)}
              >
                <option value="">Select an event…</option>
                {EVENT_NAMES.map((ev) => (
                  <option key={ev} value={ev}>
                    {ev}
                  </option>
                ))}
              </select>
            </div>

            {state.eventName === OTHER_EVENT && (
              <div className="sm:col-span-2">
                <label className="label" htmlFor="custom-event">
                  Please specify the event
                </label>
                <input
                  id="custom-event"
                  type="text"
                  className="input"
                  placeholder="e.g. Community fundraiser"
                  value={state.customEventName}
                  onChange={(e) => update("customEventName", e.target.value)}
                />
              </div>
            )}

            <div>
              <label className="label" htmlFor="arrival">
                Arrival Time (Sign In)
              </label>
              <input
                id="arrival"
                type="time"
                className="input"
                value={state.arrivalTime}
                onChange={(e) => update("arrivalTime", e.target.value)}
              />
            </div>

            <div>
              <label className="label" htmlFor="end">
                End Time (Sign Out)
              </label>
              <input
                id="end"
                type="time"
                className="input"
                value={state.endTime}
                onChange={(e) => update("endTime", e.target.value)}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="label" htmlFor="comments">
                Comments (optional)
              </label>
              <textarea
                id="comments"
                className="input min-h-[88px] resize-y"
                placeholder="Anything else we should know about this service?"
                value={state.comments}
                onChange={(e) => update("comments", e.target.value)}
              />
            </div>
          </div>

          {(state.arrivalTime || state.endTime) && (
            <div className="mt-4 flex items-center justify-between rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3 text-sm">
              <div className="text-slate-600">
                {state.arrivalTime && state.endTime ? (
                  <>
                    <span className="font-medium text-slate-900">
                      {formatTime12h(state.arrivalTime)}
                    </span>{" "}
                    →{" "}
                    <span className="font-medium text-slate-900">
                      {formatTime12h(state.endTime)}
                    </span>
                  </>
                ) : (
                  <>Set both times to calculate hours.</>
                )}
              </div>
              <div className="font-semibold text-brand-700">
                {formatHours(computedHours)} hrs
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Spinner /> Submitting…
                </>
              ) : (
                <>Submit Hours</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
    </svg>
  );
}
