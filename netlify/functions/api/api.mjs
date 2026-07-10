// Netlify Functions entry point. Wraps the same Express app the EC2 server
// uses, backed by Postgres (Neon) via the injected store. The @neondatabase
// driver speaks HTTP, so — unlike the old Netlify Blobs backend — there's no
// connectLambda / request-context dance: the store is constructed once at
// module scope and each query is a stateless request. Schema + seed are
// initialized lazily on the first store call (memoized per warm instance).
//
// The `/api/*` redirect in netlify.toml proxies the original URL into this
// function, so Express still sees `/api/...` paths and the routes match.

import express from "express";
import cors from "cors";
import serverless from "serverless-http";
import { createRouter, deriveSessionSecret } from "../../../server/src/routes.js";
import { createStore, isProdLikeEnv } from "../../../server/src/db/create-store.js";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1013";
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  deriveSessionSecret(ADMIN_USERNAME, ADMIN_PASSWORD);

// Fail closed on a production-like deploy that never set an explicit
// ADMIN_PASSWORD, so the built-in default can't grant admin / leak PII. Use the
// non-circular prod signal (Netlify/Lambda/NODE_ENV) rather than the presence of
// DATABASE_URL, so the guard still fires on a prod deploy that is missing the DB.
const ADMIN_ENABLED = !(!process.env.ADMIN_PASSWORD && isProdLikeEnv());

// Build the store. createStore() FAILS CLOSED — it throws if this is a
// production/serverless runtime with no database configured, rather than
// silently returning an ephemeral in-memory store that would lose every write
// on the next cold start. Catch that so the function returns a clear 503 on
// every route instead of an opaque crash.
let store;
let backend;
let storeError = null;
try {
  ({ store, backend } = createStore());
  if (backend === "memory") {
    // Reachable only in a non-prod-detected serverless context; still a
    // data-durability hazard, so make it loud in the function logs.
    console.error(
      "WARNING: storage backend is IN-MEMORY — data will NOT persist across cold starts. No DATABASE_URL / NETLIFY_DATABASE_URL is set."
    );
  }
} catch (err) {
  storeError = err;
  console.error("FATAL: durable storage is not configured —", err.message);
}

const app = express();
app.use(cors());

if (storeError) {
  // Fail closed: never serve requests against a non-durable/unconfigured store.
  app.use((_req, res) =>
    res.status(503).json({
      error:
        "Service unavailable: durable storage is not configured on the server. " +
        storeError.message,
    })
  );
} else {
  // Scope the large body limit to admin import; keep public endpoints tight.
  app.use("/api/admin/import", express.json({ limit: "5mb" }));
  app.use(express.json({ limit: "200kb" }));

  app.use(
    "/api",
    createRouter({
      store,
      backend,
      adminUsername: ADMIN_USERNAME,
      adminPassword: ADMIN_PASSWORD,
      sessionSecret: SESSION_SECRET,
      adminEnabled: ADMIN_ENABLED,
    })
  );
}

export const handler = serverless(app);
