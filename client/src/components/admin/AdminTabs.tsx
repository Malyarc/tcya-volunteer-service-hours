export type AdminTab = "roster" | "volunteers" | "events";

interface Props {
  active: AdminTab;
  onChange: (tab: AdminTab) => void;
  volunteerCount?: number;
  eventCount?: number;
}

// Sticky admin section switcher so the admin never has to scroll to reach the
// roster, the volunteer editor, or the events. Sized to be thumb-friendly on a
// phone/iPad (3 tabs fill the width) and tidy on desktop.
export function AdminTabs({ active, onChange, volunteerCount, eventCount }: Props) {
  const tabs: Array<{ key: AdminTab; label: string; count?: number; icon: JSX.Element }> = [
    {
      key: "roster",
      label: "Roster",
      icon: (
        <>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </>
      ),
    },
    {
      key: "volunteers",
      label: "Volunteers",
      count: volunteerCount,
      icon: (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="2" />
          <path d="M15 9h3M15 13h3M7 16h10" />
        </>
      ),
    },
    {
      key: "events",
      label: "Events",
      count: eventCount,
      icon: (
        <>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </>
      ),
    },
  ];

  return (
    <div className="sticky top-0 z-30 -mx-4 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="mx-auto flex max-w-6xl gap-1 py-2" role="tablist" aria-label="Admin sections">
        {tabs.map((t) => {
          const on = active === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => onChange(t.key)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                on
                  ? "bg-brand-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4.5 w-4.5 flex-none" style={{ width: 18, height: 18 }}>
                {t.icon}
              </svg>
              <span>{t.label}</span>
              {typeof t.count === "number" && (
                <span className={`hidden rounded-full px-1.5 py-0.5 text-[11px] font-bold sm:inline ${on ? "bg-white/20 text-white" : "bg-slate-200 text-slate-600"}`}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
