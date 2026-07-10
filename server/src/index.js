// EC2 / single-process entry point. Builds the store from DATABASE_URL (Neon
// in production; in-memory fallback for a zero-config local run), mounts the
// shared router under /api, and serves the built client when present.

import express from "express";
import cors from "cors";
import path from "path";
import fssync from "fs";
import { fileURLToPath } from "url";
import { createRouter, deriveSessionSecret } from "./routes.js";
import { createStore } from "./db/create-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4000;
const CLIENT_DIST = path.resolve(__dirname, "..", "..", "client", "dist");

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1013";
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  deriveSessionSecret(ADMIN_USERNAME, ADMIN_PASSWORD);

const { store, backend } = createStore();

// Fail closed: if this is a real deployment (a database is configured, or
// NODE_ENV=production) and ADMIN_PASSWORD was left at the built-in default,
// disable admin entirely so the predictable default credential can never grant
// access or leak volunteer PII. Local dev (no DATABASE_URL) keeps the default
// for convenience.
const USING_DEFAULT_PASSWORD = !process.env.ADMIN_PASSWORD;
const IS_PROD_LIKE =
  !!process.env.DATABASE_URL || process.env.NODE_ENV === "production";
const ADMIN_ENABLED = !(USING_DEFAULT_PASSWORD && IS_PROD_LIKE);

const app = express();
app.use(cors());
// Only the admin import endpoint carries a full data file; keep the public
// endpoints on a tight 200kb cap so anonymous callers can't post huge bodies.
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

if (fssync.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
}

// Warm the schema + seed before accepting traffic (no-op on the memory store).
store
  .ensureReady()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Volunteer tracker API listening on port ${PORT}`);
      console.log(`Storage backend: ${backend}`);
      if (backend === "memory") {
        console.log(
          "WARNING: no DATABASE_URL set — using in-memory storage (data is NOT persisted across restarts). Set DATABASE_URL to your Neon connection string."
        );
      }
      if (!ADMIN_ENABLED) {
        console.log(
          `Admin login DISABLED: ADMIN_PASSWORD is unset on a production-like deployment. Set ADMIN_PASSWORD (and ideally SESSION_SECRET) to enable admin access.`
        );
      } else {
        const usingDefaults = !process.env.ADMIN_PASSWORD;
        console.log(
          `Admin login enabled as user "${ADMIN_USERNAME}"${
            usingDefaults
              ? " (DEFAULT password — set ADMIN_PASSWORD for production)"
              : " (credentials set via environment)"
          }`
        );
      }
    });
  })
  .catch((err) => {
    console.error("Failed to initialize storage backend:", err);
    process.exit(1);
  });
