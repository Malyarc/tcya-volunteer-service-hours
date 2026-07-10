// Chooses the storage backend at runtime. In production the app MUST use a
// durable Postgres (Neon) database — the in-memory store is ONLY for local dev
// and tests and loses everything on restart / on every serverless cold start.
//
// We therefore FAIL CLOSED: if the process looks like a real deployment but no
// database URL is configured, `createStore` throws instead of silently handing
// back an ephemeral in-memory store (which would accept writes and lose them on
// the next cold start — the classic "my data keeps disappearing" bug). The
// entry points surface that as a loud 5xx/exit rather than quietly running on
// RAM.

import { createPostgresStore } from "./store-postgres.js";
import { createMemoryStore } from "./store-memory.js";

// Accept every connection-string variable a Postgres host might inject. Netlify's
// Neon / Netlify-DB integration sets NETLIFY_DATABASE_URL (pooled) and
// NETLIFY_DATABASE_URL_UNPOOLED rather than DATABASE_URL — reading only
// DATABASE_URL would miss a DB provisioned through the integration and silently
// fall back to memory. Order = preference (pooled first).
export const DB_URL_ENV_VARS = [
  "DATABASE_URL",
  "NETLIFY_DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "NETLIFY_DATABASE_URL_UNPOOLED",
];

// The first non-blank connection string, trimmed. A blank/whitespace value is
// treated as "not set" (it can't select a real database) rather than passed to
// the driver.
export function resolveDatabaseUrl(env = process.env) {
  for (const key of DB_URL_ENV_VARS) {
    const v = env[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// Any signal that we're on a real deployment. Deliberately does NOT depend on
// DATABASE_URL (an earlier version keyed the prod check off DATABASE_URL itself,
// which is circular — it can't detect a prod deploy that is MISSING the DB).
// Netlify Functions run on AWS Lambda, so AWS_LAMBDA_FUNCTION_NAME is present in
// that runtime even when the NETLIFY build var isn't.
export function isProdLikeEnv(env = process.env) {
  return !!(
    env.NETLIFY ||
    env.AWS_LAMBDA_FUNCTION_NAME ||
    env.NODE_ENV === "production"
  );
}

export function createStore(env = process.env) {
  const url = resolveDatabaseUrl(env);
  if (url) {
    return { store: createPostgresStore(url), backend: "postgres" };
  }
  if (isProdLikeEnv(env)) {
    throw new Error(
      "No database URL configured (checked " +
        DB_URL_ENV_VARS.join(", ") +
        "). Refusing to start on the ephemeral in-memory store in a production " +
        "environment — data would NOT persist across serverless cold starts. " +
        "Set DATABASE_URL to your Neon connection string."
    );
  }
  return { store: createMemoryStore(), backend: "memory" };
}
