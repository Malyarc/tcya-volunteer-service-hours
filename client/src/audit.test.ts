import { describe, it, expect } from "vitest";
import {
  formatPacificDayLabel,
  formatPacificTime,
  pacificAbbrev,
  pacificDayKey,
} from "./utils";
import { describeEntry } from "./components/admin/AuditPanel";
import type { AuditEntry } from "./types";

// ---------------------------------------------------------------------------
// Chapter-time rendering.
//
// The whole audit feature rests on these: entries are stored as absolute
// instants and MUST read as the clock the chapter saw, whatever timezone the
// admin is in. Every expected value below is hand-computed from the UTC instant
// and the Pacific offset in force on that date (PDT = UTC-7, PST = UTC-8).
// ---------------------------------------------------------------------------

describe("Pacific time rendering", () => {
  it("renders an instant as the chapter's wall clock, not the viewer's", () => {
    // 2026-08-21T16:00Z, PDT (UTC-7) ⇒ 09:00 local.
    expect(formatPacificTime("2026-08-21T16:00:00.000Z")).toBe("9:00 AM");
    // 2026-08-21T21:30Z ⇒ 14:30 ⇒ 2:30 PM.
    expect(formatPacificTime("2026-08-21T21:30:00.000Z")).toBe("2:30 PM");
  });

  it("honours standard time vs daylight time rather than a fixed offset", () => {
    // Jan 15 is PST (UTC-8): 20:00Z ⇒ 12:00 PM.
    expect(formatPacificTime("2026-01-15T20:00:00.000Z")).toBe("12:00 PM");
    // Jul 15 is PDT (UTC-7): 19:00Z ⇒ the SAME wall clock from a different UTC.
    expect(formatPacificTime("2026-07-15T19:00:00.000Z")).toBe("12:00 PM");
  });

  it("labels the zone truthfully — PDT in summer, PST in winter", () => {
    // Calling an August reading "PST" would be wrong; the chapter says "PST"
    // colloquially but the log must not print a false abbreviation.
    expect(pacificAbbrev("2026-08-21T16:00:00.000Z")).toBe("PDT");
    expect(pacificAbbrev("2026-01-15T20:00:00.000Z")).toBe("PST");
  });

  it("groups by the PACIFIC day, so a late-evening entry files under that day", () => {
    // 2026-08-21T02:30Z is still 7:30 PM on Aug 20 in California. Grouping by
    // the UTC date would file the chapter's evening under tomorrow.
    expect(pacificDayKey("2026-08-21T02:30:00.000Z")).toBe("2026-08-20");
    expect(formatPacificTime("2026-08-21T02:30:00.000Z")).toBe("7:30 PM");
    // …and just after Pacific midnight it does roll over.
    expect(pacificDayKey("2026-08-21T07:30:00.000Z")).toBe("2026-08-21");
  });

  it("returns empty rather than throwing on a malformed instant", () => {
    expect(pacificDayKey("not-a-timestamp")).toBe("");
    expect(formatPacificTime("not-a-timestamp")).toBe("");
    expect(formatPacificTime(null)).toBe("");
    expect(formatPacificTime(undefined)).toBe("");
  });
});

describe("day labels are relative to the chapter's today", () => {
  it("names today and yesterday", () => {
    expect(formatPacificDayLabel("2026-08-21", "2026-08-21")).toBe("Today");
    expect(formatPacificDayLabel("2026-08-20", "2026-08-21")).toBe("Yesterday");
  });

  it("crosses a month boundary correctly", () => {
    expect(formatPacificDayLabel("2026-07-31", "2026-08-01")).toBe("Yesterday");
  });

  it("spells out anything older", () => {
    // Aug 18 2026 is a Tuesday.
    expect(formatPacificDayLabel("2026-08-18", "2026-08-21")).toMatch(/Tuesday/);
  });

  it("does not throw on a malformed key", () => {
    expect(formatPacificDayLabel("", "2026-08-21")).toBe("");
    expect(formatPacificDayLabel("nonsense", "2026-08-21")).toBe("nonsense");
  });
});

// ---------------------------------------------------------------------------
// How each recorded action reads.
// ---------------------------------------------------------------------------

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "a1",
    at: "2026-08-21T16:00:00.000Z",
    actorRole: "officer",
    action: "checkin",
    volunteerName: "Andrew Luo",
    volunteerCode: "TCYA-0006",
    eventId: "e1",
    eventName: "Culture - Beach Cleanup",
    eventDate: "2026-08-21",
    details: {},
    ...over,
  };
}

describe("describeEntry", () => {
  it("reads a scanned check-in with its stamped time in chapter time", () => {
    const d = describeEntry(
      entry({ action: "checkin", details: { side: "checkin", method: "scan", to: "2026-08-21T16:00:00.000Z" } })
    );
    expect(d.family).toBe("checkin");
    expect(d.verb).toBe("checked in");
    expect(d.method).toBe("QR scan");
    expect(d.detail).toBe("Check-in set to 9:00 AM");
  });

  it("distinguishes a hand-set time from a scanned one", () => {
    const d = describeEntry(
      entry({ action: "checkout", details: { side: "checkout", method: "manual", to: "2026-08-21T21:00:00.000Z" } })
    );
    expect(d.method).toBe("by hand");
    expect(d.detail).toBe("Check-out set to 2:00 PM");
  });

  it("shows both sides of a correction", () => {
    const d = describeEntry(
      entry({
        action: "time_corrected",
        details: { side: "checkout", from: "2026-08-21T20:15:00.000Z", to: "2026-08-21T21:00:00.000Z" },
      })
    );
    expect(d.family).toBe("correct");
    expect(d.detail).toBe("Check-out 1:15 PM → 2:00 PM");
  });

  it("says what a cleared time cost", () => {
    const d = describeEntry(
      entry({ action: "checkout_cleared", details: { side: "checkout", from: "2026-08-21T21:00:00.000Z" } })
    );
    expect(d.family).toBe("cleared");
    expect(d.verb).toBe("had their check-out cleared");
    expect(d.detail).toContain("Was 2:00 PM");
  });

  it("tells a strike being ADDED from one being cleared", () => {
    const added = describeEntry(entry({ action: "strike_set", details: { from: 0, to: 1 } }));
    expect(added.family).toBe("strike");
    expect(added.verb).toBe("was given a strike");
    expect(added.detail).toBe("0 → 1");

    const cleared = describeEntry(entry({ action: "strike_set", details: { from: 2, to: 0 } }));
    // A cleared strike is NOT a red alarm — it is the correction of one.
    expect(cleared.family).toBe("cleared");
    expect(cleared.verb).toBe("had a strike cleared");
    expect(cleared.detail).toBe("2 → 0");
  });

  it("reports what a removal from an event destroyed", () => {
    const d = describeEntry(
      entry({
        action: "attendee_removed",
        details: { checkinAt: "2026-08-21T16:00:00.000Z", checkoutAt: "2026-08-21T21:00:00.000Z", strikes: 1 },
      })
    );
    expect(d.family).toBe("danger");
    expect(d.detail).toBe("Removed with check-in 9:00 AM, check-out 2:00 PM, 1 strike");
  });

  it("spells out a role change, which lifts the hours cap", () => {
    const d = describeEntry(
      entry({ action: "volunteer_updated", details: { roleFrom: "volunteer", roleTo: "officer" } })
    );
    expect(d.detail).toBe("role volunteer → officer");
  });

  it("never renders a contact value, only that one changed", () => {
    const d = describeEntry(entry({ action: "volunteer_updated", details: { email: "changed" } }));
    expect(d.detail).toBe("email changed");
  });

  it("falls back to a neutral row for an action it does not know", () => {
    // A newer server can record an action this client predates; it must render
    // a plain row rather than crash the whole log.
    const d = describeEntry(entry({ action: "something_new" as never, details: {} }));
    expect(d.family).toBe("roster");
    expect(d.verb).toBe("was updated");
  });
});
