import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "./components/Header";
import { VolunteerTable } from "./components/VolunteerTable";
import { ExportButton } from "./components/ExportButton";
import { Toast } from "./components/Toast";
import { LoginModal } from "./components/LoginModal";
import { PasscodeGate } from "./components/PasscodeGate";
import { EventsPanel } from "./components/admin/EventsPanel";
import { CreateEventModal } from "./components/admin/CreateEventModal";
import { EventDetailPage } from "./components/admin/EventDetailPage";
import { VolunteersPanel } from "./components/admin/VolunteersPanel";
import { AdminTabs, ALLOWED_TABS, type AdminTab } from "./components/admin/AdminTabs";
import {
  checkSession,
  fetchEventOrder,
  fetchEvents,
  fetchRoster,
  fetchSubmissions,
  fetchVolunteers,
} from "./api";
import { clearSession, getAccountRole } from "./auth";
import type {
  AccountRole,
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
  // The admin-defined order of the Events page sections (names, in order).
  const [eventOrder, setEventOrder] = useState<string[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  // Whether the FIRST admin volunteers fetch has completed. Prevents the
  // Volunteers panel from flashing "No volunteers yet" (looks wiped) before the
  // roster has loaded, since volunteers load a round-trip after the public data.
  const [volunteersLoaded, setVolunteersLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Which account is signed in: "admin" (everything), "officer" (open an event
  // and scan volunteers in/out, nothing else) or null (the public view).
  const [role, setRole] = useState<AccountRole | null>(() => getAccountRole());
  const isAdmin = role === "admin";
  const isOfficer = role === "officer";
  const [view, setView] = useState<View>({ kind: "home" });
  // Remember the last tab across reloads so a freshly created event isn't
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

  const [loginOpen, setLoginOpen] = useState(false);
  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // Load each dataset independently: a transient failure of ONE fetch (e.g. a
    // cold-start 500 on /submissions) must not discard a successful /events
    // load and blank the events panel — that made persisted data look "wiped."
    const [subsR, evsR, rosR, orderR] = await Promise.allSettled([
      fetchSubmissions(),
      fetchEvents(),
      fetchRoster(),
      fetchEventOrder(),
    ]);
    if (subsR.status === "fulfilled") setSubmissions(subsR.value);
    if (evsR.status === "fulfilled") setEvents(evsR.value);
    if (rosR.status === "fulfilled") setRoster(rosR.value);
    if (orderR.status === "fulfilled") {
      setEventOrder(orderR.value.map((r) => r.name));
    }
    const anyFailed = [subsR, evsR, rosR, orderR].some(
      (r) => r.status === "rejected"
    );
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
    } finally {
      setVolunteersLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!role) {
      setVolunteers([]);
      setVolunteersLoaded(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const status = await checkSession();
      if (cancelled) return;
      // Only sign out on a CONFIRMED signed-out response (explicit 401/403). A
      // transient "unknown" (cold-start 5xx / network blip) keeps the session so
      // nobody is spuriously ejected — which looked like "everything got wiped."
      if (status === null) {
        clearSession();
        setRole(null);
      } else {
        if (status !== "unknown" && status !== role) setRole(status);
        // The volunteer roster with contact details is admin-only; asking for it
        // as an officer would just 403.
        if (status === "admin") refreshVolunteers();
        // Re-fetch events WITH the token so the signed-in view shows the full
        // attendance (check-in/out times) rather than the public-stripped copy.
        refresh();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role, refreshVolunteers, refresh]);

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

  // If a request 401s and clears the stored token, drop the privileged UI +
  // reset to the roster so nobody is stranded in a broken, tokenless state.
  useEffect(() => {
    function onCleared() {
      setRole((was) => {
        if (was) {
          setView({ kind: "home" });
          setAdminTab("roster");
          setToast("Your session ended — please sign in again.");
        }
        return null;
      });
    }
    window.addEventListener("ela-tcya-token-cleared", onCleared);
    return () => window.removeEventListener("ela-tcya-token-cleared", onCleared);
  }, []);

  // Keep the active tab valid for the CURRENT account: an officer restoring a
  // session that last sat on the Volunteers tab must not land on a tab they are
  // not allowed to open.
  useEffect(() => {
    if (!role) return;
    if (!ALLOWED_TABS(role).includes(adminTab)) setAdminTab("events");
  }, [role, adminTab]);

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

  function handleLogout() {
    clearSession();
    setRole(null);
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

  const showRoster = !role || adminTab === "roster";

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
          role={role}
          onLogin={() => setLoginOpen(true)}
          onLogout={handleLogout}
        />

        {role && view.kind === "home" && (
          <AdminTabs
            active={adminTab}
            onChange={setAdminTab}
            role={role}
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
              readOnly={isOfficer}
              // Officers record conduct strikes too: they run the door, so they
              // are the ones who witness the conduct. Everything else on this
              // page stays admin-only (see `readOnly`).
              canRecordStrikes={isAdmin || isOfficer}
              onEventUpdated={(next) =>
                setEvents((prev) =>
                  prev.map((e) => (e.id === next.id ? next : e))
                )
              }
              onHoursChanged={refresh}
              onBack={() => {
                // Re-pull the derived hours so the roster reflects everything
                // that just happened on this event (scans, time edits, cap).
                refresh();
                setView({ kind: "home" });
              }}
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
                  summaries={summaries}
                  loading={!volunteersLoaded}
                  onChanged={handleVolunteersChanged}
                  onToast={setToast}
                />
              )}
              {role && adminTab === "events" && (
                <EventsPanel
                  events={events}
                  submissions={submissions}
                  eventOrder={eventOrder}
                  readOnly={isOfficer}
                  onCreate={() => setCreateEventOpen(true)}
                  onOpenEvent={(id) => setView({ kind: "event", eventId: id })}
                  onEventOrderChanged={setEventOrder}
                  onEventUpdated={(next) => {
                    setEvents((prev) =>
                      prev.map((e) => (e.id === next.id ? next : e))
                    );
                    // Editing an event's expected hours re-derives everyone's
                    // credited hours server-side, so pull the submissions again.
                    refresh();
                  }}
                />
              )}
            </>
          )}

          <footer className="mt-4 text-center text-xs text-slate-500">
            ELA TCYA Volunteer Service Hours · Built with great love 大愛
          </footer>
        </main>

        <LoginModal
          open={loginOpen}
          onClose={() => setLoginOpen(false)}
          onLoggedIn={(nextRole) => {
            setLoginOpen(false);
            setRole(nextRole);
            // An officer signs in to run a door, so land them on the event list
            // rather than the roster.
            setAdminTab(nextRole === "officer" ? "events" : "roster");
            setToast(
              nextRole === "officer"
                ? "Welcome — pick an event, then scan."
                : "Welcome, admin."
            );
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
