// Runs the shared router suite against the in-memory store — fast, hermetic,
// and the default green bar (no network, no secrets). See suite.js for the
// assertions and store-parity.test.js for the live-Postgres run.
//
//   node --test        (from the server/ directory)

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createRouter, deriveSessionSecret } from "../src/routes.js";
import { ADMIN_PASSWORD, ADMIN_USERNAME, OFFICER_PASSWORD, OFFICER_USERNAME } from "../src/accounts.js";
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
      backend: "memory",
      sessionSecret: deriveSessionSecret(ADMIN_USERNAME, ADMIN_PASSWORD),
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

// The kill switch: with adminEnabled=false NOBODY can sign in — neither
// account — and every privileged route answers 503, while the public endpoints
// keep serving.
test("adminEnabled=false disables login + privileged routes but not public reads", async () => {
  const store = createMemoryStore();
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(
    "/api",
    createRouter({
      store,
      sessionSecret: deriveSessionSecret(ADMIN_USERNAME, ADMIN_PASSWORD),
      adminEnabled: false,
    })
  );
  const server = app.listen(0);
  await new Promise((res) => server.once("listening", res));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = makeApi(base);
  try {
    assert.equal(
      (await api.send("POST", "/api/login", { username: ADMIN_USERNAME, password: ADMIN_PASSWORD })).status,
      503
    );
    assert.equal(
      (await api.send("POST", "/api/login", { username: OFFICER_USERNAME, password: OFFICER_PASSWORD })).status,
      503
    );
    assert.equal((await api.get("/api/volunteers")).status, 503);
    assert.equal((await api.send("POST", "/api/admin/reset", undefined)).status, 503);
    assert.equal(
      (await api.send("POST", "/api/events/00000000-0000-4000-8000-000000000000/checkin", { code: "TCYA-0001" })).status,
      503
    );
    assert.equal((await api.send("PUT", "/api/event-order", { names: ["x"] })).status, 503);
    // Public endpoints still serve.
    assert.equal((await api.get("/api/roster")).status, 200);
    assert.equal((await api.get("/api/events")).status, 200);
    assert.equal((await api.get("/api/event-order")).status, 200);
    assert.equal((await api.get("/api/session")).body.admin, false);
    assert.equal((await api.get("/api/session")).body.role, null);
  } finally {
    await new Promise((res) => server.close(res));
  }
});
