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
  // Lazy-construct so importing the module outside of a Netlify runtime
  // (e.g. local syntax checks) doesn't throw before any request comes in.
  let store = null;
  function getOrCreateStore() {
    if (!store) store = getStore(storeName);
    return store;
  }

  async function readData() {
    const data = await getOrCreateStore().get(key, { type: "json" });
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
    await getOrCreateStore().setJSON(key, next);
    return next;
  }

  return { readData, writeData };
}
