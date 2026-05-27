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
      <div className="relative mx-auto max-w-6xl px-6 pt-10 pb-12 text-white">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <LotusMark className="h-14 w-14 flex-none drop-shadow" />
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent-200/90">
                East Los Angeles · Tzu Chi Youth Association
              </div>
              <h1 className="mt-0.5 text-2xl font-bold leading-tight sm:text-[26px]">
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

// Stylized lotus emblem rendered in white-on-navy. The lotus is a generic
// symbol of compassion and is intentionally drawn differently from Tzu Chi's
// trademarked 8-petal-with-ship mark. To use the official chapter logo,
// replace the SVG below (or swap in an <img src="/logo.png" />).
function LotusMark({ className = "" }: { className?: string }) {
  return (
    <div
      className={`relative flex items-center justify-center rounded-2xl bg-white/95 ring-1 ring-white/60 shadow-lg shadow-brand-950/25 ${className}`}
    >
      <svg
        viewBox="0 0 64 64"
        className="h-[78%] w-[78%] text-brand-700"
        fill="currentColor"
        aria-hidden
      >
        {/* outer petals */}
        <path
          d="M32 11c4 6 6 11 6 16s-2 9-6 12c-4-3-6-7-6-12s2-10 6-16z"
          opacity="0.95"
        />
        <path
          d="M14 22c6 1 11 4 14 8s4 9 2 14c-5 0-10-3-13-7s-4-9-3-15z"
          opacity="0.85"
        />
        <path
          d="M50 22c-6 1-11 4-14 8s-4 9-2 14c5 0 10-3 13-7s4-9 3-15z"
          opacity="0.85"
        />
        <path
          d="M8 36c5-1 10 0 14 3s6 7 6 12c-5 1-10-1-14-4s-6-7-6-11z"
          opacity="0.7"
        />
        <path
          d="M56 36c-5-1-10 0-14 3s-6 7-6 12c5 1 10-1 14-4s6-7 6-11z"
          opacity="0.7"
        />
        {/* small heart at the center, evoking compassion and service */}
        <path
          d="M32 47.6c-.5 0-1-.2-1.4-.5-3.6-2.8-5.6-5.1-5.6-7.7 0-1.9 1.5-3.4 3.4-3.4 1.1 0 2.2.5 2.8 1.4.7-.9 1.7-1.4 2.8-1.4 1.9 0 3.4 1.5 3.4 3.4 0 2.6-2 4.9-5.6 7.7-.4.3-.9.5-1.4.5h-.4z"
          fill="#cf8e1d"
        />
      </svg>
    </div>
  );
}
