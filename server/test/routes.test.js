// Runs the shared router suite against the in-memory store — fast, hermetic,
// and the default green bar (no network, no secrets). See suite.js for the
// assertions and store-parity.test.js for the live-Postgres run.
//
//   node --test        (from the server/ directory)

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createRouter, deriveSessionSecret } from "../src/routes.js";
import { createMemoryStore } from "../src/db/store-memory.js";
import { runSuite } from "./suite.js";

function makeApi(base) {
  return {
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
  };
}

// Fresh in-memory store (freshly seeded roster) per test.
async function withServer(run) {
  const store = createMemoryStore();
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(
    "/api",
    createRouter({
      store,
      adminUsername: "admin",
      adminPassword: "1013",
      sessionSecret: deriveSessionSecret("admin", "1013"),
    })
  );
  const server = app.listen(0);
  await new Promise((res) => server.once("listening", res));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(makeApi(base));
  } finally {
    await new Promise((res) => server.close(res));
  }
}

runSuite(withServer, "memory");

// Fail-closed admin: when adminEnabled=false (production with no explicit
// ADMIN_PASSWORD), /login and admin routes return 503, but public endpoints
// keep working.
test("adminEnabled=false disables login + admin routes but not public reads", async () => {
  const store = createMemoryStore();
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(
    "/api",
    createRouter({
      store,
      adminUsername: "admin",
      adminPassword: "1013",
      sessionSecret: deriveSessionSecret("admin", "1013"),
      adminEnabled: false,
    })
  );
  const server = app.listen(0);
  await new Promise((res) => server.once("listening", res));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = makeApi(base);
  try {
    assert.equal(
      (await api.send("POST", "/api/login", { username: "admin", password: "1013" })).status,
      503
    );
    assert.equal((await api.get("/api/volunteers")).status, 503);
    assert.equal((await api.send("POST", "/api/admin/reset", undefined)).status, 503);
    // Public endpoints still serve.
    assert.equal((await api.get("/api/roster")).status, 200);
    assert.equal((await api.get("/api/events")).status, 200);
    assert.equal((await api.get("/api/session")).body.admin, false);
  } finally {
    await new Promise((res) => server.close(res));
  }
});
