import type { VolunteerRole } from "../types";
import { isTcAcademyMember } from "../badges";

// Shared geometry so every badge in a row is the same height and the same
// distance from its neighbour. Two badges of different heights sitting side by
// side is the thing that makes a table row look broken, so the dimensions live
// in one place rather than being retyped per badge.
function badgeDims(size: "sm" | "md"): string {
  return size === "sm"
    ? "px-1.5 py-0.5 text-[10px] gap-0.5"
    : "px-2 py-0.5 text-[11px] gap-1";
}
function badgeIcon(size: "sm" | "md"): string {
  return size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3";
}

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
  return (
    <span
      title="Officer — sets up before and cleans up after events, so their hours are not capped at the event's expected hours."
      className={`inline-flex flex-none items-center rounded-full border border-emerald-300/70 bg-emerald-50 font-semibold uppercase tracking-wide text-emerald-700 ${badgeDims(size)} ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
        className={badgeIcon(size)}
      >
        <path d="M12 2.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 15.9 6.7 18.7l1.1-5.9L3.5 8.7l5.9-.8L12 2.5z" />
      </svg>
      Officer
    </span>
  );
}

// The TC Academy badge — a recognition label for students in the chapter's Tzu
// Chi Academy program (see badges.ts for the list).
//
// Colour: a light sky blue. It has to be distinct from THREE things already on
// screen — the navy `brand` palette used for hours and IDs, the emerald Officer
// badge, and the red strike states — so a row carrying an Officer badge, a
// TC Academy badge and a strike still reads at a glance. Sky is lighter and
// cooler than the brand navy, so the two never look like the same token.
//
// Unlike Officer, this badge changes NOTHING: it is decoration on a name.
export function TcAcademyBadge({
  name,
  size = "md",
  className = "",
}: {
  name?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!isTcAcademyMember(name)) return null;
  return (
    <span
      title="Tzu Chi Academy 核桃人文學校 student"
      className={`inline-flex flex-none items-center rounded-full border border-sky-300/70 bg-sky-50 font-semibold uppercase tracking-wide text-sky-700 ${badgeDims(size)} ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
        className={badgeIcon(size)}
      >
        {/* Graduation cap */}
        <path d="M12 3 1.5 8.2 12 13.4l8.5-4.2v5.6h2V8.2L12 3Z" />
        <path d="M5.5 11.4v3.8c0 1.6 2.9 2.9 6.5 2.9s6.5-1.3 6.5-2.9v-3.8L12 14.6l-6.5-3.2Z" />
      </svg>
      TC Academy
    </span>
  );
}

// Every badge a volunteer carries, in one fixed order: Officer first (it
// changes how their hours are calculated, so it is the more consequential
// label), then TC Academy.
//
// Returns a FRAGMENT, not a wrapper element, so the badges become direct
// children of the caller's existing `flex flex-wrap items-center gap-1.5` name
// row. That is what keeps the spacing between name↔badge and badge↔badge
// identical, and lets a second badge wrap onto its own line in a narrow column
// instead of stretching the cell. Both render nothing when they don't apply, so
// a plain volunteer's row is byte-identical to before.
export function VolunteerBadges({
  name,
  role,
  size = "md",
}: {
  name?: string | null;
  role?: VolunteerRole;
  size?: "sm" | "md";
}) {
  return (
    <>
      <RoleBadge role={role} size={size} />
      <TcAcademyBadge name={name} size={size} />
    </>
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
