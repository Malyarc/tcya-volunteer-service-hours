// One-shot database initializer: creates the schema (idempotent) and seeds the
// volunteer roster if the table is empty. Safe to run repeatedly.
//
//   DATABASE_URL='postgres://…' npm run migrate   (from the server/ directory)

import { createStore } from "./db/create-store.js";

const { store, backend } = createStore();

if (backend !== "postgres") {
  console.error(
    "No DATABASE_URL set — nothing to migrate (the in-memory store needs no schema). Set DATABASE_URL to your Neon connection string."
  );
  process.exit(1);
}

try {
  await store.ensureReady();
  const vols = await store.listVolunteers();
  console.log(`Schema ready. Roster has ${vols.length} volunteer(s).`);
  console.log("Migration complete.");
  process.exit(0);
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
}
