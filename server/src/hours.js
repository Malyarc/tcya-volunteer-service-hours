// Hours are derived from attendance check-in / check-out timestamps (the QR
// scan model): a volunteer's hours for an event = checkout − checkin. Helpers
// shared by both stores so the derivation is identical.

// Local timezone the chapter operates in — used to render a timestamp as a
// wall-clock HH:MM for display (certificates / exports). Override with
// CHAPTER_TZ if the chapter is elsewhere.
export const CHAPTER_TZ = process.env.CHAPTER_TZ || "America/Los_Angeles";

// Duration between two ISO timestamps, in hours, rounded to the nearest quarter
// hour (matching the app's 15-minute granularity). 0 if either is missing or
// checkout is not after checkin.
export function hoursBetween(checkinAt, checkoutAt) {
  if (!checkinAt || !checkoutAt) return 0;
  const ms = Date.parse(checkoutAt) - Date.parse(checkinAt);
  if (!(ms > 0)) return 0;
  return Math.round((ms / 3600000) * 4) / 4;
}

// An ISO timestamp rendered as 24h "HH:MM" in the chapter's local timezone.
export function localHHMM(iso, tz = CHAPTER_TZ) {
  if (!iso) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(iso));
    const h = parts.find((p) => p.type === "hour")?.value ?? "00";
    const m = parts.find((p) => p.type === "minute")?.value ?? "00";
    return `${h === "24" ? "00" : h}:${m}`;
  } catch {
    return "";
  }
}

// Whether an attendance row represents completed service (both timestamps set,
// checkout after checkin).
export function isComplete(checkinAt, checkoutAt) {
  return hoursBetween(checkinAt, checkoutAt) > 0;
}
