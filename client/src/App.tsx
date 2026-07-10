import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "./components/Header";
import { VolunteerTable } from "./components/VolunteerTable";
import { ExportButton } from "./components/ExportButton";
import { Toast } from "./components/Toast";
import { AdminLoginModal } from "./components/AdminLoginModal";
import { PasscodeGate } from "./components/PasscodeGate";
import { EventsPanel } from "./components/admin/EventsPanel";
import { CreateEventModal } from "./components/admin/CreateEventModal";
import { EventDetailPage } from "./components/admin/EventDetailPage";
import { VolunteersPanel } from "./components/admin/VolunteersPanel";
import { AdminTabs, type AdminTab } from "./components/admin/AdminTabs";
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
  // Remember the last admin tab across reloads so a freshly created event isn't
  // hidden behind the default "roster" tab after a refresh.
  const [adminTab, setAdminTab] = useState<AdminTab>(() => {
    try {
      const saved = sessionStorage.getItem("ela-tcya-admin-tab");
      if (saved === "roster" || saved === "volunteers" || saved === "events") {
        return saved;
      }
    } catch {
      /* sessionStorage unavailable */
    }
    return "roster";
  });

  const [adminLoginOpen, setAdminLoginOpen] = useState(false);
  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // Load each dataset independently: a transient failure of ONE fetch (e.g. a
    // cold-start 500 on /submissions) must not discard a successful /events
    // load and blank the events panel — that made persisted data look "wiped."
    const [subsR, evsR, rosR] = await Promise.allSettled([
      fetchSubmissions(),
      fetchEvents(),
      fetchRoster(),
    ]);
    if (subsR.status === "fulfilled") setSubmissions(subsR.value);
    if (evsR.status === "fulfilled") setEvents(evsR.value);
    if (rosR.status === "fulfilled") setRoster(rosR.value);
    const anyFailed = [subsR, evsR, rosR].some((r) => r.status === "rejected");
    setError(
      anyFailed
        ? "Some data couldn't be refreshed just now — showing the most recent data. Retrying may help."
        : null
    );
    setLoading(false);
  }, []);

  const refreshVolunteers = useCallback(async () => {
    try {
      setVolunteers(await fetchVolunteers());
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isAdmin) {
      setVolunteers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const status = await checkAdminSession();
      if (cancelled) return;
      // Only log out on a CONFIRMED non-admin (explicit 401/403). A transient
      // "unknown" (cold-start 5xx / network blip) keeps the session so the admin
      // isn't spuriously ejected — which looked like "everything got wiped."
      if (status === false) {
        clearAdminToken();
        setIsAdmin(false);
      } else {
        refreshVolunteers();
        // Re-fetch events WITH the admin token so the admin sees the full
        // attendance (check-in/out times) rather than the public-stripped copy.
        refresh();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, refreshVolunteers, refresh]);

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

  // If a request 401s and clears the stored token, drop the admin UI + reset to
  // the roster so the admin isn't stranded in a broken, tokenless admin state.
  useEffect(() => {
    function onCleared() {
      setIsAdmin((was) => {
        if (was) {
          setView({ kind: "home" });
          setAdminTab("roster");
          setToast("Your admin session ended — please sign in again.");
        }
        return false;
      });
    }
    window.addEventListener("ela-tcya-token-cleared", onCleared);
    return () => window.removeEventListener("ela-tcya-token-cleared", onCleared);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem("ela-tcya-admin-tab", adminTab);
    } catch {
      /* sessionStorage unavailable */
    }
  }, [adminTab]);

  const rosterNames = useMemo(() => roster.map((r) => r.name), [roster]);

  const summaries = useMemo(
    () => buildSummaries(roster, submissions, events),
    [roster, submissions, events]
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

  useEffect(() => {
    if (view.kind === "event" && !loading && !currentEvent) {
      setView({ kind: "home" });
    }
  }, [view, currentEvent, loading]);

  function handleAdminLogout() {
    clearAdminToken();
    setIsAdmin(false);
    setView({ kind: "home" });
    setAdminTab("roster");
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

  const showRoster = !isAdmin || adminTab === "roster";

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
        />

        {isAdmin && view.kind === "home" && (
          <AdminTabs
            active={adminTab}
            onChange={setAdminTab}
            volunteerCount={volunteers.length}
            eventCount={events.length}
          />
        )}

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
                setEvents((prev) => prev.filter((e) => e.id !== currentEvent.id));
                setView({ kind: "home" });
                setToast("Event deleted.");
                refresh();
              }}
            />
          ) : (
            <>
              {showRoster && (
                <>
                  <VolunteerTable summaries={summaries} isAdmin={isAdmin} />
                  {isAdmin && <ExportButton summaries={summaries} />}
                </>
              )}
              {isAdmin && adminTab === "volunteers" && (
                <VolunteersPanel
                  volunteers={volunteers}
                  onChanged={handleVolunteersChanged}
                  onToast={setToast}
                />
              )}
              {isAdmin && adminTab === "events" && (
                <EventsPanel
                  events={events}
                  onCreate={() => setCreateEventOpen(true)}
                  onOpenEvent={(id) => setView({ kind: "event", eventId: id })}
                />
              )}
            </>
          )}

          <footer className="mt-4 text-center text-xs text-slate-500">
            ELA TCYA Volunteer Service Hours · Built with great love 大愛
          </footer>
        </main>

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
