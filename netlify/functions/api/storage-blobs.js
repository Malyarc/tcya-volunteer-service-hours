// Netlify Blobs-backed storage. The whole `{ submissions, events }` JSON
// document is stored under one key — same shape, same schema, just persisted
// in Netlify's managed key/value store instead of a local file.
//
// NOTE on concurrency: Netlify Blobs doesn't have built-in compare-and-swap.
// For our scale (small chapter, infrequent writes) the simple
// read-modify-write pattern is fine; if two writes ever land in the same
// millisecond, the second one's read will see a stale snapshot and may
// drop the first write. If we ever need stricter guarantees we can switch
// to the etag-based conditional write API.

import { getStore } from "@netlify/blobs";

export function createBlobsStorage(storeName, key) {
  // Construct the store per-request rather than caching at module scope.
  // @netlify/blobs binds the request's siteID/token at construction time,
  // and that context is only available *after* connectLambda(event) has
  // been called for the current invocation (see api.mjs).
  function store() {
    return getStore(storeName);
  }

  async function readData() {
    const data = await store().get(key, { type: "json" });
    if (!data || typeof data !== "object") {
      return { submissions: [], events: [] };
    }
    return {
      submissions: Array.isArray(data.submissions) ? data.submissions : [],
      events: Array.isArray(data.events) ? data.events : [],
    };
  }

  async function writeData(updater) {
    const current = await readData();
    const next = await updater(current);
    await store().setJSON(key, next);
    return next;
  }

  return { readData, writeData };
}
