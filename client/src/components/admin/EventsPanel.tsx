import { useMemo } from "react";
import type { VolunteerEvent } from "../../types";
import { formatDate, getEventDisplayName } from "../../utils";

interface Props {
  events: VolunteerEvent[];
  onCreate: () => void;
  onOpenEvent: (eventId: string) => void;
}

export function EventsPanel({ events, onCreate, onOpenEvent }: Props) {
  // Upcoming first (date asc), then past (date desc).
  const sorted = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = events
      .filter((e) => e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    const past = events
      .filter((e) => e.date < today)
      .sort((a, b) => b.date.localeCompare(a.date));
    return [...upcoming, ...past];
  }, [events]);

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Events</h2>
            <span className="badge bg-accent-100 text-accent-700">Admin</span>
          </div>
          <p className="text-sm text-slate-500">
            Create events and manage attendance lists.
          </p>
        </div>
        <button onClick={onCreate} className="btn-primary">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Create Event
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50/70">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                Date
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                Event
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                Attendees
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                Status
              </th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-10 text-center text-sm text-slate-500"
                >
                  No events yet — click <strong>Create Event</strong> to add one.
                </td>
              </tr>
            )}
            {sorted.map((ev) => {
              const today = new Date().toISOString().slice(0, 10);
              const isUpcoming = ev.date >= today;
              const total = ev.attendance?.length ?? 0;
              const confirmed =
                ev.attendance?.filter(
                  (a) => a.staffCheckin && a.volunteerCheckout
                ).length ?? 0;
              return (
                <tr
                  key={ev.id}
                  onClick={() => onOpenEvent(ev.id)}
                  className="cursor-pointer transition hover:bg-brand-50/40"
                >
                  <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-700">
                    {formatDate(ev.date)}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    {getEventDisplayName(ev)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                    {confirmed} / {total}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={`badge ${
                        isUpcoming
                          ? "bg-brand-100 text-brand-800"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {isUpcoming ? "Upcoming" : "Past"}
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
                      className="h-4 w-4"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
