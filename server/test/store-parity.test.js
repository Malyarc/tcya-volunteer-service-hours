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
import express from "express";
import { neon } from "@neondatabase/serverless";
import { createRouter, deriveSessionSecret } from "../src/routes.js";
import { createPostgresStore } from "../src/db/store-postgres.js";
import { SCHEMA_STATEMENTS } from "../src/db/schema.js";
import { SEED_VOLUNTEERS } from "../src/data/seed-volunteers.js";
import { runSuite } from "./suite.js";

const URL = process.env.TEST_DATABASE_URL;

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
  const store = createPostgresStore(URL);

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

  // Reset to a pristine, freshly-seeded DB before each test.
  async function resetDb() {
    await sql.transaction([
      sql`TRUNCATE attendance, submissions, events, volunteers RESTART IDENTITY CASCADE`,
      sql`ALTER SEQUENCE volunteer_code_seq RESTART`,
      sql`INSERT INTO volunteers (code, name)
          SELECT 'TCYA-' || lpad(nextval('volunteer_code_seq')::text, 4, '0'), t.name
          FROM unnest(${SEED_VOLUNTEERS}::text[]) WITH ORDINALITY AS t(name, ord)
          ORDER BY t.ord`,
    ]);
  }

  async function withServer(run) {
    await resetDb();
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
}
