interface HeaderProps {
  totalHours: number;
  totalSubmissions: number;
  activeVolunteers: number;
  onNewSubmission: () => void;
}

export function Header({
  totalHours,
  totalSubmissions,
  activeVolunteers,
  onNewSubmission,
}: HeaderProps) {
  return (
    <header className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-600 via-brand-500 to-emerald-500" />
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.6) 0, transparent 35%), radial-gradient(circle at 80% 60%, rgba(255,255,255,0.4) 0, transparent 40%)",
        }}
      />
      <div className="relative mx-auto max-w-6xl px-6 pt-10 pb-12 text-white">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur ring-1 ring-white/30">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-7 w-7"
              >
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold leading-tight">
                Volunteer Hours Tracker
              </h1>
              <p className="text-sm text-white/85">
                Sign in, log your service, build a brighter community.
              </p>
            </div>
          </div>
          <button
            onClick={onNewSubmission}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-brand-700 shadow-lg shadow-emerald-900/10 transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-brand-600"
          >
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
            Log Volunteer Hours
          </button>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Total Hours Logged" value={totalHours.toFixed(1)} />
          <StatCard label="Submissions" value={totalSubmissions.toString()} />
          <StatCard
            label="Active Volunteers"
            value={activeVolunteers.toString()}
          />
        </div>
      </div>
    </header>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/15 px-4 py-3 backdrop-blur-sm ring-1 ring-white/25">
      <div className="text-xs font-medium uppercase tracking-wider text-white/80">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
    </div>
  );
}
