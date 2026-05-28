// EC2 entry point. Uses file-backed storage; mounts the shared router under
// /api; serves the built client when present.

import express from "express";
import cors from "cors";
import path from "path";
import fssync from "fs";
import { fileURLToPath } from "url";
import { createRouter, deriveSessionSecret } from "./routes.js";
import { createFileStorage } from "./storage-file.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4000;
const DATA_DIR = path.resolve(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "submissions.json");
const CLIENT_DIST = path.resolve(__dirname, "..", "..", "client", "dist");

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1013";
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  deriveSessionSecret(ADMIN_USERNAME, ADMIN_PASSWORD);

const storage = createFileStorage(DATA_FILE);

const app = express();
app.use(cors());
app.use(express.json({ limit: "200kb" }));

app.use(
  "/api",
  createRouter({
    ...storage,
    adminUsername: ADMIN_USERNAME,
    adminPassword: ADMIN_PASSWORD,
    sessionSecret: SESSION_SECRET,
  })
);

if (fssync.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Volunteer tracker API listening on port ${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
  const usingDefaults =
    !process.env.ADMIN_USERNAME && !process.env.ADMIN_PASSWORD;
  console.log(
    `Admin login enabled as user "${ADMIN_USERNAME}"${
      usingDefaults
        ? " (default credentials — set ADMIN_USERNAME / ADMIN_PASSWORD to change)"
        : " (credentials set via environment)"
    }`
  );
});
