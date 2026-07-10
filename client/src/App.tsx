import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "./components/Header";
import { VolunteerTable } from "./components/VolunteerTable";
import { SubmissionForm } from "./components/SubmissionForm";
import { ExportButton } from "./components/ExportButton";
import { Toast } from "./components/Toast";
import { AdminLoginModal } from "./components/AdminLoginModal";
import { PasscodeGate } from "./components/PasscodeGate";
import { EventsPanel } from "./components/admin/EventsPanel";
import { CreateEventModal } from "./components/admin/CreateEventModal";
import { EventDetailPage } from "./components/admin/EventDetailPage";
import { VolunteersPanel } from "./components/admin/VolunteersPanel";
import {
  checkAdminSession,
  fetchEvents,
  fetchRoster,
  fetchSubmissions,
  fetchVolunteers,
} from "./api";
import { clearAdminToken, isAdminLoggedIn } from "./auth";
import type {
  RosterEntry,
  Submission,
  Volunteer,
  VolunteerEvent,
} from "./types";
import { buildSummaries } from "./utils";

type View = { kind: "home" } | { kind: "event"; eventId: string };

const UNLOCK_KEY = "ela-tcya-app-unlocked";

export default function App() {
  // Soft front-door passcode gate. Stored in sessionStorage so it resets when
  // the tab closes but persists across reloads in the same session.
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(UNLOCK_KEY) === "true";
    } catch {
      return false;
    }
  });

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [events, setEvents] = useState<VolunteerEvent[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isAdmin, setIsAdmin] = useState<boolean>(() => isAdminLoggedIn());
  const [view, setView] = useState<View>({ kind: "home" });

  const [adminLoginOpen, setAdminLoginOpen] = useState(false);
  const [submissionFormOpen, setSubmissionFormOpen] = useState(false);
  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [subs, evs, ros] = await Promise.all([
        fetchSubmissions(),
        fetchEvents(),
        fetchRoster(),
      ]);
      setSubmissions(subs);
      setEvents(evs);
      setRoster(ros);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshVolunteers = useCallback(async () => {
    try {
      setVolunteers(await fetchVolunteers());
    } catch {
      // non-fatal — the admin panel simply shows what it has
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Validate the stored admin token on first load — clears stale tokens after
  // server restarts or password changes.
  useEffect(() => {
    if (!isAdmin) {
      setVolunteers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const ok = await checkAdminSession();
      if (cancelled) return;
      if (!ok) {
        clearAdminToken();
        setIsAdmin(false);
      } else {
        refreshVolunteers();
        // Re-fetch events WITH the admin token: a pre-login fetch returned the
        // publicEvent-stripped copy (no check-in/out times), and editing that
        // stale copy could otherwise wipe real timestamps.
        refresh();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, refreshVolunteers, refresh]);

  // Re-fetch when the tab becomes visible so users always see fresh data.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") {
        refresh();
        if (isAdmin) refreshVolunteers();
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh, refreshVolunteers, isAdmin]);

  const rosterNames = useMemo(() => roster.map((r) => r.name), [roster]);

  const summaries = useMemo(
    () => buildSummaries(rosterNames, submissions, events),
    [rosterNames, submissions, events]
  );

  const totals = useMemo(() => {
    const totalHours =
      Math.round(summaries.reduce((a, s) => a + s.totalHours, 0) * 10) / 10;
    const totalSubmissions = summaries.reduce(
      (a, s) => a + s.submissions.length,
      0
    );
    const activeVolunteers = summaries.filter(
      (s) => s.submissions.length > 0
    ).length;
    return { totalHours, totalSubmissions, activeVolunteers };
  }, [summaries]);

  const currentEvent = useMemo(() => {
    if (view.kind !== "event") return null;
    return events.find((e) => e.id === view.eventId) || null;
  }, [view, events]);

  // If the event we're viewing got deleted, fall back to home.
  useEffect(() => {
    if (view.kind === "event" && !loading && !currentEvent) {
      setView({ kind: "home" });
    }
  }, [view, currentEvent, loading]);

  function handleAdminLogout() {
    clearAdminToken();
    setIsAdmin(false);
    setView({ kind: "home" });
    setToast("Signed out.");
  }

  function handleUnlock() {
    try {
      sessionStorage.setItem(UNLOCK_KEY, "true");
    } catch {
      // sessionStorage may be unavailable in some private modes.
    }
    setUnlocked(true);
  }

  async function handleVolunteersChanged() {
    await Promise.all([refresh(), refreshVolunteers()]);
  }

  return (
    <div className="relative min-h-full pb-12">
      <div
        className={
          unlocked
            ? "min-h-full"
            : "min-h-full select-none blur-md pointer-events-none transition-[filter] duration-300"
        }
        aria-hidden={!unlocked}
      >
        <Header
          totalHours={totals.totalHours}
          totalSubmissions={totals.totalSubmissions}
          activeVolunteers={totals.activeVolunteers}
          isAdmin={isAdmin}
          onAdminLogin={() => setAdminLoginOpen(true)}
          onAdminLogout={handleAdminLogout}
          onNewSubmission={() => setSubmissionFormOpen(true)}
        />

        <main className="mx-auto mt-6 max-w-6xl space-y-6 px-4 sm:px-6">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
              <button
                onClick={refresh}
                className="ml-3 font-semibold underline-offset-2 hover:underline"
              >
                Try again
              </button>
            </div>
          )}

          {loading ? (
            <div className="card flex items-center justify-center px-6 py-16 text-slate-500">
              <svg
                className="mr-3 h-5 w-5 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="9" opacity="0.25" />
                <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
              </svg>
              Loading…
            </div>
          ) : view.kind === "event" && currentEvent ? (
            <EventDetailPage
              event={currentEvent}
              rosterNames={rosterNames}
              volunteers={volunteers}
              onBack={() => setView({ kind: "home" })}
              onEventUpdated={(next) =>
                setEvents((prev) =>
                  prev.map((e) => (e.id === next.id ? next : e))
                )
              }
              onEventDeleted={() => {
                setEvents((prev) =>
                  prev.filter((e) => e.id !== currentEvent.id)
                );
                setView({ kind: "home" });
                setToast("Event deleted.");
              }}
            />
          ) : (
            <>
              <VolunteerTable summaries={summaries} />
              {isAdmin && (
                <VolunteersPanel
                  volunteers={volunteers}
                  onChanged={handleVolunteersChanged}
                  onToast={setToast}
                />
              )}
              {isAdmin && (
                <EventsPanel
                  events={events}
                  onCreate={() => setCreateEventOpen(true)}
                  onOpenEvent={(id) => setView({ kind: "event", eventId: id })}
                />
              )}
              {isAdmin && <ExportButton summaries={summaries} />}
            </>
          )}

          <footer className="mt-4 text-center text-xs text-slate-500">
            ELA TCYA Volunteer Service Hours · Built with great love 大愛
          </footer>
        </main>

        <SubmissionForm
          open={submissionFormOpen}
          events={events}
          rosterNames={rosterNames}
          onClose={() => setSubmissionFormOpen(false)}
          onSubmitted={async () => {
            setSubmissionFormOpen(false);
            setToast("Hours submitted! Thank you for volunteering.");
            await refresh();
          }}
        />

        <AdminLoginModal
          open={adminLoginOpen}
          onClose={() => setAdminLoginOpen(false)}
          onLoggedIn={() => {
            setAdminLoginOpen(false);
            setIsAdmin(true);
            setToast("Welcome, admin.");
          }}
        />

        <CreateEventModal
          open={createEventOpen}
          onClose={() => setCreateEventOpen(false)}
          onCreated={(ev) => {
            setEvents((prev) => [...prev, ev]);
            setCreateEventOpen(false);
            setToast("Event created.");
            setView({ kind: "event", eventId: ev.id });
          }}
        />

        <Toast message={toast} onDismiss={() => setToast(null)} />
      </div>

      {!unlocked && <PasscodeGate onUnlock={handleUnlock} />}
    </div>
  );
}
