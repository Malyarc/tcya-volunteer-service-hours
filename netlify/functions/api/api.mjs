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
import { createStore } from "../../../server/src/db/create-store.js";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1013";
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  deriveSessionSecret(ADMIN_USERNAME, ADMIN_PASSWORD);

// Fail closed on a production-like deploy that never set an explicit
// ADMIN_PASSWORD, so the built-in default can't grant admin / leak PII.
const IS_PROD_LIKE =
  !!process.env.DATABASE_URL || process.env.NODE_ENV === "production";
const ADMIN_ENABLED = !(!process.env.ADMIN_PASSWORD && IS_PROD_LIKE);

const { store } = createStore();

const app = express();
app.use(cors());
// Scope the large body limit to admin import; keep public endpoints tight.
app.use("/api/admin/import", express.json({ limit: "5mb" }));
app.use(express.json({ limit: "200kb" }));

app.use(
  "/api",
  createRouter({
    store,
    adminUsername: ADMIN_USERNAME,
    adminPassword: ADMIN_PASSWORD,
    sessionSecret: SESSION_SECRET,
    adminEnabled: ADMIN_ENABLED,
  })
);

export const handler = serverless(app);
