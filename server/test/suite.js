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

      await api.send(
        "POST",
        `/api/events/${event.id}/attendance`,
        { volunteerNames: ["Aaron Tse"] },
        auth
      );
      await api.send("POST", "/api/submissions", {
        eventId: event.id,
        volunteerName: "Aaron Tse",
        grade: "10th",
        arrivalTime: "08:00",
        endTime: "10:00",
      });

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
      assert.equal(added.body.attendance[0].staffCheckin, true);
      assert.equal(added.body.attendance[0].volunteerCheckout, false);
      assert.equal(added.body.attendance[0].checkinAt, null, "pre-register sets no check-in time");
    });
  });

  test(name("deleting an event orphans its submissions (they stop counting) but keeps the rows"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await api.send("POST", "/api/submissions", {
        eventId: event.id,
        volunteerName: "Aaron Tse",
        grade: "10th",
        arrivalTime: "08:00",
        endTime: "10:00",
      });
      await api.send("DELETE", `/api/events/${event.id}`, undefined, auth);
      const subs = (await api.get("/api/submissions")).body;
      const s = subs.find((x) => x.volunteerName === "Aaron Tse");
      assert.ok(s, "submission row remains");
      assert.equal(s.eventId, event.id, "eventId kept (now orphaned), so it won't count");
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

  test(name("submission rejects out-of-range and off-boundary times"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      const sub = (arrivalTime, endTime) =>
        api.send("POST", "/api/submissions", {
          eventId: event.id,
          volunteerName: "Aaron Tse",
          grade: "10th",
          arrivalTime,
          endTime,
        });
      assert.equal((await sub("00:00", "99:45")).status, 400, "hour 99");
      assert.equal((await sub("09:00", "25:15")).status, 400, "hour 25");
      assert.equal((await sub("09:00", "09:59")).status, 400, "off 15-min boundary");
      assert.equal((await sub("12:00", "12:00")).status, 400, "zero-length");
      assert.equal((await sub("12:00", "09:00")).status, 400, "end before start");
      const ok = await sub("09:00", "12:15");
      assert.equal(ok.status, 201);
      assert.equal(ok.body.submission.hours, 3.25);
    });
  });

  test(name("re-submitting the same event upserts instead of duplicating (stable id)"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      const sub = (endTime, comments) =>
        api.send("POST", "/api/submissions", {
          eventId: event.id,
          volunteerName: "Aaron Tse",
          grade: "10th",
          arrivalTime: "08:00",
          endTime,
          comments,
        });
      const first = await sub("11:30", "first");
      const second = await sub("12:00", "corrected");
      assert.equal(first.status, 201);
      assert.equal(second.status, 201);

      const beach = (await api.get("/api/submissions")).body.filter(
        (s) => s.eventId === event.id && s.volunteerName === "Aaron Tse"
      );
      assert.equal(beach.length, 1, "single row, not a duplicate");
      assert.equal(beach[0].hours, 4, "keeps the corrected value");
      assert.equal(beach[0].comments, "corrected");
      assert.equal(beach[0].id, first.body.submission.id, "id stays stable");
    });
  });

  test(name("volunteer submission flips checkout; unknown walk-in becomes self-added"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await api.send(
        "POST",
        `/api/events/${event.id}/attendance`,
        { volunteerNames: ["Aaron Tse"] },
        auth
      );
      await api.send("POST", "/api/submissions", {
        eventId: event.id,
        volunteerName: "Aaron Tse",
        grade: "10th",
        arrivalTime: "08:00",
        endTime: "11:30",
      });
      let ev = (await api.get("/api/events", auth)).body[0]; // admin view keeps timestamps
      const row = ev.attendance.find((a) => a.volunteerName === "Aaron Tse");
      assert.equal(row.staffCheckin, true);
      assert.equal(row.volunteerCheckout, true);
      assert.ok(row.checkoutAt, "form submit stamps a checkout time");

      await api.send("POST", "/api/submissions", {
        eventId: event.id,
        volunteerName: "Walk In Stranger",
        grade: "9th",
        arrivalTime: "09:00",
        endTime: "10:00",
      });
      ev = (await api.get("/api/events")).body[0];
      const walk = ev.attendance.find((a) => a.volunteerName === "Walk In Stranger");
      assert.equal(walk.selfAdded, true);
      assert.equal(walk.staffCheckin, false);
      assert.equal(walk.volunteerCheckout, true);
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
      await api.send(
        "POST",
        `/api/events/${event.id}/attendance`,
        { volunteerNames: ["Aaron Tse"] },
        auth
      );
      await api.send("POST", "/api/submissions", {
        eventId: event.id, volunteerName: "Aaron Tse", grade: "10th",
        arrivalTime: "08:00", endTime: "11:00",
      });

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

  test(name("rename that collides only on submissions returns 409 (parity)"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      // Walk-in "Zzz Walkin" submits, then admin removes their attendance row,
      // leaving an orphan submission keyed (event, "Zzz Walkin").
      await api.send("POST", "/api/submissions", {
        eventId: event.id, volunteerName: "Zzz Walkin", grade: "9th",
        arrivalTime: "09:00", endTime: "10:00",
      });
      await api.send("DELETE", `/api/events/${event.id}/attendance`, { volunteerName: "Zzz Walkin" }, auth);
      // Aaron submits for the same event.
      await api.send("POST", "/api/submissions", {
        eventId: event.id, volunteerName: "Aaron Tse", grade: "10th",
        arrivalTime: "09:00", endTime: "11:00",
      });
      const aaron = (await api.get("/api/volunteers", auth)).body.find(
        (v) => v.name === "Aaron Tse"
      );
      // Renaming Aaron -> "Zzz Walkin" would create two submissions keyed the same.
      const r = await api.send(
        "PATCH",
        `/api/volunteers/${aaron.id}`,
        { name: "Zzz Walkin" },
        auth
      );
      assert.equal(r.status, 409);
      const subs = (await api.get("/api/submissions")).body.filter(
        (s) => s.eventId === event.id && s.volunteerName === "Zzz Walkin"
      );
      assert.equal(subs.length, 1, "no duplicate (event, name) submission created");
    });
  });

  // ---------------- Manual time editor marks the side checked ----------------

  test(name("PATCH checkoutAt only (no boolean) marks volunteerCheckout true"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      await api.send(
        "POST",
        `/api/events/${event.id}/attendance`,
        { volunteerNames: ["Aaron Tse"] },
        auth
      );
      const iso = "2026-03-15T20:00:00.000Z";
      const r = await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: "Aaron Tse", checkoutAt: iso,
      }, auth);
      const row = r.body.attendance.find((a) => a.volunteerName === "Aaron Tse");
      assert.equal(row.volunteerCheckout, true, "setting a checkout time marks it checked");
      assert.equal(row.checkoutAt, iso);
      assert.equal(row.staffCheckin, true, "the pre-registered check-in is not clobbered");
    });
  });

  test(name("PATCH checkinAt:null clears the time without unchecking"), async () => {
    await withServer(async (api) => {
      const auth = await adminToken(api);
      const event = await makeEvent(api, auth);
      const code = await codeFor(api, auth, "Aaron Tse");
      await api.send("POST", `/api/events/${event.id}/checkin`, { code }, auth);
      const r = await api.send("PATCH", `/api/events/${event.id}/attendance`, {
        volunteerName: "Aaron Tse", checkinAt: null,
      }, auth);
      const row = r.body.attendance.find((a) => a.volunteerName === "Aaron Tse");
      assert.equal(row.checkinAt, null, "time cleared");
      assert.equal(row.staffCheckin, true, "flag left intact");
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

  test(name("malformed eventId on public /submissions returns 400, not 500"), async () => {
    await withServer(async (api) => {
      const r = await api.send("POST", "/api/submissions", {
        eventId: "not-a-uuid", volunteerName: "Aaron Tse", grade: "10th",
        arrivalTime: "09:00", endTime: "10:00",
      });
      assert.equal(r.status, 400);
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
