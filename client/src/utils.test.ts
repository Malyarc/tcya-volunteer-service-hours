import { describe, it, expect } from "vitest";
import {
  formatHours,
  todayYmd,
  isCountableSubmission,
  dedupeSubmissionsByEvent,
  buildSummaries,
  formatClockFromIso,
  isoToLocalInput,
  localInputToIso,
  groupEventsByName,
  isCollapsibleGroup,
  moveItem,
  sortEventGroups,
  hoursBetweenIso,
  isCompleteAttendance,
  creditedHoursFor,
  deriveHours,
} from "./utils";
import type { RosterEntry, Submission, VolunteerEvent } from "./types";

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
    rawHours: over.rawHours ?? over.hours ?? 3.5,
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
    startTime: over.startTime ?? "",
    endTime: over.endTime ?? "",
    expectedHours: over.expectedHours ?? null,
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

describe("check-in/out timestamp helpers", () => {
  it("formatClockFromIso returns a clock time for valid input and empty for junk", () => {
    // Exact rendering is locale/tz-dependent; assert it produces a non-empty
    // clock-looking string and is empty for bad input.
    expect(formatClockFromIso("2026-03-15T17:30:00.000Z")).toMatch(/\d/);
    expect(formatClockFromIso(null)).toBe("");
    expect(formatClockFromIso("")).toBe("");
    expect(formatClockFromIso("not-a-date")).toBe("");
  });

  it("isoToLocalInput <-> localInputToIso round-trip preserves the instant", () => {
    const iso = "2026-03-15T17:30:00.000Z";
    const local = isoToLocalInput(iso); // 'YYYY-MM-DDTHH:MM' in local tz
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const back = localInputToIso(local);
    // Round-trips to the same minute (seconds are dropped by the input format).
    expect(back).toBe("2026-03-15T17:30:00.000Z");
  });

  it("localInputToIso returns null for blank, isoToLocalInput empty for null", () => {
    expect(localInputToIso("")).toBeNull();
    expect(isoToLocalInput(null)).toBe("");
    expect(isoToLocalInput(undefined)).toBe("");
  });
});

describe("buildSummaries", () => {
  const NAMES: RosterEntry[] = [
    { name: "Aaron Tse", grade: "" },
    { name: "Betty Lin", grade: "" },
  ];

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

  it("shows the volunteer's editable roster grade, overriding submission grade", () => {
    const events = [evt({ id: "e1" })];
    const submissions = [sub({ eventId: "e1", grade: "8th" })];
    const summaries = buildSummaries(
      [{ name: "Aaron Tse", grade: "11th" }] as RosterEntry[],
      submissions,
      events
    );
    expect(summaries.find((s) => s.name === "Aaron Tse")!.latestGrade).toBe("11th");
  });

  // --- The Roster tab must equal the Volunteers tab, always ---

  it("NEVER invents a roster row from a leftover submission name", () => {
    // "Ghost Member" was deleted from the roster but their hours stayed behind.
    // Before this guard they appeared as an extra row on the Roster tab only —
    // exactly how the two tabs drifted apart.
    const events = [
      evt({
        id: "e1",
        attendance: [
          { volunteerName: "Aaron Tse", staffCheckin: true, volunteerCheckout: true },
          { volunteerName: "Ghost Member", staffCheckin: true, volunteerCheckout: true },
        ],
      }),
    ];
    const submissions = [
      sub({ eventId: "e1", volunteerName: "Aaron Tse", hours: 3 }),
      sub({ eventId: "e1", volunteerName: "Ghost Member", hours: 8 }),
    ];
    const summaries = buildSummaries(NAMES, submissions, events);
    expect(summaries.map((s) => s.name)).toEqual(["Aaron Tse", "Betty Lin"]);
    expect(summaries.some((s) => s.name === "Ghost Member")).toBe(false);
    // …and the ghost's hours are excluded from the chapter total.
    expect(summaries.reduce((a, s) => a + s.totalHours, 0)).toBe(3);
  });

  it("carries the officer role through from the roster", () => {
    const summaries = buildSummaries(
      [
        { name: "Aaron Tse", grade: "10th", role: "officer" },
        { name: "Betty Lin", grade: "9th" },
      ],
      [],
      []
    );
    expect(summaries.find((s) => s.name === "Aaron Tse")!.role).toBe("officer");
    expect(summaries.find((s) => s.name === "Betty Lin")!.role).toBe("volunteer");
  });

  // --- Strikes ---

  it("totals strikes across events and attaches them to the right event row", () => {
    const events = [
      evt({
        id: "e1",
        date: "2026-03-15",
        attendance: [
          { volunteerName: "Aaron Tse", staffCheckin: true, volunteerCheckout: true, strikes: 1 },
        ],
      }),
      evt({
        id: "e2",
        date: "2026-04-01",
        attendance: [
          { volunteerName: "Aaron Tse", staffCheckin: true, volunteerCheckout: true, strikes: 2 },
        ],
      }),
    ];
    const submissions = [
      sub({ id: "s1", eventId: "e1", hours: 3, eventDate: "2026-03-15" }),
      sub({ id: "s2", eventId: "e2", hours: 2, eventDate: "2026-04-01" }),
    ];
    const aaron = buildSummaries(NAMES, submissions, events).find(
      (s) => s.name === "Aaron Tse"
    )!;
    expect(aaron.totalStrikes).toBe(3);
    expect(aaron.eventRows.map((r) => [r.eventId, r.strikes])).toEqual([
      ["e2", 2], // newest first
      ["e1", 1],
    ]);
    expect(aaron.totalHours).toBe(5); // strikes never touch hours
  });

  it("still shows a strike on an event with no countable hours", () => {
    // Checked in but never checked out ⇒ no submission — the strike must not
    // silently disappear from the roster.
    const events = [
      evt({
        id: "e1",
        attendance: [
          { volunteerName: "Aaron Tse", staffCheckin: true, volunteerCheckout: false, strikes: 1 },
        ],
      }),
    ];
    const aaron = buildSummaries(NAMES, [], events).find((s) => s.name === "Aaron Tse")!;
    expect(aaron.totalStrikes).toBe(1);
    expect(aaron.eventRows).toHaveLength(1);
    expect(aaron.eventRows[0].hours).toBeNull();
    expect(aaron.eventRows[0].strikes).toBe(1);
    expect(aaron.totalHours).toBe(0);
  });

  it("reports zero strikes for a clean volunteer", () => {
    const aaron = buildSummaries(NAMES, [sub()], [evt()]).find(
      (s) => s.name === "Aaron Tse"
    )!;
    expect(aaron.totalStrikes).toBe(0);
    expect(aaron.eventRows.every((r) => r.strikes === 0)).toBe(true);
  });
});

describe("groupEventsByName", () => {
  const TODAY = "2026-06-01";

  it("puts each event type in its own group, upcoming groups first", () => {
    const events = [
      evt({ id: "a1", name: "Charity - Food Distribution", date: "2026-04-26" }),
      evt({ id: "a2", name: "Charity - Food Distribution", date: "2026-07-26" }),
      evt({ id: "b1", name: "Culture - Beach Cleanup", date: "2026-04-18" }),
    ];
    const groups = groupEventsByName(events, [], TODAY);
    expect(groups.map((g) => g.name)).toEqual([
      "Charity - Food Distribution", // has an upcoming date
      "Culture - Beach Cleanup", // past only
    ]);
    const food = groups[0];
    expect(food.totalOccurrences).toBe(2);
    expect(food.upcomingCount).toBe(1);
    expect(food.nextDate).toBe("2026-07-26");
    expect(food.lastDate).toBe("2026-04-26");
    // Upcoming date is listed first, then past dates newest-first.
    expect(food.occurrences.map((e) => e.date)).toEqual(["2026-07-26", "2026-04-26"]);
  });

  it("gives a custom 'Others' event its own group under its own name", () => {
    const groups = groupEventsByName(
      [
        evt({ id: "x", name: "Others - please specify", customName: "Toy Drive" }),
        evt({ id: "y", name: "Culture - Beach Cleanup" }),
      ],
      [],
      TODAY
    );
    expect(groups.map((g) => g.name).sort()).toEqual([
      "Culture - Beach Cleanup",
      "Toy Drive",
    ]);
  });

  it("rolls up attendance, confirmations and credited hours per group", () => {
    const events = [
      evt({
        id: "e1",
        date: "2026-04-26",
        attendance: [
          { volunteerName: "Aaron Tse", staffCheckin: true, volunteerCheckout: true },
          { volunteerName: "Betty Lin", staffCheckin: true, volunteerCheckout: false },
        ],
      }),
      evt({
        id: "e2",
        date: "2026-05-24",
        attendance: [
          { volunteerName: "Aaron Tse", staffCheckin: true, volunteerCheckout: true },
        ],
      }),
    ];
    const submissions = [
      sub({ id: "s1", eventId: "e1", hours: 3, eventDate: "2026-04-26" }),
      sub({ id: "s2", eventId: "e2", hours: 2.5, eventDate: "2026-05-24" }),
      // Betty never checked out ⇒ her row must not count toward the group total.
      sub({ id: "s3", eventId: "e1", volunteerName: "Betty Lin", hours: 9, eventDate: "2026-04-26" }),
    ];
    const [group] = groupEventsByName(events, submissions, TODAY);
    expect(group.totalAttendees).toBe(3);
    expect(group.totalConfirmed).toBe(2);
    expect(group.totalHours).toBe(5.5);
  });

  it("returns nothing for an empty event list", () => {
    expect(groupEventsByName([], [], TODAY)).toEqual([]);
  });
});

describe("moveItem", () => {
  const list = ["a", "b", "c", "d"];

  it("moves an item down and up", () => {
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(list, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("moves one step, the way the up/down buttons do", () => {
    expect(moveItem(list, 2, 1)).toEqual(["a", "c", "b", "d"]);
    expect(moveItem(list, 1, 2)).toEqual(["a", "c", "b", "d"]);
  });

  it("clamps a target past either end instead of losing the item", () => {
    expect(moveItem(list, 2, -5)).toEqual(["c", "a", "b", "d"]);
    expect(moveItem(list, 1, 99)).toEqual(["a", "c", "d", "b"]);
  });

  it("is a no-op for an out-of-range source or a move to the same slot", () => {
    expect(moveItem(list, 9, 0)).toEqual(list);
    expect(moveItem(list, -1, 0)).toEqual(list);
    expect(moveItem(list, 2, 2)).toEqual(list);
  });

  it("never mutates the input", () => {
    const original = [...list];
    moveItem(list, 0, 3);
    expect(list).toEqual(original);
  });
});

describe("event section ordering", () => {
  const TODAY = "2026-03-10";

  // Two upcoming types and one past type, so the automatic order is
  // deterministic: Recycling (soonest) → Beach (later) → Bake Sale (past).
  function threeGroups() {
    return groupEventsByName(
      [
        evt({ id: "e1", name: "Culture - Beach Cleanup", date: "2026-04-01" }),
        evt({ id: "e2", name: "Recycling", date: "2026-03-12" }),
        evt({ id: "e3", name: "Others - please specify", customName: "Bake Sale", date: "2026-01-05" }),
      ],
      [],
      TODAY
    );
  }

  it("uses the automatic order when nothing has been placed by hand", () => {
    expect(threeGroups().map((g) => g.name)).toEqual([
      "Recycling",
      "Culture - Beach Cleanup",
      "Bake Sale",
    ]);
  });

  it("puts the admin's saved order first, exactly as saved", () => {
    const order = ["Bake Sale", "Culture - Beach Cleanup", "Recycling"];
    expect(sortEventGroups(threeGroups(), order).map((g) => g.name)).toEqual(order);
  });

  it("keeps an unplaced section visible, in automatic order, below the placed ones", () => {
    // Only Bake Sale was dragged; the other two keep the automatic rule and
    // follow it — a brand-new event type can never be hidden by a stale order.
    expect(sortEventGroups(threeGroups(), ["Bake Sale"]).map((g) => g.name)).toEqual([
      "Bake Sale",
      "Recycling",
      "Culture - Beach Cleanup",
    ]);
  });

  it("ignores saved names that no longer match a section", () => {
    const order = ["Deleted Event Type", "Recycling"];
    expect(sortEventGroups(threeGroups(), order).map((g) => g.name)).toEqual([
      "Recycling",
      "Culture - Beach Cleanup",
      "Bake Sale",
    ]);
  });

  it("does not mutate the groups it was given", () => {
    const groups = threeGroups();
    const before = groups.map((g) => g.name);
    sortEventGroups(groups, ["Bake Sale"]);
    expect(groups.map((g) => g.name)).toEqual(before);
  });

  it("groupEventsByName applies the saved order end-to-end", () => {
    const groups = groupEventsByName(
      [
        evt({ id: "e1", name: "Culture - Beach Cleanup", date: "2026-04-01" }),
        evt({ id: "e2", name: "Recycling", date: "2026-03-12" }),
      ],
      [],
      TODAY,
      ["Culture - Beach Cleanup", "Recycling"]
    );
    expect(groups.map((g) => g.name)).toEqual(["Culture - Beach Cleanup", "Recycling"]);
  });

  it("a moved section stays put when the list is saved and re-read", () => {
    // What the page actually does: move index 2 to the top, save those names,
    // then re-group with them. The result must match what the user just saw.
    const groups = threeGroups();
    const names = moveItem(groups, 2, 0).map((g) => g.name);
    expect(sortEventGroups(threeGroups(), names).map((g) => g.name)).toEqual(names);
  });
});

describe("isCollapsibleGroup", () => {
  const TODAY = "2026-03-10";

  it("is false for a section with a single date (no dropdown to show)", () => {
    const [only] = groupEventsByName(
      [evt({ id: "e1", name: "Recycling", date: "2026-03-12" })],
      [],
      TODAY
    );
    expect(only.totalOccurrences).toBe(1);
    expect(isCollapsibleGroup(only)).toBe(false);
  });

  it("is true as soon as the section has a second date", () => {
    const [group] = groupEventsByName(
      [
        evt({ id: "e1", name: "Recycling", date: "2026-03-12" }),
        evt({ id: "e2", name: "Recycling", date: "2026-04-12" }),
      ],
      [],
      TODAY
    );
    expect(group.totalOccurrences).toBe(2);
    expect(isCollapsibleGroup(group)).toBe(true);
  });

  it("decides per section, not per page", () => {
    const groups = groupEventsByName(
      [
        evt({ id: "e1", name: "Recycling", date: "2026-03-12" }),
        evt({ id: "e2", name: "Recycling", date: "2026-04-12" }),
        evt({ id: "e3", name: "Culture - Beach Cleanup", date: "2026-05-01" }),
      ],
      [],
      TODAY
    );
    expect(groups.map((g) => [g.name, isCollapsibleGroup(g)])).toEqual([
      ["Recycling", true],
      ["Culture - Beach Cleanup", false],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Derived hours — the client's mirror of server/src/hours.js
//
// These cases are deliberately the SAME ones server/test/hours.test.js pins.
// The event page shows the admin what a set of times will be worth before they
// save; if this mirror drifts from the server, the app promises one number and
// credits another. Every expected value below is hand-computed against the rule
// "hours = round((checkout − checkin) * 4) / 4, capped at expectedHours for
// ordinary volunteers".
// ---------------------------------------------------------------------------

describe("hoursBetweenIso — mirrors the server's hoursBetween", () => {
  it("returns exact multiples of an hour as-is", () => {
    expect(hoursBetweenIso("2026-03-15T16:00:00Z", "2026-03-15T19:00:00Z")).toBe(3);
    expect(hoursBetweenIso("2026-03-15T16:00:00Z", "2026-03-15T17:00:00Z")).toBe(1);
  });

  it("treats 90 minutes as 1.5", () => {
    expect(hoursBetweenIso("2026-03-15T16:00:00Z", "2026-03-15T17:30:00Z")).toBe(1.5);
  });

  it("rounds to the nearest quarter hour (7 min -> 0, 8 min -> 0.25)", () => {
    // 7 min = 0.11667h; *4 = 0.4667; round 0 -> 0.
    expect(hoursBetweenIso("2026-03-15T16:00:00Z", "2026-03-15T16:07:00Z")).toBe(0);
    // 8 min = 0.13333h; *4 = 0.5333; round 1 -> 0.25.
    expect(hoursBetweenIso("2026-03-15T16:00:00Z", "2026-03-15T16:08:00Z")).toBe(0.25);
    // 22 min -> 0.25, 23 min -> 0.5 (the .5 boundary).
    expect(hoursBetweenIso("2026-03-15T16:00:00Z", "2026-03-15T16:22:00Z")).toBe(0.25);
    expect(hoursBetweenIso("2026-03-15T16:00:00Z", "2026-03-15T16:23:00Z")).toBe(0.5);
    // 142 min = 2.36667h; *4 = 9.4667; round 9 -> 2.25.
    expect(hoursBetweenIso("2026-03-15T16:00:00Z", "2026-03-15T18:22:00Z")).toBe(2.25);
  });

  it("returns 0 for non-positive gaps and missing inputs", () => {
    expect(hoursBetweenIso("2026-03-15T19:00:00Z", "2026-03-15T16:00:00Z")).toBe(0);
    expect(hoursBetweenIso("2026-03-15T16:00:00Z", "2026-03-15T16:00:00Z")).toBe(0);
    expect(hoursBetweenIso(null, "2026-03-15T16:00:00Z")).toBe(0);
    expect(hoursBetweenIso("2026-03-15T16:00:00Z", null)).toBe(0);
    expect(hoursBetweenIso(null, null)).toBe(0);
    expect(hoursBetweenIso("", "")).toBe(0);
  });

  it("is timezone/DST independent (epoch math, like the server)", () => {
    // A 3-hour absolute gap straddling US spring-forward is still 3h.
    expect(hoursBetweenIso("2026-03-08T08:30:00Z", "2026-03-08T11:30:00Z")).toBe(3);
  });
});

describe("isCompleteAttendance — mirrors the server's isComplete", () => {
  it("is true only when checkout is strictly after check-in", () => {
    expect(isCompleteAttendance("2026-03-15T16:00:00Z", "2026-03-15T19:00:00Z")).toBe(true);
    expect(isCompleteAttendance("2026-03-15T16:00:00Z", "2026-03-15T16:00:00Z")).toBe(false);
    expect(isCompleteAttendance("2026-03-15T19:00:00Z", "2026-03-15T16:00:00Z")).toBe(false);
    expect(isCompleteAttendance(null, "2026-03-15T16:00:00Z")).toBe(false);
    expect(isCompleteAttendance("2026-03-15T16:00:00Z", null)).toBe(false);
  });

  it("stays decoupled from rounding: a 5-minute visit is complete but worth 0", () => {
    // The same decoupling the server pins — the row must not vanish.
    expect(hoursBetweenIso("2026-03-15T16:00:00Z", "2026-03-15T16:05:00Z")).toBe(0);
    expect(isCompleteAttendance("2026-03-15T16:00:00Z", "2026-03-15T16:05:00Z")).toBe(true);
  });
});

describe("creditedHoursFor — mirrors the server's creditedHours cap", () => {
  it("caps an ordinary volunteer at the event's expected hours", () => {
    expect(creditedHoursFor(5.5, 4, "volunteer")).toBe(4);
  });

  it("never caps an officer — set-up and clean-up time is real service", () => {
    expect(creditedHoursFor(5.5, 4, "officer")).toBe(5.5);
  });

  it("never caps anyone when the event sets no expected hours", () => {
    // This is what keeps every pre-existing event's hours unchanged.
    expect(creditedHoursFor(5.5, null, "volunteer")).toBe(5.5);
    expect(creditedHoursFor(5.5, undefined, "volunteer")).toBe(5.5);
  });

  it("leaves a span under the cap alone", () => {
    expect(creditedHoursFor(2.5, 4, "volunteer")).toBe(2.5);
  });

  it("fails CLOSED: an unknown or missing role is treated as capped", () => {
    // Matches the server's isOfficerRole(), where anything not exactly
    // "officer" is an ordinary volunteer — a corrupt role can only ever remove
    // the exemption, never grant it.
    expect(creditedHoursFor(5.5, 4, undefined)).toBe(4);
    expect(creditedHoursFor(5.5, 4, "captain" as never)).toBe(4);
  });

  it("rounds the cap itself to the quarter-hour grid, like normalizeExpectedHours", () => {
    expect(creditedHoursFor(5, 3.3, "volunteer")).toBe(3.25);
  });

  it("ignores a nonsensical negative cap rather than zeroing someone's credit", () => {
    expect(creditedHoursFor(3, -1, "volunteer")).toBe(3);
  });
});

describe("deriveHours — what the event page shows and the editor auto-fills", () => {
  it("reports an incomplete row as nothing to credit", () => {
    const d = deriveHours("2026-03-15T16:00:00Z", null, 4, "volunteer");
    expect(d).toEqual({ complete: false, raw: 0, credited: 0, capped: false });
  });

  it("computes credited hours for a complete, uncapped row", () => {
    const d = deriveHours("2026-03-15T16:00:00Z", "2026-03-15T19:00:00Z", 4, "volunteer");
    expect(d).toEqual({ complete: true, raw: 3, credited: 3, capped: false });
  });

  it("flags the cap so the UI can explain the difference", () => {
    // 16:00 -> 21:30 = 5.5h on site, capped to the event's 4.
    const d = deriveHours("2026-03-15T16:00:00Z", "2026-03-15T21:30:00Z", 4, "volunteer");
    expect(d).toEqual({ complete: true, raw: 5.5, credited: 4, capped: true });
  });

  it("does not flag a cap for an officer working the same long day", () => {
    const d = deriveHours("2026-03-15T16:00:00Z", "2026-03-15T21:30:00Z", 4, "officer");
    expect(d).toEqual({ complete: true, raw: 5.5, credited: 5.5, capped: false });
  });

  it("keeps a complete sub-quarter-hour visit complete at 0 hours", () => {
    const d = deriveHours("2026-03-15T16:00:00Z", "2026-03-15T16:05:00Z", 4, "volunteer");
    expect(d).toEqual({ complete: true, raw: 0, credited: 0, capped: false });
  });

  it("agrees with the roster: credited hours equal the stored submission hours", () => {
    // The event page derives from timestamps; the roster reads the server's
    // stored submission. Same inputs must give the same number, or the two
    // pages appear to disagree about one volunteer's hours.
    const stored = sub({ hours: 4, rawHours: 5.5 });
    const derived = deriveHours(
      "2026-03-15T16:00:00Z",
      "2026-03-15T21:30:00Z",
      4,
      "volunteer"
    );
    expect(derived.credited).toBe(stored.hours);
    expect(derived.raw).toBe(stored.rawHours);
  });
});
