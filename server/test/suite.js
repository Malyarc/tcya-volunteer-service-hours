// The shared router test suite. It is parameterized by a `withServer(run)`
// harness so the exact same behavioral assertions run against BOTH storage
// backends: the in-memory store (routes.test.js) and a live Postgres database
// (store-parity.test.js). Keeping one suite is what guarantees the two stores
// stay in lock-step.

import test from "node:test";
import assert from "node:assert/strict";

export function runSuite(withServer, label) {
  const name = (t) => `[${label}] ${t}`;

  async function adminToken(api) {
    const r = await api.send("POST", "/api/login", {
      username: "admin",
      password: "1013",
    });
    assert.equal(r.status, 200);
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
        (await api.send("POST", "/api/login", { username: "admin", password: "x" }))
          .status,
        401
      );
      assert.equal(
        (await api.send("POST", "/api/login", { username: "nope", password: "1013" }))
          .status,
        401
      );
      const ok = await api.send("POST", "/api/login", {
        username: "admin",
        password: "1013",
      });
      assert.equal(ok.status, 200);
      assert.equal(typeof ok.body.token, "string");
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

  test(name("public roster returns names + grade only, never contact info"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const vols = (await api.get("/api/volunteers", auth)).body;
      const aaron = vols.find((v) => v.name === "Aaron Tse");
      await api.send(
        "PATCH",
        `/api/volunteers/${aaron.id}`,
        { email: "a@x.com", phone: "555-1234" },
        auth
      );
      const roster = await api.get("/api/roster");
      assert.equal(roster.status, 200);
      assert.ok(Array.isArray(roster.body));
      const r = roster.body.find((x) => x.name === "Aaron Tse");
      assert.ok(r);
      assert.deepEqual(Object.keys(r).sort(), ["grade", "name"]);
      assert.equal(JSON.stringify(roster.body).includes("555-1234"), false);
      assert.equal(JSON.stringify(roster.body).includes("a@x.com"), false);
    });
  });

  // ---------------- Volunteers ----------------

  test(name("volunteers seed with sequential TCYA codes; Aaron is TCYA-0001"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const vols = (await api.get("/api/volunteers", auth)).body;
      assert.ok(vols.length >= 90);
      const aaron = vols.find((v) => v.name === "Aaron Tse");
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
      const aaron = vols.find((v) => v.name === "Aaron Tse");

      await logHours(
        api, auth, event.id, "Aaron Tse",
        "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z"
      );

      const renamed = await api.send(
        "PATCH",
        `/api/volunteers/${aaron.id}`,
        { name: "Aaron Tse Jr" },
        auth
      );
      assert.equal(renamed.status, 200);

      const ev = (await api.get("/api/events")).body[0];
      assert.ok(ev.attendance.some((a) => a.volunteerName === "Aaron Tse Jr"));
      assert.equal(ev.attendance.some((a) => a.volunteerName === "Aaron Tse"), false);

      const subs = (await api.get("/api/submissions")).body;
      assert.ok(subs.some((s) => s.volunteerName === "Aaron Tse Jr"));
    });
  });

  test(name("delete volunteer keeps their attendance history (name preserved)"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      const vols = (await api.get("/api/volunteers", auth)).body;
      const aaron = vols.find((v) => v.name === "Aaron Tse");
      await api.send(
        "POST",
        `/api/events/${event.id}/attendance`,
        { volunteerNames: ["Aaron Tse"] },
        auth
      );
      const del = await api.send("DELETE", `/api/volunteers/${aaron.id}`, undefined, auth);
      assert.equal(del.status, 200);
      const ev = (await api.get("/api/events", auth)).body[0]; // admin view keeps volunteerId
      const row = ev.attendance.find((a) => a.volunteerName === "Aaron Tse");
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
        { volunteerNames: ["Aaron Tse"] },
        auth
      );
      assert.equal(added.status, 200);
      assert.equal(added.body.attendance.length, 1);
      assert.equal(added.body.attendance[0].volunteerName, "Aaron Tse");
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
        api, auth, event.id, "Aaron Tse",
        "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z"
      );
      assert.equal(
        (await api.get("/api/submissions")).body.filter((s) => s.volunteerName === "Aaron Tse").length,
        1,
        "hours logged from check-in/out"
      );
      await api.send("DELETE", `/api/events/${event.id}`, undefined, auth);
      assert.equal(
        (await api.get("/api/submissions")).body.filter((s) => s.volunteerName === "Aaron Tse").length,
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
      const code = await codeFor(api, auth, "Aaron Tse");

      const first = await api.send("POST", `/api/events/${event.id}/checkin`, { code }, auth);
      assert.equal(first.status, 200);
      assert.equal(first.body.ok, true);
      assert.equal(first.body.volunteer.name, "Aaron Tse");
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
      const code = await codeFor(api, auth, "Aaron Tse");
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
      const code = await codeFor(api, auth, "Amber Wang");
      await api.send("POST", `/api/events/${event.id}/checkin`, { code }, auth);
      await api.send("POST", `/api/events/${event.id}/checkout`, { code }, auth);
      const ev = (await api.get("/api/events", auth)).body[0]; // admin view keeps timestamps
      const row = ev.attendance.find((a) => a.volunteerName === "Amber Wang");
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

  test(name("QR check-in requires admin and a code"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      const code = await codeFor(api, auth, "Aaron Tse");
      assert.equal(
        (await api.send("POST", `/api/events/${event.id}/checkin`, { code })).status,
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
        { volunteerNames: ["Aaron Tse"] },
        auth
      );
      await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: "Aaron Tse", staffCheckin: false,
      }, auth);
      const on = await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: "Aaron Tse", staffCheckin: true,
      }, auth);
      const row = on.body.attendance.find((a) => a.volunteerName === "Aaron Tse");
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
        { volunteerNames: ["Aaron Tse"] },
        auth
      );
      const iso = "2026-03-15T17:30:00.000Z";
      const r = await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: "Aaron Tse", staffCheckin: true, checkinAt: iso,
      }, auth);
      const row = r.body.attendance.find((a) => a.volunteerName === "Aaron Tse");
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
        { volunteerNames: ["Aaron Tse", "Amber Wang"] },
        auth
      );
      const r = await api.send("DELETE", `/api/events/${event.id}/attendance`, {
        volunteerName: "Aaron Tse",
      }, auth);
      assert.equal(r.status, 200);
      assert.equal(r.body.attendance.length, 1);
      assert.equal(r.body.attendance[0].volunteerName, "Amber Wang");
    });
  });

  // ---------------- Submission validation + upsert ----------------

  // ---------------- Hours derived from check-in / check-out ----------------

  test(name("setting check-in + check-out times creates a countable submission with computed hours"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      // Give Aaron a grade so we can assert the derived submission picks it up.
      const aaron = (await api.get("/api/volunteers", auth)).body.find((v) => v.name === "Aaron Tse");
      await api.send("PATCH", `/api/volunteers/${aaron.id}`, { grade: "11th" }, auth);
      // 16:00Z–19:00Z = 3.0 hours; local (America/Los_Angeles, PDT) = 09:00–12:00.
      await logHours(
        api, auth, event.id, "Aaron Tse",
        "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z"
      );
      const subs = (await api.get("/api/submissions")).body.filter(
        (s) => s.volunteerName === "Aaron Tse"
      );
      assert.equal(subs.length, 1, "one derived submission");
      assert.equal(subs[0].hours, 3, "hours = checkout − checkin");
      assert.equal(subs[0].eventId, event.id);
      assert.equal(subs[0].grade, "11th", "derived submission carries the volunteer's grade");
      assert.equal(subs[0].arrivalTime, "09:00", "sign-in HH:MM in chapter tz");
      assert.equal(subs[0].endTime, "12:00", "sign-out HH:MM in chapter tz");
    });
  });

  test(name("clearing the check-out time removes the derived hours"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await logHours(
        api, auth, event.id, "Aaron Tse",
        "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z"
      );
      assert.equal((await api.get("/api/submissions")).body.length, 1);
      // Clear checkout — no longer complete, so the derived submission goes away.
      await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: "Aaron Tse", checkoutAt: null,
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
        api, auth, event.id, "Aaron Tse",
        "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z"
      );
      assert.equal((await api.get("/api/submissions")).body.length, 1);
      await api.send("DELETE", `/api/events/${event.id}/attendance`, { volunteerName: "Aaron Tse" }, auth);
      assert.equal(
        (await api.get("/api/submissions")).body.length,
        0,
        "removing the attendee removed their hours — no orphaned pending row"
      );
    });
  });

  // ---------------- Admin reset / export / import ----------------

  test(name("admin reset clears events + submissions but keeps the volunteer roster"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      await makeEvent(api, auth);
      const rosterBefore = (await api.get("/api/volunteers", auth)).body.length;
      const r = await api.send("POST", "/api/admin/reset", undefined, auth);
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

  test(name("export then import round-trips events/submissions and dedupes legacy duplicates"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await logHours(
        api, auth, event.id, "Aaron Tse",
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
        (s) => s.eventId === event.id && s.volunteerName === "Aaron Tse"
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
      assert.equal(after.find((v) => v.name === "Aaron Tse").code, "TCYA-0001");
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
      const dup = await api.send("POST", "/api/volunteers", { name: "Aaron Tse" }, auth);
      assert.equal(dup.status, 409);
      assert.equal(dup.body.code, "duplicate_name");
      const forced = await api.send(
        "POST",
        "/api/volunteers",
        { name: "Aaron Tse", force: true },
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
        { volunteerNames: ["Aaron Tse", "Amber Wang"] },
        auth
      );
      const aaron = (await api.get("/api/volunteers", auth)).body.find(
        (v) => v.name === "Aaron Tse"
      );
      const r = await api.send(
        "PATCH",
        `/api/volunteers/${aaron.id}`,
        { name: "Amber Wang" },
        auth
      );
      assert.equal(r.status, 409);
      const ev = (await api.get("/api/events")).body[0];
      assert.ok(ev.attendance.some((a) => a.volunteerName === "Aaron Tse"));
      assert.ok(ev.attendance.some((a) => a.volunteerName === "Amber Wang"));
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
      await api.send("POST", `/api/events/${event.id}/attendance`, { volunteerNames: ["Aaron Tse"] }, auth);
      const r = await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: "Aaron Tse", checkoutAt: "2026-03-15T20:00:00.000Z",
      }, auth);
      const row = r.body.attendance.find((a) => a.volunteerName === "Aaron Tse");
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
      const code = await codeFor(api, auth, "Aaron Tse");
      await api.send("POST", `/api/events/${event.id}/checkin`, { code }, auth); // real check-in
      const iso = "2026-03-15T20:00:00.000Z";
      const r = await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: "Aaron Tse", checkoutAt: iso,
      }, auth);
      const row = r.body.attendance.find((a) => a.volunteerName === "Aaron Tse");
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
        api, auth, event.id, "Aaron Tse",
        "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z"
      );
      assert.equal((await api.get("/api/submissions")).body.length, 1);
      // Clear the check-in time.
      const r = await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: "Aaron Tse", checkinAt: null,
      }, auth);
      const row = r.body.attendance.find((a) => a.volunteerName === "Aaron Tse");
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
        api, auth, event.id, "Aaron Tse",
        "2026-03-15T16:00:00.000Z", "2026-03-15T19:00:00.000Z"
      );
      const r = await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: "Aaron Tse", staffCheckin: false,
      }, auth);
      const row = r.body.attendance.find((a) => a.volunteerName === "Aaron Tse");
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
        { volunteerNames: ["Aaron Tse", "Aaron Tse"] },
        auth
      );
      assert.equal(r.status, 200);
      assert.equal(
        r.body.attendance.filter((a) => a.volunteerName === "Aaron Tse").length,
        1
      );
    });
  });

  // ---------------- Malformed ids degrade gracefully ----------------

  test(name("malformed eventId on check-in returns 404, not 500"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const code = await codeFor(api, auth, "Aaron Tse");
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
      const code = await codeFor(api, auth, "Aaron Tse");
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
      const code = await codeFor(api, auth, "Aaron Tse");
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
      const code = await codeFor(api, auth, "Aaron Tse");
      await api.send("POST", `/api/events/${event.id}/checkin`, { code }, auth);

      const pub = (await api.get("/api/events")).body[0].attendance[0];
      assert.equal(pub.volunteerName, "Aaron Tse");
      assert.equal(typeof pub.staffCheckin, "boolean");
      assert.equal(pub.code, undefined, "public must not leak the QR code");
      assert.equal(pub.volunteerId, undefined, "public must not leak internal id");
      assert.equal(pub.checkinAt, undefined, "public must not leak the check-in time");
      assert.equal(JSON.stringify(pub).includes("TCYA-0001"), false);

      const adm = (await api.get("/api/events", auth)).body[0].attendance.find(
        (a) => a.volunteerName === "Aaron Tse"
      );
      assert.equal(adm.code, "TCYA-0001", "admin sees the code");
      assert.ok(adm.checkinAt, "admin sees the check-in time");
    });
  });
}
