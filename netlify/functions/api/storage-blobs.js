// Netlify Blobs-backed storage. The whole `{ submissions, events }` JSON
// document is stored under one key — same shape, same schema, just persisted
// in Netlify's managed key/value store instead of a local file.
//
// CONSISTENCY: Netlify Blobs reads default to *eventual* consistency, so a
// read that immediately follows a write can return a stale snapshot. Because
// this app does read-modify-write on a single document across separate
// serverless invocations, that lag caused the reported bug: create an event,
// then add a volunteer to it, and the second invocation's read didn't yet see
// the just-created event ("Event not found" / "Selected event no longer
// exists").
//
// We must NOT fix this with `getStore({ consistency: "strong" })`: this
// function runs via connectLambda (Lambda-compat / serverless-http), and
// connectLambda only injects edgeURL/siteID/token — NOT the `uncachedEdgeURL`
// that strong-consistency reads require. Requesting strong consistency makes
// every read throw ("...the environment has not been configured with a
// 'uncachedEdgeURL' property"), which 500s the entire API.
//
// So reads stay eventual. To keep the create-event → add-volunteer flow
// reliable, the event-lookup handlers in routes.js retry the read a few times
// (via writeWithConsistencyRetry) — a backend-agnostic mitigation that needs
// no special Blobs configuration and is a no-op on the strongly-consistent
// EC2 file store.

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
