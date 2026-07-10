// Netlify Blobs-backed storage. The whole `{ submissions, events }` JSON
// document is stored under one key — same shape, same schema, just persisted
// in Netlify's managed key/value store instead of a local file.
//
// CONSISTENCY (critical): Netlify Blobs reads default to *eventual*
// consistency, meaning a read that immediately follows a write can return a
// stale snapshot. Because this app does read-modify-write on a single
// document across separate serverless invocations, that default caused a
// real bug: creating an event and then adding a volunteer to it (two quick
// admin actions, two invocations) — the second invocation's read did not yet
// see the just-created event, so the API answered "Event not found" /
// "Selected event no longer exists". We therefore open the store in STRONG
// consistency mode, which guarantees read-after-write.
//
// NOTE on concurrent writes: strong consistency fixes stale reads but this
// API version (@netlify/blobs v8) has no compare-and-swap, so two writes that
// interleave within a single read-modify-write window can still last-writer-
// win. For a small chapter's submission volume this is acceptable; if
// simultaneous writes ever become common, move to per-key storage (one blob
// per event / per submission) so independent writes never contend.

import { getStore } from "@netlify/blobs";

export function createBlobsStorage(storeName, key) {
  // Construct the store per-request rather than caching at module scope.
  // @netlify/blobs binds the request's siteID/token at construction time,
  // and that context is only available *after* connectLambda(event) has
  // been called for the current invocation (see api.mjs).
  function store() {
    return getStore({ name: storeName, consistency: "strong" });
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
