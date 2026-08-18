// EC2 / single-process entry point. Builds the store from DATABASE_URL (Neon
// in production; in-memory fallback for a zero-config local run), mounts the
// shared router under /api, and serves the built client when present.

import express from "express";
import cors from "cors";
import path from "path";
import fssync from "fs";
import { fileURLToPath } from "url";
import { createRouter, deriveSessionSecret } from "./routes.js";
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  OFFICER_PASSWORD,
  OFFICER_USERNAME,
} from "./accounts.js";
import { createStore } from "./db/create-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4000;
const CLIENT_DIST = path.resolve(__dirname, "..", "..", "client", "dist");

// The two chapter passcodes are owned by the app (server/src/accounts.js), not
// by deploy configuration, so every deployment has the same working admin and
// officer sign-in with nothing to set. SESSION_SECRET stays overridable: it is
// not a credential anyone types, only the key the session tokens are HMAC'd
// with, and setting it invalidates existing tokens on rotation.
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  deriveSessionSecret(ADMIN_USERNAME, ADMIN_PASSWORD);

const { store, backend } = createStore();

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
    backend,
    adminUsername: ADMIN_USERNAME,
    adminPassword: ADMIN_PASSWORD,
    officerUsername: OFFICER_USERNAME,
    officerPassword: OFFICER_PASSWORD,
    sessionSecret: SESSION_SECRET,
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
      console.log(
        `Sign-in enabled for "${ADMIN_USERNAME}" (full access) and "${OFFICER_USERNAME}" (QR check-in/out only). Passcodes live in server/src/accounts.js.`
      );
    });
  })
  .catch((err) => {
    console.error("Failed to initialize storage backend:", err);
    process.exit(1);
  });
