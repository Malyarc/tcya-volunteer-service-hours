// Regression tests for the shared Express router. Runs the real router over
// HTTP against an in-memory storage that honours the same
// { readData, writeData(updater) } contract as the file / blobs backends.
//
//   node --test        (from the server/ directory)

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createRouter, deriveSessionSecret } from "../src/routes.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "1013";

// Minimal in-memory storage mirroring the production backends' contract:
// serialized read-modify-write over a single { submissions, events } document.
function createMemoryStorage(seed) {
  let data = seed || { submissions: [], events: [] };
  let queue = Promise.resolve();
  return {
    async readData() {
      return data;
    },
    writeData(updater) {
      queue = queue.then(async () => {
        data = await updater(data);
        return data;
      });
      return queue;
    },
    _dump: () => data,
  };
}

// Boot the router on an ephemeral port and hand the test a small client.
async function withServer(seed, run) {
  const storage = createMemoryStorage(seed);
  const app = express();
  app.use(express.json({ limit: "200kb" }));
  app.use(
    "/api",
    createRouter({
      readData: storage.readData,
      writeData: storage.writeData,
      adminUsername: ADMIN_USERNAME,
      adminPassword: ADMIN_PASSWORD,
      sessionSecret: deriveSessionSecret(ADMIN_USERNAME, ADMIN_PASSWORD),
    })
  );
  const server = app.listen(0);
  await new Promise((res) => server.once("listening", res));
  const base = `http://127.0.0.1:${server.address().port}`;

  const api = {
    async get(path, headers) {
      const r = await fetch(base + path, { headers });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    async send(method, path, body, headers = {}) {
      const r = await fetch(base + path, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    dump: storage._dump,
  };

  try {
    await run(api);
  } finally {
    await new Promise((res) => server.close(res));
  }
}

async function adminToken(api) {
  const r = await api.send("POST", "/api/login", {
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
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

// ---------------- Auth ----------------

test("login rejects wrong credentials, accepts correct", async () => {
  await withServer(null, async (api) => {
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

test("event write endpoints require admin auth", async () => {
  await withServer(null, async (api) => {
    assert.equal(
      (await api.send("POST", "/api/events", { name: "x", date: "2026-01-01" }))
        .status,
      401
    );
    const auth = await adminToken(api);
    assert.equal((await makeEvent(api, auth)).name, "Culture - Beach Cleanup");
  });
});

// ---------------- The reported Netlify flow ----------------

test("create event then add a volunteer to it works", async () => {
  await withServer(null, async (api) => {
    const auth = await adminToken(api);
    const event = await makeEvent(api, auth);
    // This is the exact flow that failed on Netlify ("event does not exist").
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
  });
});

// ---------------- Submission time validation ----------------

test("submission rejects out-of-range and off-boundary times", async () => {
  await withServer(null, async (api) => {
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

// ---------------- Upsert / dedupe ----------------

test("re-submitting the same event upserts instead of duplicating", async () => {
  await withServer(null, async (api) => {
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

    const all = (await api.get("/api/submissions")).body;
    const beach = all.filter(
      (s) => s.eventId === event.id && s.volunteerName === "Aaron Tse"
    );
    assert.equal(beach.length, 1, "should be a single row, not a duplicate");
    assert.equal(beach[0].hours, 4, "keeps the corrected value");
    assert.equal(beach[0].comments, "corrected");
    assert.equal(beach[0].id, first.body.submission.id, "id stays stable");
  });
});

test("submitting collapses pre-existing legacy duplicates to one row", async () => {
  const seed = {
    events: [
      {
        id: "evt-1",
        name: "Culture - Beach Cleanup",
        customName: null,
        date: "2026-03-15",
        createdAt: "2026-03-01T00:00:00.000Z",
        attendance: [
          {
            volunteerName: "Aaron Tse",
            staffCheckin: true,
            volunteerCheckout: true,
            selfAdded: false,
          },
        ],
      },
    ],
    submissions: [
      mkSub("dup-a", "evt-1", "Aaron Tse", "08:00", "11:30", 3.5),
      mkSub("dup-b", "evt-1", "Aaron Tse", "08:00", "11:30", 3.5),
    ],
  };
  await withServer(seed, async (api) => {
    const before = (await api.get("/api/submissions")).body.filter(
      (s) => s.volunteerName === "Aaron Tse"
    );
    assert.equal(before.length, 2, "legacy state has duplicates");

    await api.send("POST", "/api/submissions", {
      eventId: "evt-1",
      volunteerName: "Aaron Tse",
      grade: "10th",
      arrivalTime: "08:00",
      endTime: "12:00",
    });

    const after = (await api.get("/api/submissions")).body.filter(
      (s) => s.volunteerName === "Aaron Tse"
    );
    assert.equal(after.length, 1, "duplicates collapsed to one");
    assert.equal(after[0].hours, 4);
  });
});

// ---------------- Attendance toggles ----------------

test("volunteer submission flips checkout; staff toggle confirms", async () => {
  await withServer(null, async (api) => {
    const auth = await adminToken(api);
    const event = await makeEvent(api, auth);
    await api.send(
      "POST",
      `/api/events/${event.id}/attendance`,
      { volunteerNames: ["Aaron Tse"] },
      auth
    );
    // Volunteer submits (public, no auth) → checkout flips to true.
    await api.send("POST", "/api/submissions", {
      eventId: event.id,
      volunteerName: "Aaron Tse",
      grade: "10th",
      arrivalTime: "08:00",
      endTime: "11:30",
    });
    let ev = (await api.get("/api/events")).body[0];
    const row = ev.attendance.find((a) => a.volunteerName === "Aaron Tse");
    assert.equal(row.staffCheckin, true);
    assert.equal(row.volunteerCheckout, true);

    // A brand-new volunteer submitting without being pre-added is self-added.
    await api.send("POST", "/api/submissions", {
      eventId: event.id,
      volunteerName: "Walk In",
      grade: "9th",
      arrivalTime: "09:00",
      endTime: "10:00",
    });
    ev = (await api.get("/api/events")).body[0];
    const walk = ev.attendance.find((a) => a.volunteerName === "Walk In");
    assert.equal(walk.selfAdded, true);
    assert.equal(walk.staffCheckin, false);
    assert.equal(walk.volunteerCheckout, true);
  });
});

test("admin reset clears all data", async () => {
  await withServer(null, async (api) => {
    const auth = await adminToken(api);
    await makeEvent(api, auth);
    const r = await api.send("POST", "/api/admin/reset", undefined, auth);
    assert.equal(r.status, 200);
    assert.equal((await api.get("/api/events")).body.length, 0);
    assert.equal((await api.get("/api/submissions")).body.length, 0);
  });
});

function mkSub(id, eventId, volunteerName, arrivalTime, endTime, hours) {
  return {
    id,
    eventId,
    volunteerName,
    grade: "10th",
    eventName: "Culture - Beach Cleanup",
    customEventName: null,
    eventDate: "2026-03-15",
    arrivalTime,
    endTime,
    hours,
    comments: "",
    submittedAt: "2026-03-15T09:00:00.000Z",
  };
}
