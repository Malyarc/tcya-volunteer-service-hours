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
      {/* Tzu Chi-inspired deep navy gradient with subtle lighting. */}
      <div className="absolute inset-0 bg-gradient-to-br from-brand-800 via-brand-700 to-brand-600" />
      <div
        className="absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            "radial-gradient(circle at 18% 15%, rgba(255,255,255,0.55) 0, transparent 40%), radial-gradient(circle at 82% 70%, rgba(245,197,88,0.35) 0, transparent 45%)",
        }}
      />
      <div className="relative mx-auto max-w-6xl px-6 pt-8 pb-10 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-4">
            <div className="inline-flex w-fit items-center rounded-xl bg-white px-3 py-2 shadow-lg shadow-brand-950/25 ring-1 ring-white/60">
              <img
                src="/tzu-chi-logo.png"
                alt="Buddhist Tzu Chi Foundation"
                className="h-10 w-auto sm:h-11"
              />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent-200/95">
                East Los Angeles · Tzu Chi Youth Association
              </div>
              <h1 className="mt-1 text-2xl font-bold leading-tight sm:text-[28px]">
                ELA TCYA Volunteer Service Hours
              </h1>
              <p className="mt-1 text-sm text-white/80">
                Sign in, log your service, walk the path of great love together.
              </p>
            </div>
          </div>
          <button
            onClick={onNewSubmission}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-brand-700 shadow-lg shadow-brand-950/20 transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-brand-700"
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
    <div className="rounded-xl bg-white/10 px-4 py-3 backdrop-blur-sm ring-1 ring-white/20">
      <div className="text-xs font-medium uppercase tracking-wider text-white/75">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
    </div>
  );
}
