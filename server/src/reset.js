// Clears events, attendance, and submissions (a fresh cycle) while KEEPING the
// volunteer roster and their QR codes. Operates on whatever backend
// DATABASE_URL selects. Always writes a timestamped backup of the FULL data
// (volunteers + events + submissions) before wiping, so a mistaken reset is
// recoverable via `POST /api/admin/import`.
//
//   DATABASE_URL='postgres://…' npm run reset   (from the server/ directory)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createStore } from "./db/create-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKUP_DIR = path.resolve(__dirname, "..", "data", "backups");

const { store, backend } = createStore();

if (backend !== "postgres") {
  console.error(
    "No DATABASE_URL set — refusing to 'reset' the ephemeral in-memory store (nothing persists there anyway)."
  );
  process.exit(1);
}

try {
  // Back up first.
  const data = await store.exportAll();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(BACKUP_DIR, `backup-${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(data, null, 2), "utf-8");
  console.log(
    `Backup saved → ${backupFile} (${data.volunteers.length} volunteers, ${data.events.length} events, ${data.submissions.length} submissions).`
  );

  await store.reset();
  console.log(
    "Reset complete — events, attendance, and submissions cleared. Volunteer roster preserved."
  );
  console.log("Restore with: POST /api/admin/import (admin) using the backup file above.");
  process.exit(0);
} catch (err) {
  console.error("Reset failed:", err);
  process.exit(1);
}
