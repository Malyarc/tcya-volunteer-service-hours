// Hours are derived from attendance check-in / check-out timestamps (the QR
// scan model): a volunteer's hours for an event = checkout − checkin, capped at
// the event's Expected Volunteer Hours for ordinary volunteers (officers are
// uncapped — see roles.js). Helpers shared by both stores so the derivation is
// identical, and by the shared `deriveSubmissionFields` below so a single-row
// reconcile and a whole-event re-reconcile can never drift apart.

import { isOfficerRole } from "./roles.js";

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

// Whether an attendance row represents completed service: both timestamps set,
// checkout strictly after check-in. This gates whether a derived submission
// exists — kept SEPARATE from the rounded `hoursBetween` value so a genuinely
// complete-but-brief (< 7.5 min) row still yields a submission (with 0 hours)
// rather than vanishing.
export function isComplete(checkinAt, checkoutAt) {
  if (!checkinAt || !checkoutAt) return false;
  return Date.parse(checkoutAt) > Date.parse(checkinAt);
}

// ---------- Expected hours (the per-event cap) ----------

// An event's "Expected Volunteer Hours" as a stored value: a non-negative
// number on the same 0.25 granularity as derived hours, or null for "no cap
// set". Anything unparseable / negative normalizes to null (= no cap) rather
// than 0, so a bad value can never silently zero out everyone's credit.
export function normalizeExpectedHours(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 4) / 4;
}

// The hours a person is actually CREDITED for one event.
//   - ordinary volunteers: min(worked, expected) — arriving an hour early or
//     forgetting to check out cannot inflate their credit past what the event
//     is worth;
//   - officers: the full worked span, because their set-up/clean-up time before
//     and after the event is genuine service;
//   - no expected hours set on the event: no cap for anyone (this is what keeps
//     every already-recorded event's hours byte-for-byte unchanged).
export function creditedHours(rawHours, expectedHours, officer) {
  const raw = Number(rawHours) || 0;
  if (officer) return raw;
  const cap = normalizeExpectedHours(expectedHours);
  if (cap === null) return raw;
  return Math.min(raw, cap);
}

// ---------- The one derivation both stores share ----------

// Everything a derived submission holds for one (event, volunteer) pair, or
// null when the attendance row isn't complete service yet (⇒ the caller must
// DELETE any existing submission). `event` is the event's stored shape and
// `volunteer` the roster row (or null/undefined if the person is no longer on
// the roster — they then count as an ordinary, capped volunteer).
export function deriveSubmissionFields({ checkinAt, checkoutAt, event, volunteer }) {
  if (!event || !isComplete(checkinAt, checkoutAt)) return null;
  const rawHours = hoursBetween(checkinAt, checkoutAt);
  return {
    grade: volunteer?.grade || "",
    eventName: event.customName ? event.customName : event.name,
    customEventName: event.customName || null,
    eventDate: event.date,
    arrivalTime: localHHMM(checkinAt),
    endTime: localHHMM(checkoutAt),
    hours: creditedHours(rawHours, event.expectedHours, isOfficerRole(volunteer?.role)),
    rawHours,
  };
}
