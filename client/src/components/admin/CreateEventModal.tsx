import { useEffect, useState } from "react";
import { EVENT_NAMES, OTHER_EVENT } from "../../data/events";
import { createEvent } from "../../api";
import type { VolunteerEvent } from "../../types";
import { todayYmd } from "../../utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (event: VolunteerEvent) => void;
}

export function CreateEventModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [customName, setCustomName] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setCustomName("");
      setDate(todayYmd());
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name) return setError("Please pick an event.");
    if (name === OTHER_EVENT && !customName.trim()) {
      return setError("Please specify the custom event name.");
    }
    if (!date) return setError("Please pick a date.");

    try {
      setSubmitting(true);
      const created = await createEvent({
        name,
        customName: name === OTHER_EVENT ? customName.trim() : null,
        date,
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create event.");
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
      <div
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-event-title"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 id="create-event-title" className="text-lg font-semibold text-slate-900">
              Create an Event
            </h2>
            <p className="text-sm text-slate-500">
              Pick from the master event list and assign a date.
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

        <form onSubmit={handleSubmit} className="px-6 py-5">
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="label" htmlFor="new-event-name">
                Event
              </label>
              <select
                id="new-event-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              >
                <option value="">Select an event…</option>
                {EVENT_NAMES.map((ev) => (
                  <option key={ev} value={ev}>
                    {ev}
                  </option>
                ))}
              </select>
            </div>

            {name === OTHER_EVENT && (
              <div>
                <label className="label" htmlFor="custom-event-name">
                  Custom Event Name
                </label>
                <input
                  id="custom-event-name"
                  type="text"
                  className="input"
                  placeholder="e.g. Community fundraiser"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                />
              </div>
            )}

            <div>
              <label className="label" htmlFor="new-event-date">
                Date
              </label>
              <input
                id="new-event-date"
                type="date"
                className="input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

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
              {submitting ? "Creating…" : "Create Event"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
