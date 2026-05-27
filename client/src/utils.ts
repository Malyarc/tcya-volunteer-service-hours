import type { Submission } from "./types";

export function formatHours(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value.toFixed(2).replace(/\.00$/, "").replace(/(\.[1-9])0$/, "$1");
}

export function displayEventName(s: Submission): string {
  if (s.customEventName && s.customEventName.length > 0) {
    return `Other: ${s.customEventName}`;
  }
  return s.eventName;
}

export function formatDate(date: string): string {
  if (!date) return "";
  // Parse as a local date so the display doesn't shift by a day in some
  // timezones (which `new Date("2025-01-15")` would otherwise do).
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const parsed = new Date(y, m - 1, d);
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatTime12h(hhmm: string): string {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return hhmm;
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export interface VolunteerSummary {
  name: string;
  latestGrade: string;
  totalHours: number;
  submissions: Submission[];
}

export function buildSummaries(
  volunteerNames: readonly string[],
  submissions: Submission[]
): VolunteerSummary[] {
  const byName = new Map<string, Submission[]>();
  for (const name of volunteerNames) byName.set(name, []);
  for (const s of submissions) {
    if (!byName.has(s.volunteerName)) byName.set(s.volunteerName, []);
    byName.get(s.volunteerName)!.push(s);
  }

  const summaries: VolunteerSummary[] = [];
  for (const [name, items] of byName.entries()) {
    const sorted = [...items].sort((a, b) =>
      a.eventDate < b.eventDate ? 1 : a.eventDate > b.eventDate ? -1 : 0
    );
    const totalHours =
      Math.round(sorted.reduce((sum, s) => sum + (s.hours || 0), 0) * 100) /
      100;
    const latestGrade = sorted.length > 0 ? sorted[0].grade : "—";
    summaries.push({ name, latestGrade, totalHours, submissions: sorted });
  }

  summaries.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
  return summaries;
}
