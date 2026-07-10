// Unit tests for the storage-backend selector. The critical guarantee: a
// production/serverless runtime NEVER silently falls back to the ephemeral
// in-memory store (which loses data on every cold start). These tests pass an
// explicit `env` object so they don't depend on the real process environment.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createStore,
  resolveDatabaseUrl,
  isProdLikeEnv,
  DB_URL_ENV_VARS,
} from "../src/db/create-store.js";

const NEON_URL =
  "postgresql://user:pass@ep-example-123.us-east-1.aws.neon.tech/neondb?sslmode=require";

// ---------------- resolveDatabaseUrl ----------------

test("resolveDatabaseUrl: returns null when no DB var is set", () => {
  assert.equal(resolveDatabaseUrl({}), null);
});

test("resolveDatabaseUrl: treats blank/whitespace as unset", () => {
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: "" }), null);
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: "   " }), null);
});

test("resolveDatabaseUrl: trims and returns a set URL", () => {
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: "  " + NEON_URL + " " }), NEON_URL);
});

test("resolveDatabaseUrl: accepts Netlify's NETLIFY_DATABASE_URL", () => {
  assert.equal(resolveDatabaseUrl({ NETLIFY_DATABASE_URL: NEON_URL }), NEON_URL);
});

test("resolveDatabaseUrl: DATABASE_URL wins over the Netlify variants", () => {
  const primary = NEON_URL;
  const secondary = "postgresql://other@host/db";
  assert.equal(
    resolveDatabaseUrl({ DATABASE_URL: primary, NETLIFY_DATABASE_URL: secondary }),
    primary
  );
});

test("resolveDatabaseUrl: the accepted var list is the documented set", () => {
  assert.deepEqual(DB_URL_ENV_VARS, [
    "DATABASE_URL",
    "NETLIFY_DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "NETLIFY_DATABASE_URL_UNPOOLED",
  ]);
});

// ---------------- isProdLikeEnv ----------------

test("isProdLikeEnv: true for Netlify / Lambda / NODE_ENV=production", () => {
  assert.equal(isProdLikeEnv({ NETLIFY: "true" }), true);
  assert.equal(isProdLikeEnv({ AWS_LAMBDA_FUNCTION_NAME: "api" }), true);
  assert.equal(isProdLikeEnv({ NODE_ENV: "production" }), true);
});

test("isProdLikeEnv: false for a bare local env", () => {
  assert.equal(isProdLikeEnv({}), false);
  assert.equal(isProdLikeEnv({ NODE_ENV: "development" }), false);
});

test("isProdLikeEnv: does NOT depend on DATABASE_URL (must detect a prod deploy that is missing the DB)", () => {
  assert.equal(isProdLikeEnv({ DATABASE_URL: NEON_URL }), false);
});

// ---------------- createStore ----------------

test("createStore: selects Postgres when a DB URL is present", () => {
  const { backend } = createStore({ DATABASE_URL: NEON_URL });
  assert.equal(backend, "postgres");
});

test("createStore: selects Postgres via the Netlify variable too", () => {
  const { backend } = createStore({ NETLIFY_DATABASE_URL: NEON_URL });
  assert.equal(backend, "postgres");
});

test("createStore: uses in-memory only for a bare local env (no prod signal, no DB)", () => {
  const { backend } = createStore({});
  assert.equal(backend, "memory");
});

test("createStore: FAILS CLOSED — throws in a prod-like env with no database", () => {
  assert.throws(() => createStore({ NETLIFY: "true" }), /No database URL configured/);
  assert.throws(() => createStore({ AWS_LAMBDA_FUNCTION_NAME: "api" }), /Refusing to start/);
  assert.throws(() => createStore({ NODE_ENV: "production" }), /would NOT persist/);
});

test("createStore: FAILS CLOSED — a blank DATABASE_URL in prod is fatal, not a memory fallback", () => {
  assert.throws(
    () => createStore({ NETLIFY: "true", DATABASE_URL: "   " }),
    /No database URL configured/
  );
});
