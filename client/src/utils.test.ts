import { describe, it, expect } from "vitest";
import {
  formatHours,
  todayYmd,
  isCountableSubmission,
  dedupeSubmissionsByEvent,
  buildSummaries,
} from "./utils";
import type { Submission, VolunteerEvent } from "./types";

function sub(over: Partial<Submission> = {}): Submission {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    eventId: over.eventId ?? "evt-1",
    volunteerName: over.volunteerName ?? "Aaron Tse",
    grade: over.grade ?? "10th",
    eventName: over.eventName ?? "Culture - Beach Cleanup",
    customEventName: over.customEventName ?? null,
    eventDate: over.eventDate ?? "2026-03-15",
    arrivalTime: over.arrivalTime ?? "08:00",
    endTime: over.endTime ?? "11:30",
    hours: over.hours ?? 3.5,
    comments: over.comments ?? "",
    submittedAt: over.submittedAt ?? "2026-03-15T09:00:00.000Z",
  };
}

function evt(over: Partial<VolunteerEvent> = {}): VolunteerEvent {
  return {
    id: over.id ?? "evt-1",
    name: over.name ?? "Culture - Beach Cleanup",
    customName: over.customName ?? null,
    date: over.date ?? "2026-03-15",
    createdAt: over.createdAt ?? "2026-03-01T00:00:00.000Z",
    attendance: over.attendance ?? [
      {
        volunteerName: "Aaron Tse",
        staffCheckin: true,
        volunteerCheckout: true,
        selfAdded: false,
      },
    ],
  };
}

describe("formatHours", () => {
  it("trims trailing zeros and handles edge values", () => {
    expect(formatHours(3.5)).toBe("3.5");
    expect(formatHours(3)).toBe("3");
    expect(formatHours(3.25)).toBe("3.25");
    expect(formatHours(2.1)).toBe("2.1");
    expect(formatHours(0)).toBe("0");
    expect(formatHours(-1)).toBe("0");
    expect(formatHours(NaN)).toBe("0");
  });
});

describe("todayYmd", () => {
  it("returns a zero-padded local YYYY-MM-DD matching the local calendar day", () => {
    const t = todayYmd();
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(d.getDate()).padStart(2, "0")}`;
    expect(t).toBe(expected);
  });
});

describe("isCountableSubmission", () => {
  it("counts only when both check-ins are green", () => {
    const events = [evt()];
    expect(isCountableSubmission(sub(), events)).toBe(true);
  });
  it("does not count when staff check-in is missing", () => {
    const events = [
      evt({
        attendance: [
          {
            volunteerName: "Aaron Tse",
            staffCheckin: false,
            volunteerCheckout: true,
            selfAdded: true,
          },
        ],
      }),
    ];
    expect(isCountableSubmission(sub(), events)).toBe(false);
  });
  it("does not count when the event was deleted", () => {
    expect(isCountableSubmission(sub({ eventId: "gone" }), [evt()])).toBe(false);
  });
  it("counts legacy submissions with no eventId", () => {
    expect(isCountableSubmission(sub({ eventId: "" }), [])).toBe(true);
  });
});

describe("dedupeSubmissionsByEvent", () => {
  it("keeps the most recent submission per event", () => {
    const older = sub({
      id: "a",
      submittedAt: "2026-03-15T09:00:00.000Z",
      hours: 3.5,
    });
    const newer = sub({
      id: "b",
      submittedAt: "2026-03-15T10:00:00.000Z",
      hours: 4,
    });
    const out = dedupeSubmissionsByEvent([older, newer]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("b");
    expect(out[0].hours).toBe(4);
  });
  it("keeps distinct events and all eventId-less rows", () => {
    const out = dedupeSubmissionsByEvent([
      sub({ id: "1", eventId: "e1" }),
      sub({ id: "2", eventId: "e2" }),
      sub({ id: "3", eventId: "" }),
      sub({ id: "4", eventId: "" }),
    ]);
    expect(out).toHaveLength(4);
  });
});

describe("buildSummaries", () => {
  const NAMES = ["Aaron Tse", "Betty Lin"] as const;

  it("sums only countable hours and never double-counts duplicates", () => {
    const events = [evt({ id: "e1" }), evt({ id: "e2", date: "2026-04-01" })];
    // Two DUPLICATE submissions for e1 (legacy double-count) + one for e2.
    const submissions = [
      sub({ id: "d1", eventId: "e1", hours: 3.5, submittedAt: "2026-03-15T09:00:00Z" }),
      sub({ id: "d2", eventId: "e1", hours: 3.5, submittedAt: "2026-03-15T09:05:00Z" }),
      sub({ id: "s2", eventId: "e2", hours: 2, eventDate: "2026-04-01" }),
    ];
    // e2 attendance also both-green for Aaron.
    events[1].attendance = [
      {
        volunteerName: "Aaron Tse",
        staffCheckin: true,
        volunteerCheckout: true,
        selfAdded: false,
      },
    ];
    const summaries = buildSummaries(NAMES, submissions, events);
    const aaron = summaries.find((s) => s.name === "Aaron Tse")!;
    // e1 counted once (3.5, not 7.0) + e2 (2) = 5.5, across 2 rows.
    expect(aaron.submissions).toHaveLength(2);
    expect(aaron.totalHours).toBe(5.5);
  });

  it("excludes pending submissions from hours but tracks pendingCount", () => {
    const events = [
      evt({
        id: "e1",
        attendance: [
          {
            volunteerName: "Aaron Tse",
            staffCheckin: false, // not yet confirmed by staff
            volunteerCheckout: true,
            selfAdded: true,
          },
        ],
      }),
    ];
    const summaries = buildSummaries(
      NAMES,
      [sub({ eventId: "e1", hours: 3.5 })],
      events
    );
    const aaron = summaries.find((s) => s.name === "Aaron Tse")!;
    expect(aaron.totalHours).toBe(0);
    expect(aaron.pendingCount).toBe(1);
  });

  it("lists every roster volunteer and sorts alphabetically", () => {
    const summaries = buildSummaries(NAMES, [], [evt()]);
    expect(summaries.map((s) => s.name)).toEqual(["Aaron Tse", "Betty Lin"]);
  });
});
