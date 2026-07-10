// Chooses the storage backend at runtime. When DATABASE_URL is set (Neon in
// production, on both EC2 and Netlify) the app uses Postgres. Otherwise it
// falls back to an in-memory store — handy for a zero-config local run and for
// tests, but NOT durable across restarts.

import { createPostgresStore } from "./store-postgres.js";
import { createMemoryStore } from "./store-memory.js";

export function createStore(env = process.env) {
  const url = env.DATABASE_URL;
  if (url && url.trim()) {
    return { store: createPostgresStore(url.trim()), backend: "postgres" };
  }
  return { store: createMemoryStore(), backend: "memory" };
}
