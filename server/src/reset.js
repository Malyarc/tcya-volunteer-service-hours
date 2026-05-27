// Reset all volunteer hours back to zero by clearing the submissions store.
// Always makes a timestamped backup first so the data can be recovered.
//
// Usage (from anywhere on the server):
//   cd ~/tcya-volunteer-service-hours/server && npm run reset
// Or directly:
//   node ~/tcya-volunteer-service-hours/server/src/reset.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "submissions.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

fs.mkdirSync(BACKUP_DIR, { recursive: true });

if (fs.existsSync(DATA_FILE)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(BACKUP_DIR, `submissions-${stamp}.json`);
  fs.copyFileSync(DATA_FILE, backupFile);
  console.log(`Backup saved → ${backupFile}`);
} else {
  console.log("No existing data file found — nothing to back up.");
}

fs.writeFileSync(
  DATA_FILE,
  JSON.stringify({ submissions: [], events: [] }, null, 2),
  "utf-8"
);

console.log("All volunteer hours and events reset.");
console.log(`Data file: ${DATA_FILE}`);
