import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "./components/Header";
import { VolunteerTable } from "./components/VolunteerTable";
import { SubmissionForm } from "./components/SubmissionForm";
import { ExportButton } from "./components/ExportButton";
import { Toast } from "./components/Toast";
import { fetchSubmissions } from "./api";
import type { Submission } from "./types";
import { VOLUNTEERS } from "./data/volunteers";
import { buildSummaries } from "./utils";

export default function App() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchSubmissions();
      setSubmissions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-fetch when the tab becomes visible so users always see the latest
  // submissions even when other people have filled the form on another device.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const summaries = useMemo(
    () => buildSummaries(VOLUNTEERS, submissions),
    [submissions]
  );

  const totals = useMemo(() => {
    const totalHours =
      Math.round(
        summaries.reduce((a, s) => a + s.totalHours, 0) * 10
      ) / 10;
    const activeVolunteers = summaries.filter(
      (s) => s.submissions.length > 0
    ).length;
    return {
      totalHours,
      totalSubmissions: submissions.length,
      activeVolunteers,
    };
  }, [summaries, submissions.length]);

  return (
    <div className="min-h-full pb-12">
      <Header
        totalHours={totals.totalHours}
        totalSubmissions={totals.totalSubmissions}
        activeVolunteers={totals.activeVolunteers}
        onNewSubmission={() => setFormOpen(true)}
      />

      <main className="mx-auto -mt-6 max-w-6xl px-4 sm:px-6">
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
            Loading volunteer data…
          </div>
        ) : (
          <VolunteerTable summaries={summaries} />
        )}

        <ExportButton summaries={summaries} />

        <footer className="mt-4 text-center text-xs text-slate-400">
          Built for community service · Data lives on the host server.
        </footer>
      </main>

      <SubmissionForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmitted={async () => {
          setFormOpen(false);
          setToast("Hours submitted! Thank you for volunteering.");
          await refresh();
        }}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
