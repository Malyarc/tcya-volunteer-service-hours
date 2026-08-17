// Runs the EXACT SAME router suite against a live Postgres database, proving
// the Postgres store is behaviorally identical to the in-memory reference.
//
// Gated on TEST_DATABASE_URL (deliberately NOT the app's DATABASE_URL) so a
// normal `npm test` — or a pre-commit hook that happens to have DATABASE_URL
// pointed at production — never touches a real database. Each test starts from
// a truncated + freshly-seeded schema, so point TEST_DATABASE_URL only at a
// THROWAWAY database.
//
//   TEST_DATABASE_URL='postgres://…' node --test   (from the server/ directory)

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { neon, neonConfig } from "@neondatabase/serverless";
import { createRouter, deriveSessionSecret } from "../src/routes.js";
import { createPostgresStore } from "../src/db/store-postgres.js";
import { SCHEMA_STATEMENTS } from "../src/db/schema.js";
import { SEED_VOLUNTEERS } from "../src/data/seed-volunteers.js";
import { OFFICER_NAMES, RETIRED_MEMBER_NAMES } from "../src/db/data-migrations.js";
import { runSuite } from "./suite.js";

const URL = process.env.TEST_DATABASE_URL;

// Run against a LOCAL Postgres instead of a Neon cloud branch. The driver talks
// Neon's SQL-over-HTTP protocol, so `test/docker-compose.parity.yml` puts an
// HTTP proxy in front of a throwaway `postgres:17` container and this points the
// driver at it. Makes the mandatory parity gate runnable with no cloud database
// — and therefore with zero chance of aiming it at production.
if (process.env.TEST_NEON_HTTP_PROXY) {
  const proxyPort = process.env.TEST_NEON_HTTP_PROXY_PORT || 4444;
  neonConfig.fetchEndpoint = (host) =>
    host === "db.localtest.me" || host === "localhost" || host === "127.0.0.1"
      ? `http://${host}:${proxyPort}/sql`
      : `https://${host}/sql`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.poolQueryViaFetch = true;
}

// HARD GUARD: this suite TRUNCATEs all four tables before EVERY test. It must
// NEVER run against the production database. Refuse unless the target is
// unmistakably a throwaway: it must differ from DATABASE_URL, and either its
// connection string carries a throwaway marker (test/throwaway/scratch/…) or the
// operator explicitly sets CONFIRM_TRUNCATE=1. This throws at module load,
// before resetDb() can fire.
if (URL) {
  const prod = (process.env.DATABASE_URL || "").trim();
  if (prod && URL.trim() === prod) {
    throw new Error(
      "REFUSING to run the destructive parity suite: TEST_DATABASE_URL === DATABASE_URL — that is the PRODUCTION database. This suite TRUNCATEs every table. Point TEST_DATABASE_URL at a dedicated throwaway database."
    );
  }
  const looksThrowaway = /test|throwaway|scratch|ephemeral|staging|local|dev/i.test(URL);
  if (!looksThrowaway && process.env.CONFIRM_TRUNCATE !== "1") {
    let host = "(unparseable)";
    try {
      host = new globalThis.URL(URL).host;
    } catch {
      /* ignore */
    }
    throw new Error(
      `REFUSING to run the destructive parity suite against ${host}: its connection string has no throwaway marker (expected /test|throwaway|scratch|ephemeral|staging|local|dev/). This suite TRUNCATEs ALL tables. Use a disposable database, or set CONFIRM_TRUNCATE=1 if you are certain this is not production.`
    );
  }
}

if (!URL) {
  test("Postgres store parity (skipped — set TEST_DATABASE_URL to run)", { skip: true }, () => {});
} else {
  const sql = neon(URL);

  // Ensure the schema exists once up front (so TRUNCATE has tables to hit).
  for (const stmt of SCHEMA_STATEMENTS) await sql([stmt]);

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

  // Reset to a pristine, EMPTY database before each test — including the
  // migration markers. The seeding and the one-time data migrations are then
  // done by the store's own ensureReady() below, so every single test exercises
  // the real cold-boot path (DDL + seed + migrations) rather than a hand-rolled
  // approximation of it. This is what makes the parity run able to catch a SQL
  // typo in the migration statements.
  async function resetDb() {
    await sql.transaction([
      sql`TRUNCATE attendance, submissions, events, volunteers, app_migrations, archived_records RESTART IDENTITY CASCADE`,
      sql`ALTER SEQUENCE volunteer_code_seq RESTART`,
    ]);
  }

  async function withServer(run) {
    await resetDb();
    // A FRESH store per test: its memoized ensureReady() has not run yet, so it
    // re-creates the schema, re-seeds the roster and re-applies the data
    // migrations against the empty database — mirroring how the memory store is
    // constructed for its own runs.
    const store = createPostgresStore(URL);
    await store.ensureReady();
    const app = express();
    app.use(express.json({ limit: "5mb" }));
    app.use(
      "/api",
      createRouter({
        store,
        backend: "postgres",
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

  runSuite(withServer, "postgres");

  // ---- Postgres-only: the one-time data migrations ----
  //
  // These need two independent boots against the SAME database, which only the
  // real store can express (the memory store is re-created from scratch every
  // time), so they live here rather than in the shared suite.

  test("[postgres] cold boot seeds the roster and promotes the officers", async () => {
    await resetDb();
    await createPostgresStore(URL).ensureReady();
    const rows = await sql`SELECT name, role FROM volunteers ORDER BY code`;
    assert.equal(rows.length, SEED_VOLUNTEERS.length);
    const officers = rows.filter((r) => r.role === "officer").map((r) => r.name);
    const expected = OFFICER_NAMES.filter((n) => SEED_VOLUNTEERS.includes(n));
    assert.deepEqual(officers.sort(), expected.sort());
  });

  test("[postgres] the migration marker stops a promotion from being re-applied", async () => {
    await resetDb();
    await createPostgresStore(URL).ensureReady();
    const target = OFFICER_NAMES.find((n) => SEED_VOLUNTEERS.includes(n));

    // The admin later decides this person is no longer an officer.
    await sql`UPDATE volunteers SET role = 'volunteer' WHERE name = ${target}`;

    // A new serverless instance cold-starts and runs ensureReady again.
    await createPostgresStore(URL).ensureReady();

    const after = await sql`SELECT role FROM volunteers WHERE name = ${target}`;
    assert.equal(
      after[0].role,
      "volunteer",
      "a re-run must NOT undo the admin's demotion"
    );
  });

  test("[postgres] the purge migration archives before deleting, and only orphans", async () => {
    await resetDb();
    await createPostgresStore(URL).ensureReady(); // seed + mark migrations applied
    // Simulate the production state this migration was written for: leftover
    // rows for a former member with no volunteer record. Clear the marker so the
    // migration is eligible to run on the next boot.
    await sql`DELETE FROM app_migrations WHERE name LIKE '%purge-retired%'`;
    const orphan = RETIRED_MEMBER_NAMES[0];
    const keeper = RETIRED_MEMBER_NAMES[1];
    // `keeper` IS on the roster, so their rows must survive untouched.
    await sql`INSERT INTO volunteers (code, name) VALUES ('TCYA-9001', ${keeper})`;
    const ev = await sql`
      INSERT INTO events (name, date) VALUES ('Culture - Beach Cleanup', '2026-03-15') RETURNING id`;
    const eid = ev[0].id;
    for (const n of [orphan, keeper]) {
      await sql`
        INSERT INTO attendance (event_id, volunteer_name, staff_checkin, checkin_at, volunteer_checkout, checkout_at)
        VALUES (${eid}, ${n}, true, '2026-03-15T16:00:00Z', true, '2026-03-15T19:00:00Z')`;
      await sql`
        INSERT INTO submissions (event_id, volunteer_name, event_name, event_date, hours)
        VALUES (${eid}, ${n}, 'Culture - Beach Cleanup', '2026-03-15', 3)`;
    }

    await createPostgresStore(URL).ensureReady();

    const names = (await sql`SELECT volunteer_name FROM attendance ORDER BY volunteer_name`).map(
      (r) => r.volunteer_name
    );
    assert.deepEqual(names, [keeper], "only the orphaned former member was purged");
    const subs = (await sql`SELECT volunteer_name FROM submissions`).map((r) => r.volunteer_name);
    assert.deepEqual(subs, [keeper], "their derived hours went with them");

    const archived = await sql`SELECT payload FROM archived_records`;
    assert.equal(archived.length, 1, "exactly one archive row was written");
    const payload = archived[0].payload;
    assert.equal(payload.attendance.length, 1, "the deleted attendance row is recoverable");
    assert.equal(payload.attendance[0].volunteer_name, orphan);
    assert.equal(payload.submissions.length, 1, "the deleted submission is recoverable");
    assert.equal(Number(payload.submissions[0].hours), 3);
  });

  test("[postgres] the purge migration writes no archive row when there is nothing to purge", async () => {
    await resetDb();
    await createPostgresStore(URL).ensureReady();
    assert.equal((await sql`SELECT 1 FROM archived_records`).length, 0);
  });
}
