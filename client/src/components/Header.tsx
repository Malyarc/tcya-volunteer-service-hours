interface HeaderProps {
  totalHours: number;
  totalSubmissions: number;
  activeVolunteers: number;
  isAdmin: boolean;
  onAdminLogin: () => void;
  onAdminLogout: () => void;
}

export function Header({
  totalHours,
  totalSubmissions,
  activeVolunteers,
  isAdmin,
  onAdminLogin,
  onAdminLogout,
}: HeaderProps) {
  return (
    <header className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-800 via-brand-700 to-brand-600" />
      <div
        className="absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            "radial-gradient(circle at 18% 15%, rgba(255,255,255,0.55) 0, transparent 40%), radial-gradient(circle at 82% 70%, rgba(245,197,88,0.35) 0, transparent 45%)",
        }}
      />

      {/* Top utility bar with admin login (left) and submit button (right). */}
      <div className="relative mx-auto flex max-w-6xl items-center justify-between px-6 pt-4 text-white">
        {!isAdmin ? (
          <button
            onClick={onAdminLogin}
            className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-white ring-1 ring-white/30 backdrop-blur-sm transition hover:bg-white/20"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Admin Login
          </button>
        ) : (
          <div className="inline-flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-300/95 px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-900 ring-1 ring-accent-200">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
              >
                <path d="M12 2L3 7v6c0 5 4 9 9 11 5-2 9-6 9-11V7l-9-5z" />
              </svg>
              Admin
            </span>
            <button
              onClick={onAdminLogout}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/90 ring-1 ring-white/30 backdrop-blur-sm transition hover:bg-white/20"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Sign Out
            </button>
          </div>
        )}
      </div>

      <div className="relative mx-auto max-w-6xl px-6 pt-5 pb-10 text-white">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-5">
            <div className="flex items-center justify-center rounded-2xl bg-white px-3 py-2 shadow-lg shadow-brand-950/25 ring-1 ring-white/60">
              <img
                src="/tzu-chi-logo.png"
                alt="Buddhist Tzu Chi Foundation"
                className="h-14 w-auto sm:h-16"
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
                Tracking our volunteers' service hours, walking the path of great
                love together.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Total Hours Logged" value={totalHours.toFixed(1)} />
          <StatCard label="Service Records" value={totalSubmissions.toString()} />
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
