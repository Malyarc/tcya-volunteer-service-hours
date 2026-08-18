// The shared router test suite. It is parameterized by a `withServer(run)`
// harness so the exact same behavioral assertions run against BOTH storage
// backends: the in-memory store (routes.test.js) and a live Postgres database
// (store-parity.test.js). Keeping one suite is what guarantees the two stores
// stay in lock-step.

import test from "node:test";
import assert from "node:assert/strict";
import { SEED_VOLUNTEERS } from "../src/data/seed-volunteers.js";
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  OFFICER_PASSWORD,
  OFFICER_USERNAME,
} from "../src/accounts.js";
import {
  OFFICER_NAMES,
  RETIRED_MEMBER_NAMES,
} from "../src/db/data-migrations.js";

export function runSuite(withServer, label) {
  const name = (t) => `[${label}] ${t}`;

  // Fixture names are derived from the seed so the suite stays correct when the
  // roster changes. V1 is seeded first, so it is always assigned TCYA-0001; V2
  // is a distinct second seeded volunteer. Both are plain-ASCII seed entries.
  const V1 = SEED_VOLUNTEERS[0];
  const V2 = SEED_VOLUNTEERS[1];
  // A seeded volunteer the officer migration promotes, and one it must not
  // touch — both asserted below, so a mistake in either list fails loudly.
  const OFFICER = OFFICER_NAMES.find((n) => SEED_VOLUNTEERS.includes(n));
  assert.ok(OFFICER, "at least one officer must exist in the seeded roster");
  assert.ok(
    !OFFICER_NAMES.includes(V1) && !OFFICER_NAMES.includes(V2),
    "the V1/V2 fixtures must be ordinary volunteers so cap tests stay meaningful"
  );

  async function adminToken(api) {
    const r = await api.send("POST", "/api/login", {
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.role, "admin");
    return { "X-Admin-Token": r.body.token };
  }

  // The chapter's second account: a student leader running the door. The ONLY
  // thing this token may do is scan a QR to check someone in or out.
  async function officerToken(api) {
    const r = await api.send("POST", "/api/login", {
      username: OFFICER_USERNAME,
      password: OFFICER_PASSWORD,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.role, "officer");
    return { "X-Admin-Token": r.body.token };
  }

  async function makeEvent(api, auth, overrides = {}) {
    const r = await api.send(
      "POST",
      "/api/events",
      { name: "Culture - Beach Cleanup", date: "2026-03-15", ...overrides },
      auth
    );
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  }

  async function codeFor(api, auth, volName) {
    const vols = (await api.get("/api/volunteers", auth)).body;
    const v = vols.find((x) => x.name === volName);
    assert.ok(v, `volunteer ${volName} should be seeded`);
    return v.code;
  }

  // Log service hours the new way: put the volunteer on the event, then set
  // check-in/out times (via the manual-time PATCH) with a real gap so the store
  // derives a countable submission. Returns the updated event.
  async function logHours(api, auth, eventId, volunteerName, checkinAt, checkoutAt) {
    await api.send(
      "POST",
      `/api/events/${eventId}/attendance`,
      { volunteerNames: [volunteerName] },
      auth
    );
    const r = await api.send(
      "PATCH",
      `/api/events/${eventId}/attendance`,
      { volunteerName, checkinAt, checkoutAt },
      auth
    );
    return r.body;
  }

  // ---------------- Auth ----------------

  test(name("login rejects wrong credentials, accepts correct"), async () => {
    await withServer(async (api) => {
      assert.equal(
        (await api.send("POST", "/api/login", { username: ADMIN_USERNAME, password: "x" }))
          .status,
        401
      );
      assert.equal(
        (await api.send("POST", "/api/login", { username: "nope", password: ADMIN_PASSWORD }))
          .status,
        401
      );
      // The two passcodes are NOT interchangeable: each only opens its own
      // account, so the officer code can never sign someone in as an admin.
      assert.equal(
        (await api.send("POST", "/api/login", {
          username: ADMIN_USERNAME,
          password: OFFICER_PASSWORD,
        })).status,
        401
      );
      assert.equal(
        (await api.send("POST", "/api/login", {
          username: OFFICER_USERNAME,
          password: ADMIN_PASSWORD,
        })).status,
        401
      );
      const ok = await api.send("POST", "/api/login", {
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
      });
      assert.equal(ok.status, 200);
      assert.equal(typeof ok.body.token, "string");
      assert.equal(ok.body.role, "admin");

      const off = await api.send("POST", "/api/login", {
        username: OFFICER_USERNAME,
        password: OFFICER_PASSWORD,
      });
      assert.equal(off.status, 200);
      assert.equal(off.body.role, "officer");
      assert.notEqual(off.body.token, ok.body.token, "the two accounts get different tokens");
    });
  });

  test(name("/session reports which account a token belongs to"), async () => {
    await withServer(async (api) => {
      const anon = await api.get("/api/session");
      assert.deepEqual(anon.body, { admin: false, officer: false, role: null });

      const asAdmin = await api.get("/api/session", await adminToken(api));
      assert.deepEqual(asAdmin.body, { admin: true, officer: false, role: "admin" });

      const asOfficer = await api.get("/api/session", await officerToken(api));
      assert.deepEqual(asOfficer.body, { admin: false, officer: true, role: "officer" });

      const bogus = await api.get("/api/session", { "X-Admin-Token": "deadbeef" });
      assert.deepEqual(bogus.body, { admin: false, officer: false, role: null });
    });
  });

  test(name("admin-only endpoints reject anonymous callers"), async () => {
    await withServer(async (api) => {
      assert.equal(
        (await api.send("POST", "/api/events", { name: "x", date: "2026-01-01" }))
          .status,
        401
      );
      assert.equal((await api.get("/api/volunteers")).status, 401);
      assert.equal(
        (await api.send("POST", "/api/volunteers", { name: "X" })).status,
        401
      );
      assert.equal(
        (await api.send("POST", "/api/admin/reset", undefined)).status,
        401
      );
    });
  });

  // ---------------- Roster (public, no PII) ----------------

  test(name("public roster returns names + grade + role only, never contact info"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const vols = (await api.get("/api/volunteers", auth)).body;
      const aaron = vols.find((v) => v.name === V1);
      await api.send(
        "PATCH",
        `/api/volunteers/${aaron.id}`,
        { email: "a@x.com", phone: "555-1234" },
        auth
      );
      const roster = await api.get("/api/roster");
      assert.equal(roster.status, 200);
      assert.ok(Array.isArray(roster.body));
      const r = roster.body.find((x) => x.name === V1);
      assert.ok(r);
      assert.deepEqual(Object.keys(r).sort(), ["grade", "name", "role"]);
      assert.equal(JSON.stringify(roster.body).includes("555-1234"), false);
      assert.equal(JSON.stringify(roster.body).includes("a@x.com"), false);
      // The roster must list EXACTLY the volunteer records — no more, no fewer.
      // This is the Roster-tab == Volunteers-tab invariant, enforced at the API.
      const all = (await api.get("/api/volunteers", auth)).body;
      assert.deepEqual(
        roster.body.map((x) => x.name).sort(),
        all.map((v) => v.name).sort(),
        "the public roster is exactly the volunteer roster"
      );
    });
  });

  // ---------------- Volunteers ----------------

  test(name("volunteers seed with sequential TCYA codes; first seeded is TCYA-0001"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const vols = (await api.get("/api/volunteers", auth)).body;
      assert.ok(vols.length >= SEED_VOLUNTEERS.length);
      const aaron = vols.find((v) => v.name === V1);
      assert.equal(aaron.code, "TCYA-0001");
      assert.match(aaron.code, /^TCYA-\d{4}$/);
    });
  });

  test(name("create volunteer assigns the next code and stores custom fields"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const before = (await api.get("/api/volunteers", auth)).body.length;
      const created = await api.send(
        "POST",
        "/api/volunteers",
        {
          name: "New Person",
          email: "new@x.com",
          phone: "555-0000",
          grade: "9th",
          customFields: { "T-Shirt": "M", Allergy: "Peanuts" },
        },
        auth
      );
      assert.equal(created.status, 201);
      assert.match(created.body.code, /^TCYA-\d{4}$/);
      assert.equal(created.body.customFields["T-Shirt"], "M");
      const after = (await api.get("/api/volunteers", auth)).body.length;
      assert.equal(after, before + 1);
    });
  });

  test(name("create volunteer requires a name"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      assert.equal(
        (await api.send("POST", "/api/volunteers", { name: "   " }, auth)).status,
        400
      );
    });
  });

  test(name("renaming a volunteer cascades to attendance and submissions"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      const vols = (await api.get("/api/volunteers", auth)).body;
      const aaron = vols.find((v) => v.name === V1);

      await logHours(
        api, auth, event.id, V1,
        "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z"
      );

      const renamed = await api.send(
        "PATCH",
        `/api/volunteers/${aaron.id}`,
        { name: `${V1} Jr` },
        auth
      );
      assert.equal(renamed.status, 200);

      const ev = (await api.get("/api/events")).body[0];
      assert.ok(ev.attendance.some((a) => a.volunteerName === `${V1} Jr`));
      assert.equal(ev.attendance.some((a) => a.volunteerName === V1), false);

      const subs = (await api.get("/api/submissions")).body;
      assert.ok(subs.some((s) => s.volunteerName === `${V1} Jr`));
    });
  });

  test(name("delete volunteer keeps their attendance history (name preserved)"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      const vols = (await api.get("/api/volunteers", auth)).body;
      const aaron = vols.find((v) => v.name === V1);
      await api.send(
        "POST",
        `/api/events/${event.id}/attendance`,
        { volunteerNames: [V1] },
        auth
      );
      const del = await api.send("DELETE", `/api/volunteers/${aaron.id}`, undefined, auth);
      assert.equal(del.status, 200);
      const ev = (await api.get("/api/events", auth)).body[0]; // admin view keeps volunteerId
      const row = ev.attendance.find((a) => a.volunteerName === V1);
      assert.ok(row, "attendance row remains after volunteer deletion");
      assert.equal(row.volunteerId, null, "link is severed (SET NULL)");
    });
  });

  // ---------------- Events + the old Netlify flow ----------------

  test(name("create event then add a volunteer to it works"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      const added = await api.send(
        "POST",
        `/api/events/${event.id}/attendance`,
        { volunteerNames: [V1] },
        auth
      );
      assert.equal(added.status, 200);
      assert.equal(added.body.attendance.length, 1);
      assert.equal(added.body.attendance[0].volunteerName, V1);
      // Pre-registering adds to the list but does NOT check them in.
      assert.equal(added.body.attendance[0].staffCheckin, false);
      assert.equal(added.body.attendance[0].volunteerCheckout, false);
      assert.equal(added.body.attendance[0].checkinAt, null, "pre-register sets no check-in time");
    });
  });

  test(name("deleting an event deletes its submissions (no orphaned 'pending' rows)"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await logHours(
        api, auth, event.id, V1,
        "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z"
      );
      assert.equal(
        (await api.get("/api/submissions")).body.filter((s) => s.volunteerName === V1).length,
        1,
        "hours logged from check-in/out"
      );
      await api.send("DELETE", `/api/events/${event.id}`, undefined, auth);
      assert.equal(
        (await api.get("/api/submissions")).body.filter((s) => s.volunteerName === V1).length,
        0,
        "deleting the event removed its submissions — nothing left to show as pending"
      );
      assert.equal((await api.get("/api/events")).body.length, 0);
    });
  });

  // ---------------- QR check-in / check-out ----------------

  test(name("QR check-in marks staff check-in and stamps the time; re-scan keeps the first time"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      const code = await codeFor(api, auth, V1);

      const first = await api.send("POST", `/api/events/${event.id}/checkin`, { code }, auth);
      assert.equal(first.status, 200);
      assert.equal(first.body.ok, true);
      assert.equal(first.body.volunteer.name, V1);
      assert.equal(first.body.attendance.staffCheckin, true);
      assert.equal(first.body.attendance.code, code, "scan response carries the volunteer code");
      assert.ok(first.body.attendance.checkinAt, "check-in time is stamped");
      const firstAt = first.body.attendance.checkinAt;

      const second = await api.send("POST", `/api/events/${event.id}/checkin`, { code }, auth);
      assert.equal(second.body.attendance.checkinAt, firstAt, "re-scan preserves original check-in time");
    });
  });

  test(name("QR check-out marks volunteer check-out and stamps the (latest) time"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      const code = await codeFor(api, auth, V1);
      const out = await api.send("POST", `/api/events/${event.id}/checkout`, { code }, auth);
      assert.equal(out.status, 200);
      assert.equal(out.body.attendance.volunteerCheckout, true);
      assert.ok(out.body.attendance.checkoutAt);
    });
  });

  test(name("QR check-in then check-out yields a fully-confirmed row with both timestamps"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      const code = await codeFor(api, auth, V2);
      await api.send("POST", `/api/events/${event.id}/checkin`, { code }, auth);
      await api.send("POST", `/api/events/${event.id}/checkout`, { code }, auth);
      const ev = (await api.get("/api/events", auth)).body[0]; // admin view keeps timestamps
      const row = ev.attendance.find((a) => a.volunteerName === V2);
      assert.equal(row.staffCheckin, true);
      assert.equal(row.volunteerCheckout, true);
      assert.ok(row.checkinAt && row.checkoutAt);
      assert.equal(row.selfAdded, false);
    });
  });

  test(name("QR check-in with an unknown code returns 404 unknown_code"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      const r = await api.send("POST", `/api/events/${event.id}/checkin`, { code: "TCYA-9999" }, auth);
      assert.equal(r.status, 404);
      assert.equal(r.body.reason, "unknown_code");
    });
  });

  test(name("QR check-in requires a signed-in scanner and a code"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      const code = await codeFor(api, auth, V1);
      assert.equal(
        (await api.send("POST", `/api/events/${event.id}/checkin`, { code })).status,
        401
      );
      assert.equal(
        (await api.send("POST", `/api/events/${event.id}/checkin`, { code }, { "X-Admin-Token": "nope" })).status,
        401
      );
      assert.equal(
        (await api.send("POST", `/api/events/${event.id}/checkin`, {}, auth)).status,
        400
      );
    });
  });

  // ---------------- Manual attendance edits ----------------

  test(name("PATCH attendance toggles flags and auto-stamps a check-in time on first enable"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await api.send(
        "POST",
        `/api/events/${event.id}/attendance`,
        { volunteerNames: [V1] },
        auth
      );
      await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: V1, staffCheckin: false,
      }, auth);
      const on = await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: V1, staffCheckin: true,
      }, auth);
      const row = on.body.attendance.find((a) => a.volunteerName === V1);
      assert.equal(row.staffCheckin, true);
      assert.ok(row.checkinAt, "auto-stamped when enabled without an existing time");
    });
  });

  test(name("PATCH attendance accepts an explicit manual check-in time"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await api.send(
        "POST",
        `/api/events/${event.id}/attendance`,
        { volunteerNames: [V1] },
        auth
      );
      const iso = "2026-03-15T17:30:00.000Z";
      const r = await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: V1, staffCheckin: true, checkinAt: iso,
      }, auth);
      const row = r.body.attendance.find((a) => a.volunteerName === V1);
      assert.equal(row.checkinAt, iso);
    });
  });

  test(name("remove attendee drops the row"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await api.send(
        "POST",
        `/api/events/${event.id}/attendance`,
        { volunteerNames: [V1, V2] },
        auth
      );
      const r = await api.send("DELETE", `/api/events/${event.id}/attendance`, {
        volunteerName: V1,
      }, auth);
      assert.equal(r.status, 200);
      assert.equal(r.body.attendance.length, 1);
      assert.equal(r.body.attendance[0].volunteerName, V2);
    });
  });

  // ---------------- Submission validation + upsert ----------------

  // ---------------- Hours derived from check-in / check-out ----------------

  test(name("setting check-in + check-out times creates a countable submission with computed hours"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      // Give Aaron a grade so we can assert the derived submission picks it up.
      const aaron = (await api.get("/api/volunteers", auth)).body.find((v) => v.name === V1);
      await api.send("PATCH", `/api/volunteers/${aaron.id}`, { grade: "11th" }, auth);
      // 16:00Z–19:00Z = 3.0 hours; local (America/Los_Angeles, PDT) = 09:00–12:00.
      await logHours(
        api, auth, event.id, V1,
        "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z"
      );
      // Read WITH admin auth — the public projection strips the exact
      // arrival/departure clock times (PII of minors).
      const subs = (await api.get("/api/submissions", auth)).body.filter(
        (s) => s.volunteerName === V1
      );
      assert.equal(subs.length, 1, "one derived submission");
      assert.equal(subs[0].hours, 3, "hours = checkout − checkin");
      assert.equal(subs[0].eventId, event.id);
      assert.equal(subs[0].grade, "11th", "derived submission carries the volunteer's grade");
      assert.equal(subs[0].arrivalTime, "09:00", "sign-in HH:MM in chapter tz");
      assert.equal(subs[0].endTime, "12:00", "sign-out HH:MM in chapter tz");
    });
  });

  test(name("public /submissions hides minors' arrival/departure times + comments; admin sees them"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await logHours(
        api, auth, event.id, V1,
        "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z"
      );
      const pub = (await api.get("/api/submissions")).body.find(
        (s) => s.volunteerName === V1
      );
      assert.ok(pub, "public still lists the record (name/grade/hours)");
      assert.equal(pub.hours, 3, "public sees the hour total");
      assert.equal(pub.arrivalTime, undefined, "public must not see the exact sign-in time");
      assert.equal(pub.endTime, undefined, "public must not see the exact sign-out time");
      assert.equal(pub.comments, undefined, "public must not see free-text comments");
      assert.equal(pub.submittedAt, undefined, "public must not see the internal submit timestamp");

      const adm = (await api.get("/api/submissions", auth)).body.find(
        (s) => s.volunteerName === V1
      );
      assert.equal(adm.arrivalTime, "09:00", "admin sees the sign-in time");
      assert.equal(adm.endTime, "12:00", "admin sees the sign-out time");
    });
  });

  test(name("clearing the check-out time removes the derived hours"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await logHours(
        api, auth, event.id, V1,
        "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z"
      );
      assert.equal((await api.get("/api/submissions")).body.length, 1);
      // Clear checkout — no longer complete, so the derived submission goes away.
      await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: V1, checkoutAt: null,
      }, auth);
      assert.equal(
        (await api.get("/api/submissions")).body.length,
        0,
        "incomplete attendance leaves no hours"
      );
    });
  });

  test(name("removing a volunteer from an event deletes their derived hours (fixes stuck pending)"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await logHours(
        api, auth, event.id, V1,
        "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z"
      );
      assert.equal((await api.get("/api/submissions")).body.length, 1);
      await api.send("DELETE", `/api/events/${event.id}/attendance`, { volunteerName: V1 }, auth);
      assert.equal(
        (await api.get("/api/submissions")).body.length,
        0,
        "removing the attendee removed their hours — no orphaned pending row"
      );
    });
  });

  test(name("a complete but sub-quarter-hour visit still yields a (0-hour) submission, not a vanished row"), async () => {
    // Reconcile must gate on raw completeness (isComplete), NOT on the rounded
    // hours value — otherwise a genuine brief visit would silently disappear.
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await logHours(
        api, auth, event.id, V1,
        "2026-03-15T16:00:00.000Z", "2026-03-15T16:05:00.000Z" // 5 min -> rounds to 0
      );
      const subs = (await api.get("/api/submissions")).body.filter(
        (s) => s.volunteerName === V1
      );
      assert.equal(subs.length, 1, "the completed visit is still recorded");
      assert.equal(subs[0].hours, 0, "rounded to zero hours, but present");
    });
  });

  test(name("editing check-in to land after check-out makes the row incomplete and drops the hours"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await logHours(
        api, auth, event.id, V1,
        "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z"
      );
      assert.equal((await api.get("/api/submissions")).body.length, 1);
      // Move check-in to AFTER the existing check-out -> no longer complete.
      await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: V1, checkinAt: "2026-03-15T20:00:00.000Z",
      }, auth);
      assert.equal(
        (await api.get("/api/submissions")).body.length,
        0,
        "checkout < checkin => incomplete => no derived hours"
      );
    });
  });

  test(name("editing the times updates the derived hours in place (no duplicate submission)"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await logHours(
        api, auth, event.id, V1,
        "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z" // 3h
      );
      let subs = (await api.get("/api/submissions")).body.filter(
        (s) => s.volunteerName === V1
      );
      assert.equal(subs.length, 1);
      assert.equal(subs[0].hours, 3);
      // Shorten the visit to 1 hour — same row, recomputed hours.
      await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: V1, checkoutAt: "2026-03-15T17:00:00.000Z",
      }, auth);
      subs = (await api.get("/api/submissions")).body.filter(
        (s) => s.volunteerName === V1
      );
      assert.equal(subs.length, 1, "still exactly one submission for the pair");
      assert.equal(subs[0].hours, 1, "hours recomputed in place");
    });
  });

  // ---------------- Admin reset / export / import ----------------

  test(name("admin reset clears events + submissions but keeps the volunteer roster"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      await makeEvent(api, auth);
      const rosterBefore = (await api.get("/api/volunteers", auth)).body.length;
      const r = await api.send("POST", "/api/admin/reset", { confirm: "RESET" }, auth);
      assert.equal(r.status, 200);
      assert.equal((await api.get("/api/events")).body.length, 0);
      assert.equal((await api.get("/api/submissions")).body.length, 0);
      assert.equal(
        (await api.get("/api/volunteers", auth)).body.length,
        rosterBefore,
        "roster is preserved across reset"
      );
    });
  });

  test(name("admin reset REFUSES without an explicit confirmation (guards against accidental wipes)"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      await makeEvent(api, auth);
      // No confirmation -> 400, nothing touched.
      const noConfirm = await api.send("POST", "/api/admin/reset", {}, auth);
      assert.equal(noConfirm.status, 400);
      assert.match(noConfirm.body.error, /confirm/i);
      const wrong = await api.send("POST", "/api/admin/reset", { confirm: "yes" }, auth);
      assert.equal(wrong.status, 400);
      assert.equal(
        (await api.get("/api/events")).body.length,
        1,
        "events untouched when the wipe is not confirmed"
      );
    });
  });

  test(name("import with a volunteers-only payload PRESERVES existing events + hours (no accidental wipe)"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await logHours(
        api, auth, event.id, V1,
        "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z"
      );
      assert.equal((await api.get("/api/events", auth)).body.length, 1);
      assert.equal((await api.get("/api/submissions", auth)).body.length, 1);
      // Restore ONLY the roster — must NOT delete events/attendance/submissions.
      const vols = (await api.get("/api/volunteers", auth)).body;
      const imp = await api.send("POST", "/api/admin/import", { volunteers: vols }, auth);
      assert.equal(imp.status, 200);
      assert.equal(
        (await api.get("/api/events", auth)).body.length,
        1,
        "events survive a volunteers-only import"
      );
      assert.equal(
        (await api.get("/api/submissions", auth)).body.length,
        1,
        "derived hours survive a volunteers-only import"
      );
    });
  });

  test(name("GET /health reports the storage backend + durability + a live DB probe"), async () => {
    await withServer(async (api) => {
      const r = await api.get("/api/health");
      assert.equal(r.status, 200);
      assert.equal(r.body.ok, true);
      assert.equal(r.body.dbOk, true);
      assert.equal(typeof r.body.backend, "string");
      assert.equal(typeof r.body.persistent, "boolean");
      // persistent must be true exactly when the backend is postgres.
      assert.equal(r.body.persistent, r.body.backend === "postgres");
    });
  });

  test(name("export then import round-trips events/submissions and dedupes legacy duplicates"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await logHours(
        api, auth, event.id, V1,
        "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z"
      );

      const exported = await api.get("/api/admin/export", auth);
      assert.equal(exported.status, 200);
      assert.ok(Array.isArray(exported.body.volunteers));
      assert.ok(Array.isArray(exported.body.events));
      assert.ok(Array.isArray(exported.body.submissions));

      const dupBackup = {
        events: exported.body.events,
        submissions: [
          ...exported.body.submissions,
          { ...exported.body.submissions[0], id: "dup-1", hours: 999, submittedAt: "2000-01-01T00:00:00.000Z" },
        ],
      };
      const imp = await api.send("POST", "/api/admin/import", dupBackup, auth);
      assert.equal(imp.status, 200);
      const after = (await api.get("/api/submissions")).body.filter(
        (s) => s.eventId === event.id && s.volunteerName === V1
      );
      assert.equal(after.length, 1, "duplicate collapsed to one");
      assert.notEqual(after[0].hours, 999, "kept the newer row, not the stale dup");
    });
  });

  test(name("import requires at least one data array"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      assert.equal((await api.send("POST", "/api/admin/import", {}, auth)).status, 400);
    });
  });

  test(name("import rejects duplicate volunteer codes/ids up front"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const dupCode = {
        volunteers: [
          { code: "TCYA-0001", name: "A" },
          { code: "TCYA-0001", name: "B" },
        ],
      };
      const r = await api.send("POST", "/api/admin/import", dupCode, auth);
      assert.equal(r.status, 400);
      assert.match(r.body.error, /[Dd]uplicate volunteer code/);
    });
  });

  test(name("import round-trips the volunteer roster and keeps codes sequential"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const before = (await api.get("/api/volunteers", auth)).body;
      const exported = (await api.get("/api/admin/export", auth)).body;
      const maxNum = Math.max(
        ...before.map((v) => parseInt(v.code.replace(/\D/g, ""), 10))
      );
      const imp = await api.send("POST", "/api/admin/import", exported, auth);
      assert.equal(imp.status, 200);
      assert.equal(imp.body.counts.volunteers, before.length);
      const after = (await api.get("/api/volunteers", auth)).body;
      assert.equal(after.find((v) => v.name === V1).code, "TCYA-0001");
      // Next created volunteer must get max+1 with no collision.
      const created = await api.send("POST", "/api/volunteers", { name: "Post Restore" }, auth);
      assert.equal(created.status, 201);
      assert.equal(created.body.code, `TCYA-${String(maxNum + 1).padStart(4, "0")}`);
    });
  });

  // ---------------- Duplicate-name guard ----------------

  test(name("creating a volunteer with an existing name needs force"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const dup = await api.send("POST", "/api/volunteers", { name: V1 }, auth);
      assert.equal(dup.status, 409);
      assert.equal(dup.body.code, "duplicate_name");
      const forced = await api.send(
        "POST",
        "/api/volunteers",
        { name: V1, force: true },
        auth
      );
      assert.equal(forced.status, 201);
    });
  });

  // ---------------- Rename collisions ----------------

  test(name("rename that collides on event attendance returns 409 and changes nothing"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await api.send(
        "POST",
        `/api/events/${event.id}/attendance`,
        { volunteerNames: [V1, V2] },
        auth
      );
      const aaron = (await api.get("/api/volunteers", auth)).body.find(
        (v) => v.name === V1
      );
      const r = await api.send(
        "PATCH",
        `/api/volunteers/${aaron.id}`,
        { name: V2 },
        auth
      );
      assert.equal(r.status, 409);
      const ev = (await api.get("/api/events")).body[0];
      assert.ok(ev.attendance.some((a) => a.volunteerName === V1));
      assert.ok(ev.attendance.some((a) => a.volunteerName === V2));
    });
  });

  // ---------------- Boolean flags stay in lock-step with timestamps ----------------

  test(name("checkout-only edit on a pre-registered volunteer does NOT auto-stamp a bogus check-in"), async () => {
    // Regression for the round-2 HIGH bug: pre-register (no check-in), then set
    // only a PAST checkout. Must not stamp check-in=now (which would make
    // checkout < checkin and silently drop the hours). The row stays incomplete.
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await api.send("POST", `/api/events/${event.id}/attendance`, { volunteerNames: [V1] }, auth);
      const r = await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: V1, checkoutAt: "2026-03-15T20:00:00.000Z",
      }, auth);
      const row = r.body.attendance.find((a) => a.volunteerName === V1);
      assert.equal(row.volunteerCheckout, true);
      assert.equal(row.staffCheckin, false, "no bogus check-in");
      assert.equal(row.checkinAt, null, "no bogus check-in time");
      assert.equal((await api.get("/api/submissions")).body.length, 0, "incomplete => no hours");
    });
  });

  test(name("setting a check-out time marks it checked; the check-in side is untouched"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      const code = await codeFor(api, auth, V1);
      await api.send("POST", `/api/events/${event.id}/checkin`, { code }, auth); // real check-in
      const iso = "2026-03-15T20:00:00.000Z";
      const r = await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: V1, checkoutAt: iso,
      }, auth);
      const row = r.body.attendance.find((a) => a.volunteerName === V1);
      assert.equal(row.volunteerCheckout, true);
      assert.equal(row.checkoutAt, iso);
      assert.equal(row.staffCheckin, true, "the real check-in is preserved");
    });
  });

  test(name("clearing a check-in time also un-checks the flag AND drops the derived hours"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      // Log complete hours first.
      await logHours(
        api, auth, event.id, V1,
        "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z"
      );
      assert.equal((await api.get("/api/submissions")).body.length, 1);
      // Clear the check-in time.
      const r = await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: V1, checkinAt: null,
      }, auth);
      const row = r.body.attendance.find((a) => a.volunteerName === V1);
      assert.equal(row.checkinAt, null, "time cleared");
      assert.equal(row.staffCheckin, false, "flag follows the timestamp");
      assert.equal((await api.get("/api/submissions")).body.length, 0, "hours dropped");
    });
  });

  test(name("toggling the staff check-in flag off clears the time and drops hours"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await logHours(
        api, auth, event.id, V1,
        "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z"
      );
      const r = await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: V1, staffCheckin: false,
      }, auth);
      const row = r.body.attendance.find((a) => a.volunteerName === V1);
      assert.equal(row.staffCheckin, false);
      assert.equal(row.checkinAt, null, "toggling off clears the time");
      assert.equal((await api.get("/api/submissions")).body.length, 0);
    });
  });

  // ---------------- addAttendees dedupe ----------------

  test(name("adding the same name twice in one request yields a single row"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      const r = await api.send(
        "POST",
        `/api/events/${event.id}/attendance`,
        { volunteerNames: [V1, V1] },
        auth
      );
      assert.equal(r.status, 200);
      assert.equal(
        r.body.attendance.filter((a) => a.volunteerName === V1).length,
        1
      );
    });
  });

  // ---------------- Malformed ids degrade gracefully ----------------

  test(name("malformed eventId on check-in returns 404, not 500"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const code = await codeFor(api, auth, V1);
      const r = await api.send("POST", "/api/events/not-a-uuid/checkin", { code }, auth);
      assert.equal(r.status, 404);
    });
  });

  test(name("malformed volunteer id returns 404, not 500"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      assert.equal(
        (await api.send("PATCH", "/api/volunteers/not-a-uuid", { grade: "9th" }, auth)).status,
        404
      );
      assert.equal(
        (await api.send("DELETE", "/api/volunteers/not-a-uuid", undefined, auth)).status,
        404
      );
    });
  });

  // ---------------- Scan edge cases ----------------

  test(name("check-in on a nonexistent event returns 404 unknown_event mapping"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const code = await codeFor(api, auth, V1);
      const r = await api.send(
        "POST",
        "/api/events/11111111-1111-1111-1111-111111111111/checkin",
        { code },
        auth
      );
      assert.equal(r.status, 404);
    });
  });

  test(name("re-scanning a checked-in volunteer reports alreadyDone"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      const code = await codeFor(api, auth, V1);
      const first = await api.send("POST", `/api/events/${event.id}/checkin`, { code }, auth);
      assert.equal(first.body.alreadyDone, false);
      const second = await api.send("POST", `/api/events/${event.id}/checkin`, { code }, auth);
      assert.equal(second.body.alreadyDone, true);
    });
  });

  test(name("login without a password returns 400"), async () => {
    await withServer(async (api) => {
      assert.equal(
        (await api.send("POST", "/api/login", { username: "admin" })).status,
        400
      );
    });
  });

  test(name("public /events hides codes, volunteer ids, and timestamps; admin sees them"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      const code = await codeFor(api, auth, V1);
      await api.send("POST", `/api/events/${event.id}/checkin`, { code }, auth);

      const pub = (await api.get("/api/events")).body[0].attendance[0];
      assert.equal(pub.volunteerName, V1);
      assert.equal(typeof pub.staffCheckin, "boolean");
      assert.equal(pub.code, undefined, "public must not leak the QR code");
      assert.equal(pub.volunteerId, undefined, "public must not leak internal id");
      assert.equal(pub.checkinAt, undefined, "public must not leak the check-in time");
      assert.equal(JSON.stringify(pub).includes("TCYA-0001"), false);

      const adm = (await api.get("/api/events", auth)).body[0].attendance.find(
        (a) => a.volunteerName === V1
      );
      assert.equal(adm.code, "TCYA-0001", "admin sees the code");
      assert.ok(adm.checkinAt, "admin sees the check-in time");
    });
  });

  // ---------------- Officers (roles) ----------------

  test(name("the one-time migration promotes the chapter's officers and no one else"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const vols = (await api.get("/api/volunteers", auth)).body;
      for (const n of OFFICER_NAMES) {
        const v = vols.find((x) => x.name === n);
        if (!v) continue; // not on this roster — migration correctly skips it
        assert.equal(v.role, "officer", `${n} should be an officer`);
      }
      assert.equal(
        vols.find((v) => v.name === V1).role,
        "volunteer",
        "a non-officer keeps the default role"
      );
      // The former members the purge migration targets must not be on the
      // roster at all (they are not seeded), so nothing can resurrect them.
      for (const n of RETIRED_MEMBER_NAMES) {
        assert.equal(
          vols.some((v) => v.name === n),
          false,
          `${n} must not be seeded back onto the roster`
        );
      }
    });
  });

  test(name("role is editable, validated, and surfaced on the roster + attendance"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const v1 = (await api.get("/api/volunteers", auth)).body.find((v) => v.name === V1);

      const bad = await api.send("PATCH", `/api/volunteers/${v1.id}`, { role: "admin" }, auth);
      assert.equal(bad.status, 400, "an unknown role is rejected, never silently demoted");

      const up = await api.send("PATCH", `/api/volunteers/${v1.id}`, { role: "officer" }, auth);
      assert.equal(up.status, 200);
      assert.equal(up.body.role, "officer");
      assert.equal(
        (await api.get("/api/roster")).body.find((r) => r.name === V1).role,
        "officer",
        "the public roster shows the badge-driving role"
      );

      // The attendance row carries the role too, so the event page can badge it.
      const event = await makeEvent(api, auth);
      await api.send("POST", `/api/events/${event.id}/attendance`, { volunteerNames: [V1] }, auth);
      const row = (await api.get("/api/events", auth)).body[0].attendance.find(
        (a) => a.volunteerName === V1
      );
      assert.equal(row.role, "officer");
    });
  });

  // ---------------- Expected hours + the per-event cap ----------------

  test(name("events store start/end time + expected hours, and validate them"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const ev = await makeEvent(api, auth, {
        startTime: "09:00",
        endTime: "12:30",
        expectedHours: 3.5,
      });
      assert.equal(ev.startTime, "09:00");
      assert.equal(ev.endTime, "12:30");
      assert.equal(ev.expectedHours, 3.5);

      // Defaults when omitted: no times, and NO cap (null, not 0).
      const bare = await makeEvent(api, auth);
      assert.equal(bare.startTime, "");
      assert.equal(bare.endTime, "");
      assert.equal(bare.expectedHours, null, "omitted expected hours means no cap");

      for (const bad of [
        { startTime: "9am" },
        { endTime: "25:00" },
        { expectedHours: -1 },
        { expectedHours: "lots" },
      ]) {
        const r = await api.send(
          "POST",
          "/api/events",
          { name: "Culture - Beach Cleanup", date: "2026-03-15", ...bad },
          auth
        );
        assert.equal(r.status, 400, `should reject ${JSON.stringify(bad)}`);
      }
    });
  });

  test(name("an ordinary volunteer's hours are capped at the event's expected hours"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth, { expectedHours: 3 });
      // 16:00Z → 20:00Z is a 4.0h span; the event is only worth 3.
      await logHours(api, auth, event.id, V1, "2026-03-15T16:00:00.000Z", "2026-03-15T20:00:00.000Z");
      const sub = (await api.get("/api/submissions", auth)).body.find(
        (s) => s.volunteerName === V1
      );
      assert.equal(sub.hours, 3, "credited hours are capped at the expected hours");
      assert.equal(sub.rawHours, 4, "the uncapped span is still recorded");
    });
  });

  test(name("an OFFICER exceeds the expected hours (set-up time counts)"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth, { expectedHours: 3 });
      await logHours(api, auth, event.id, OFFICER, "2026-03-15T16:00:00.000Z", "2026-03-15T20:00:00.000Z");
      const sub = (await api.get("/api/submissions", auth)).body.find(
        (s) => s.volunteerName === OFFICER
      );
      assert.equal(sub.hours, 4, "officers are not capped");
      assert.equal(sub.rawHours, 4);
    });
  });

  test(name("a volunteer under the cap keeps their real hours"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth, { expectedHours: 5 });
      await logHours(api, auth, event.id, V1, "2026-03-15T16:00:00.000Z", "2026-03-15T18:00:00.000Z");
      const sub = (await api.get("/api/submissions", auth)).body.find(
        (s) => s.volunteerName === V1
      );
      assert.equal(sub.hours, 2, "the cap is a ceiling, not a target");
    });
  });

  test(name("an event with NO expected hours caps nobody (existing history is untouched)"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth); // no expectedHours
      await logHours(api, auth, event.id, V1, "2026-03-15T16:00:00.000Z", "2026-03-15T23:00:00.000Z");
      const sub = (await api.get("/api/submissions", auth)).body.find(
        (s) => s.volunteerName === V1
      );
      assert.equal(sub.hours, 7, "no cap set ⇒ the full span is credited");
      assert.equal(sub.rawHours, 7);
    });
  });

  test(name("PATCH /events applies the new expected hours to ALREADY-logged hours"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth); // uncapped to start
      await logHours(api, auth, event.id, V1, "2026-03-15T16:00:00.000Z", "2026-03-15T20:00:00.000Z");
      await logHours(api, auth, event.id, OFFICER, "2026-03-15T16:00:00.000Z", "2026-03-15T20:00:00.000Z");
      const before = (await api.get("/api/submissions", auth)).body;
      assert.equal(before.find((s) => s.volunteerName === V1).hours, 4);

      const patched = await api.send("PATCH", `/api/events/${event.id}`, { expectedHours: 2.5 }, auth);
      assert.equal(patched.status, 200);
      assert.equal(patched.body.expectedHours, 2.5);

      const after = (await api.get("/api/submissions", auth)).body;
      assert.equal(
        after.find((s) => s.volunteerName === V1).hours,
        2.5,
        "the volunteer's already-credited hours are re-derived down to the cap"
      );
      assert.equal(
        after.find((s) => s.volunteerName === OFFICER).hours,
        4,
        "the officer is still uncapped"
      );
      // Raising the cap again restores the full span.
      await api.send("PATCH", `/api/events/${event.id}`, { expectedHours: null }, auth);
      assert.equal(
        (await api.get("/api/submissions", auth)).body.find((s) => s.volunteerName === V1).hours,
        4,
        "clearing the cap restores the real hours — the raw span is never lost"
      );
    });
  });

  test(name("promoting a volunteer to officer re-derives their EXISTING hours"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth, { expectedHours: 3 });
      await logHours(api, auth, event.id, V1, "2026-03-15T16:00:00.000Z", "2026-03-15T20:00:00.000Z");
      assert.equal(
        (await api.get("/api/submissions", auth)).body.find((s) => s.volunteerName === V1).hours,
        3
      );
      const v1 = (await api.get("/api/volunteers", auth)).body.find((v) => v.name === V1);
      await api.send("PATCH", `/api/volunteers/${v1.id}`, { role: "officer" }, auth);
      assert.equal(
        (await api.get("/api/submissions", auth)).body.find((s) => s.volunteerName === V1).hours,
        4,
        "promotion lifts the cap on hours already recorded"
      );
      await api.send("PATCH", `/api/volunteers/${v1.id}`, { role: "volunteer" }, auth);
      assert.equal(
        (await api.get("/api/submissions", auth)).body.find((s) => s.volunteerName === V1).hours,
        3,
        "demotion re-applies it"
      );
    });
  });

  test(name("PATCH /events renaming/redating an event re-syncs its derived submissions"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await logHours(api, auth, event.id, V1, "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z");
      await api.send(
        "PATCH",
        `/api/events/${event.id}`,
        { name: "Others - please specify", customName: "Rescheduled Cleanup", date: "2026-04-02" },
        auth
      );
      const sub = (await api.get("/api/submissions", auth)).body.find(
        (s) => s.volunteerName === V1
      );
      assert.equal(sub.eventDate, "2026-04-02", "the submission follows the event's date");
      assert.equal(sub.eventName, "Rescheduled Cleanup");
      assert.equal(sub.customEventName, "Rescheduled Cleanup");
      assert.equal(sub.hours, 3, "hours are unchanged by a rename");
    });
  });

  test(name("PATCH /events validates, 404s on an unknown event, and needs a field"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      assert.equal(
        (await api.send("PATCH", `/api/events/${event.id}`, { date: "nope" }, auth)).status,
        400
      );
      assert.equal(
        (await api.send("PATCH", `/api/events/${event.id}`, {}, auth)).status,
        400
      );
      assert.equal(
        (await api.send("PATCH", `/api/events/${event.id}`, { date: "2026-05-01" })).status,
        401,
        "editing an event requires admin"
      );
      assert.equal(
        (await api.send(
          "PATCH",
          "/api/events/11111111-1111-1111-1111-111111111111",
          { date: "2026-05-01" },
          auth
        )).status,
        404
      );
    });
  });

  // ---------------- Conduct strikes ----------------

  test(name("an admin can add and clear a strike; it never touches hours"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth, { expectedHours: 4 });
      await logHours(api, auth, event.id, V1, "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z");

      const on = await api.send(
        "PATCH",
        `/api/events/${event.id}/attendance`,
        { volunteerName: V1, strikes: 1 },
        auth
      );
      assert.equal(on.status, 200);
      assert.equal(on.body.attendance.find((a) => a.volunteerName === V1).strikes, 1);
      assert.equal(
        (await api.get("/api/submissions", auth)).body.find((s) => s.volunteerName === V1).hours,
        3,
        "a strike does not change credited hours"
      );

      const off = await api.send(
        "PATCH",
        `/api/events/${event.id}/attendance`,
        { volunteerName: V1, strikes: 0 },
        auth
      );
      assert.equal(off.body.attendance.find((a) => a.volunteerName === V1).strikes, 0);
    });
  });

  test(name("attendance rows default to 0 strikes and reject malformed values"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      const added = await api.send(
        "POST",
        `/api/events/${event.id}/attendance`,
        { volunteerNames: [V1] },
        auth
      );
      assert.equal(added.body.attendance[0].strikes, 0);

      for (const bad of [-1, 1.5, "many", 1000]) {
        const r = await api.send(
          "PATCH",
          `/api/events/${event.id}/attendance`,
          { volunteerName: V1, strikes: bad },
          auth
        );
        assert.equal(r.status, 400, `should reject strikes=${JSON.stringify(bad)}`);
      }
      // …and the original value survived every rejected write.
      const row = (await api.get("/api/events", auth)).body[0].attendance.find(
        (a) => a.volunteerName === V1
      );
      assert.equal(row.strikes, 0);
    });
  });

  test(name("strikes survive a check-in toggle and reach the public roster view"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await api.send("POST", `/api/events/${event.id}/attendance`, { volunteerNames: [V1] }, auth);
      await api.send(
        "PATCH",
        `/api/events/${event.id}/attendance`,
        { volunteerName: V1, strikes: 2 },
        auth
      );
      // Toggling attendance must not clobber an unrelated column.
      await api.send(
        "PATCH",
        `/api/events/${event.id}/attendance`,
        { volunteerName: V1, staffCheckin: true },
        auth
      );
      const pub = (await api.get("/api/events")).body[0].attendance.find(
        (a) => a.volunteerName === V1
      );
      assert.equal(pub.strikes, 2, "the strike count survived and is visible to volunteers");
      assert.equal(pub.code, undefined, "…without leaking the QR code");
      assert.equal(pub.checkinAt, undefined, "…or the check-in time");
    });
  });

  test(name("public /submissions hides the uncapped raw hours; admin sees them"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth, { expectedHours: 1 });
      await logHours(api, auth, event.id, V1, "2026-03-15T16:00:00.000Z", "2026-03-15T20:00:00.000Z");
      const pub = (await api.get("/api/submissions")).body.find((s) => s.volunteerName === V1);
      assert.equal(pub.hours, 1, "the public sees the credited total");
      assert.equal(pub.rawHours, undefined, "…but not the exact time on site");
      const adm = (await api.get("/api/submissions", auth)).body.find(
        (s) => s.volunteerName === V1
      );
      assert.equal(adm.rawHours, 4, "the admin can see why the credit was capped");
    });
  });

  // ---------------- The officer account (scanner-only access) ----------------
  //
  // The chapter's rule: an officer opens an event an admin already made and
  // scans QR codes. Nothing else. These tests are the enforcement — every
  // mutating admin route is asserted to reject the officer token.

  test(name("an officer can check volunteers in and out by QR"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const officer = await officerToken(api);
      const event = await makeEvent(api, auth);
      const code = await codeFor(api, auth, V1);

      const inR = await api.send("POST", `/api/events/${event.id}/checkin`, { code }, officer);
      assert.equal(inR.status, 200, JSON.stringify(inR.body));
      assert.equal(inR.body.attendance.staffCheckin, true);
      assert.ok(inR.body.attendance.checkinAt, "the scan stamped a check-in time");

      const outR = await api.send("POST", `/api/events/${event.id}/checkout`, { code }, officer);
      assert.equal(outR.status, 200);
      assert.equal(outR.body.attendance.volunteerCheckout, true);

      // …and the hours the officer's two scans produced are real, derived hours.
      const sub = (await api.get("/api/submissions", auth)).body.find(
        (x) => x.volunteerName === V1 && x.eventId === event.id
      );
      assert.ok(sub, "the officer's scans derived a submission");
    });
  });

  test(name("an officer CANNOT create, edit or delete events"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const officer = await officerToken(api);
      const event = await makeEvent(api, auth);

      const create = await api.send(
        "POST",
        "/api/events",
        { name: "Culture - Beach Cleanup", date: "2026-04-01" },
        officer
      );
      assert.equal(create.status, 403);
      assert.equal(create.body.code, "officer_forbidden");

      assert.equal(
        (await api.send("PATCH", `/api/events/${event.id}`, { date: "2026-04-02" }, officer)).status,
        403
      );
      assert.equal(
        (await api.send("DELETE", `/api/events/${event.id}`, undefined, officer)).status,
        403
      );
      // Nothing changed.
      const after = (await api.get("/api/events", auth)).body;
      assert.equal(after.length, 1);
      assert.equal(after[0].date, "2026-03-15");
    });
  });

  test(name("an officer CANNOT edit hours, times, strikes or the attendance list"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const officer = await officerToken(api);
      const event = await makeEvent(api, auth);
      await api.send("POST", `/api/events/${event.id}/attendance`, { volunteerNames: [V1] }, auth);

      // Add / remove attendees.
      assert.equal(
        (await api.send("POST", `/api/events/${event.id}/attendance`, { volunteerNames: [V2] }, officer)).status,
        403
      );
      assert.equal(
        (await api.send("DELETE", `/api/events/${event.id}/attendance`, { volunteerName: V1 }, officer)).status,
        403
      );
      // Hand-set a check-in/out time — the override the chapter explicitly
      // wants officers locked out of.
      const patch = await api.send(
        "PATCH",
        `/api/events/${event.id}/attendance`,
        { volunteerName: V1, checkinAt: "2026-03-15T16:00:00.000Z", checkoutAt: "2026-03-15T23:00:00.000Z" },
        officer
      );
      assert.equal(patch.status, 403);
      assert.equal(patch.body.code, "officer_forbidden");
      // Strikes are a judgement call — admins only.
      assert.equal(
        (await api.send("PATCH", `/api/events/${event.id}/attendance`, { volunteerName: V1, strikes: 1 }, officer)).status,
        403
      );

      const row = (await api.get("/api/events", auth)).body[0].attendance;
      assert.equal(row.length, 1, "the roster for this event is untouched");
      assert.equal(row[0].volunteerName, V1);
      assert.equal(row[0].checkinAt, null, "no time was forged");
      assert.equal(row[0].strikes, 0);
      assert.equal((await api.get("/api/submissions", auth)).body.length, 0, "no hours were created");
    });
  });

  test(name("an officer CANNOT read or change the volunteer roster, exports or resets"), async () => {
    await withServer(async (api) => {
      const officer = await officerToken(api);
      assert.equal((await api.get("/api/volunteers", officer)).status, 403);
      assert.equal((await api.send("POST", "/api/volunteers", { name: "X" }, officer)).status, 403);
      assert.equal((await api.send("PATCH", "/api/volunteers/whatever", { grade: "12" }, officer)).status, 403);
      assert.equal((await api.send("DELETE", "/api/volunteers/whatever", undefined, officer)).status, 403);
      assert.equal((await api.get("/api/admin/export", officer)).status, 403);
      assert.equal((await api.send("POST", "/api/admin/import", { volunteers: [] }, officer)).status, 403);
      assert.equal((await api.send("POST", "/api/admin/reset", { confirm: "RESET" }, officer)).status, 403);
      // Still on the roster afterwards.
      assert.ok((await api.get("/api/roster")).body.length > 0);
    });
  });

  test(name("an officer sees check-in times but never QR codes or contact details"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const officer = await officerToken(api);
      const event = await makeEvent(api, auth);
      const code = await codeFor(api, auth, V1);
      const scan = await api.send("POST", `/api/events/${event.id}/checkin`, { code }, officer);
      assert.equal(scan.status, 200);
      // The scan echoes back the card they just scanned — name + code — but
      // none of the stored contact details.
      assert.equal(scan.body.volunteer.name, V1);
      assert.equal(scan.body.volunteer.email, undefined);
      assert.equal(scan.body.volunteer.phone, undefined);
      assert.equal(scan.body.volunteer.customFields, undefined);
      assert.equal(scan.body.event.attendance[0].code, undefined);

      const ev = (await api.get("/api/events", officer)).body[0];
      const row = ev.attendance.find((a) => a.volunteerName === V1);
      assert.ok(row.checkinAt, "an officer running the door sees who is already in");
      assert.equal(row.code, undefined, "…but cannot harvest QR codes from the list");
      assert.equal(row.volunteerId, undefined);
      assert.equal(JSON.stringify(ev).includes("TCYA-0001"), false);
    });
  });

  // ---------------- Events page order ----------------

  test(name("the events page order is empty until an admin sets one"), async () => {
    await withServer(async (api) => {
      const r = await api.get("/api/event-order");
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, []);
    });
  });

  test(name("an admin can save the event order; everyone reads the same one"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const saved = await api.send(
        "PUT",
        "/api/event-order",
        { names: ["Culture - Beach Cleanup", "Recycling", "Others - Bake Sale"] },
        auth
      );
      assert.equal(saved.status, 200);
      assert.deepEqual(saved.body, [
        { name: "Culture - Beach Cleanup", position: 0 },
        { name: "Recycling", position: 1 },
        { name: "Others - Bake Sale", position: 2 },
      ]);
      // Anonymous + officer readers see the identical order (it is not PII).
      assert.deepEqual((await api.get("/api/event-order")).body, saved.body);
      assert.deepEqual(
        (await api.get("/api/event-order", await officerToken(api))).body,
        saved.body
      );

      // Saving again REPLACES the order (so renamed/removed groups are pruned)
      // and re-indexes positions from 0.
      const again = await api.send("PUT", "/api/event-order", { names: ["Recycling"] }, auth);
      assert.deepEqual(again.body, [{ name: "Recycling", position: 0 }]);
      assert.deepEqual((await api.get("/api/event-order")).body, again.body);

      // An empty list clears it — back to the automatic order.
      assert.deepEqual((await api.send("PUT", "/api/event-order", { names: [] }, auth)).body, []);
      assert.deepEqual((await api.get("/api/event-order")).body, []);
    });
  });

  test(name("saving the event order trims, de-dupes and validates"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      assert.deepEqual(
        (await api.send("PUT", "/api/event-order", { names: ["  Recycling  ", "Recycling", "", "   "] }, auth)).body,
        [{ name: "Recycling", position: 0 }]
      );
      assert.equal((await api.send("PUT", "/api/event-order", { names: "Recycling" }, auth)).status, 400);
      assert.equal((await api.send("PUT", "/api/event-order", { names: [1, 2] }, auth)).status, 400);
      assert.equal((await api.send("PUT", "/api/event-order", {}, auth)).status, 400);
    });
  });

  test(name("only an admin can change the event order"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      await api.send("PUT", "/api/event-order", { names: ["Recycling"] }, auth);
      assert.equal(
        (await api.send("PUT", "/api/event-order", { names: ["Hacked"] })).status,
        401
      );
      assert.equal(
        (await api.send("PUT", "/api/event-order", { names: ["Hacked"] }, await officerToken(api))).status,
        403
      );
      assert.deepEqual((await api.get("/api/event-order")).body, [
        { name: "Recycling", position: 0 },
      ]);
    });
  });

  test(name("export/import round-trips the event order, and a payload without one leaves it alone"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      await api.send("PUT", "/api/event-order", { names: ["Recycling", "Culture - Beach Cleanup"] }, auth);

      const dump = (await api.get("/api/admin/export", auth)).body;
      assert.deepEqual(dump.eventOrder, ["Recycling", "Culture - Beach Cleanup"]);

      // A volunteers-only import must not disturb it (same by-category rule as
      // events and submissions).
      await api.send("POST", "/api/admin/import", { volunteers: dump.volunteers }, auth);
      assert.deepEqual((await api.get("/api/event-order")).body, [
        { name: "Recycling", position: 0 },
        { name: "Culture - Beach Cleanup", position: 1 },
      ]);

      // A payload that DOES carry an order replaces it.
      await api.send("POST", "/api/admin/import", { events: [], eventOrder: ["Culture - Beach Cleanup"] }, auth);
      assert.deepEqual((await api.get("/api/event-order")).body, [
        { name: "Culture - Beach Cleanup", position: 0 },
      ]);
    });
  });

  test(name("admin reset clears the event order along with the events"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      await api.send("PUT", "/api/event-order", { names: ["Recycling"] }, auth);
      await api.send("POST", "/api/admin/reset", { confirm: "RESET" }, auth);
      assert.deepEqual((await api.get("/api/event-order")).body, []);
    });
  });
}
