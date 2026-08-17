import type { VolunteerRole } from "../types";

// The Officer badge shown to the right of a name on the roster, the Volunteers
// panel and an event's attendance list.
//
// Colour: a light sage green with a deeper green label. Green reads as
// "authorised / senior" without competing with the app's navy brand colour or
// with the amber "pending" and red "strike" states, so a row can carry an
// Officer badge and a warning at the same time and both stay readable.
//
// Officers are the volunteers whose hours are NOT capped at an event's expected
// hours — the badge is the visible half of that rule, so it appears anywhere the
// distinction changes what a number means.
export function RoleBadge({
  role,
  size = "md",
  className = "",
}: {
  role?: VolunteerRole;
  size?: "sm" | "md";
  className?: string;
}) {
  if (role !== "officer") return null;
  const dims =
    size === "sm"
      ? "px-1.5 py-0.5 text-[10px] gap-0.5"
      : "px-2 py-0.5 text-[11px] gap-1";
  return (
    <span
      title="Officer — sets up before and cleans up after events, so their hours are not capped at the event's expected hours."
      className={`inline-flex flex-none items-center rounded-full border border-emerald-300/70 bg-emerald-50 font-semibold uppercase tracking-wide text-emerald-700 ${dims} ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
        className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"}
      >
        <path d="M12 2.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 15.9 6.7 18.7l1.1-5.9L3.5 8.7l5.9-.8L12 2.5z" />
      </svg>
      Officer
    </span>
  );
}

// A volunteer's cumulative or per-event strike count. Neutral and quiet at 0 so
// a clean roster doesn't look like a wall of warnings; red once there is
// anything to see, and outlined red at the watchlist threshold.
export function StrikeCount({
  count,
  threshold = 3,
  className = "",
}: {
  count: number;
  threshold?: number;
  className?: string;
}) {
  const n = count || 0;
  if (n <= 0) {
    return (
      <span className={`text-sm text-slate-300 ${className}`} title="No strikes">
        —
      </span>
    );
  }
  const flagged = n >= threshold;
  return (
    <span
      title={`${n} strike${n === 1 ? "" : "s"}${flagged ? " — at or over the review threshold" : ""}`}
      className={`badge tabular-nums ${
        flagged
          ? "border border-red-300 bg-red-100 font-bold text-red-800"
          : "bg-red-50 font-semibold text-red-700"
      } ${className}`}
    >
      {n}
    </span>
  );
}
