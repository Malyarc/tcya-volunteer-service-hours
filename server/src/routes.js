// Shared Express router. The same routes serve both the EC2 deployment
// (server/src/index.js) and the Netlify Functions deployment
// (netlify/functions/api/api.mjs). The storage backend (Postgres or in-memory)
// is injected as a `store` so this module has no I/O concerns of its own.

import express from "express";
import crypto from "crypto";

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function isValidDate(d) {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

function normalizeIsoOrNull(v) {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toISOString();
}

function trimStr(v, max = 500) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function sanitizeCustomFields(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out = {};
  let count = 0;
  for (const [k, val] of Object.entries(v)) {
    const key = String(k).trim().slice(0, 60);
    if (!key) continue;
    out[key] =
      val == null ? "" : String(typeof val === "object" ? "" : val).slice(0, 500);
    count += 1;
    if (count >= 30) break;
  }
  return out;
}

// Strip fields the public shouldn't see from an event's attendance list. The
// volunteer QR `code` is a check-in credential, and volunteer ids + check-in/out
// timestamps are internal — none belong in the anonymous GET /events response.
// Admin callers get the full objects.
function publicEvent(event) {
  return {
    ...event,
    attendance: (event.attendance || []).map((a) => ({
      volunteerName: a.volunteerName,
      staffCheckin: a.staffCheckin,
      volunteerCheckout: a.volunteerCheckout,
      selfAdded: a.selfAdded,
    })),
  };
}

export function createRouter({
  store,
  adminUsername,
  adminPassword,
  sessionSecret,
  // When false (production with no explicit ADMIN_PASSWORD), all admin routes
  // and /login are disabled so a predictable default credential can never grant
  // access. See the entry points (index.js / api.mjs).
  adminEnabled = true,
}) {
  const ADMIN_TOKEN = crypto
    .createHmac("sha256", sessionSecret)
    .update(adminUsername + ":" + adminPassword)
    .digest("hex");

  function isAdminRequest(req) {
    if (!adminEnabled) return false;
    const token = (req.headers["x-admin-token"] || "").toString();
    return constantTimeEqual(token, ADMIN_TOKEN);
  }

  function requireAdmin(req, res, next) {
    if (!adminEnabled) {
      return res.status(503).json({
        error:
          "Admin is disabled on this deployment. Set ADMIN_PASSWORD to enable it.",
      });
    }
    if (isAdminRequest(req)) return next();
    res.status(401).json({ error: "Admin authentication required" });
  }

  // ---- Login throttle: cap failed attempts per client IP. In-memory (per
  // instance), so it's best-effort on serverless, but it meaningfully slows a
  // brute force of the single shared password. ----
  const LOGIN_WINDOW_MS = 15 * 60 * 1000;
  const LOGIN_MAX_FAILS = 10;
  const LOGIN_LOCK_MS = 15 * 60 * 1000;
  const loginAttempts = new Map();
  function loginKey(req) {
    // Key on an address the client cannot forge. `x-nf-client-connection-ip` is
    // set by Netlify's edge to the real client IP and cannot be overridden by
    // the caller. We deliberately do NOT read `x-forwarded-for` (fully
    // client-settable) — that would let an attacker rotate the header to get a
    // fresh bucket per request and bypass the throttle entirely. Fall back to
    // the direct socket address (trust-proxy is left off, so req.ip is the
    // socket peer, not a forwarded header).
    const nf = (req.headers["x-nf-client-connection-ip"] || "").toString().trim();
    return nf || req.ip || req.socket?.remoteAddress || "unknown";
  }
  function loginLockRemaining(key) {
    const a = loginAttempts.get(key);
    if (a && a.lockedUntil && a.lockedUntil > Date.now()) {
      return Math.ceil((a.lockedUntil - Date.now()) / 1000);
    }
    return 0;
  }
  function loginRecordFail(key) {
    const now = Date.now();
    let a = loginAttempts.get(key);
    if (!a || now - a.first > LOGIN_WINDOW_MS) a = { count: 0, first: now, lockedUntil: 0 };
    a.count += 1;
    if (a.count >= LOGIN_MAX_FAILS) a.lockedUntil = now + LOGIN_LOCK_MS;
    loginAttempts.set(key, a);
    // Bound the map by evicting the oldest entries that are NOT actively locked,
    // so a flood of distinct keys can't wipe a genuine lockout via `.clear()`.
    if (loginAttempts.size > 5000) {
      for (const [k, v] of loginAttempts) {
        if (loginAttempts.size <= 4000) break;
        if (!(v.lockedUntil && v.lockedUntil > now)) loginAttempts.delete(k);
      }
    }
  }
  function loginRecordSuccess(key) {
    loginAttempts.delete(key);
  }

  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // ---------- Auth ----------

  router.post("/login", (req, res) => {
    if (!adminEnabled) {
      return res.status(503).json({
        error:
          "Admin is disabled on this deployment. Set ADMIN_PASSWORD to enable it.",
      });
    }
    const key = loginKey(req);
    const wait = loginLockRemaining(key);
    if (wait > 0) {
      return res
        .status(429)
        .json({ error: `Too many attempts. Try again in ${wait}s.` });
    }
    const { username, password } = req.body || {};
    if (typeof username !== "string" || username.length === 0) {
      return res.status(400).json({ error: "Username is required" });
    }
    if (typeof password !== "string" || password.length === 0) {
      return res.status(400).json({ error: "Password is required" });
    }
    const userOk = constantTimeEqual(username, adminUsername);
    const passOk = constantTimeEqual(password, adminPassword);
    if (!userOk || !passOk) {
      loginRecordFail(key);
      return res.status(401).json({ error: "Invalid username or password" });
    }
    loginRecordSuccess(key);
    res.json({ token: ADMIN_TOKEN });
  });

  router.get("/session", (req, res) => {
    res.json({ admin: isAdminRequest(req) });
  });

  // ---------- Public roster (names + grade only, no PII) ----------

  router.get("/roster", async (_req, res) => {
    try {
      const vols = await store.listVolunteers();
      res.json(vols.map((v) => ({ name: v.name, grade: v.grade || "" })));
    } catch (err) {
      console.error("Failed to read roster", err);
      res.status(500).json({ error: "Failed to read roster" });
    }
  });

  // ---------- Volunteers (admin — full records incl. contact info) ----------

  router.get("/volunteers", requireAdmin, async (_req, res) => {
    try {
      res.json(await store.listVolunteers());
    } catch (err) {
      console.error("Failed to read volunteers", err);
      res.status(500).json({ error: "Failed to read volunteers" });
    }
  });

  router.post("/volunteers", requireAdmin, async (req, res) => {
    const body = req.body || {};
    const name = trimStr(body.name, 120);
    if (!name) return res.status(400).json({ error: "name is required" });
    try {
      // Guard against accidental duplicate names — attendance and hours are
      // keyed by name, so two "John Smith"s would silently merge. Deliberate
      // duplicates can pass `force: true`.
      if (body.force !== true) {
        const existing = await store.getVolunteerByName(name);
        if (existing) {
          return res.status(409).json({
            error: `A volunteer named "${name}" already exists (${existing.code}). Add anyway?`,
            code: "duplicate_name",
          });
        }
      }
      const volunteer = await store.createVolunteer({
        name,
        email: trimStr(body.email, 200),
        phone: trimStr(body.phone, 60),
        grade: trimStr(body.grade, 40),
        customFields: sanitizeCustomFields(body.customFields),
      });
      res.status(201).json(volunteer);
    } catch (err) {
      console.error("Failed to create volunteer", err);
      res.status(500).json({ error: "Failed to create volunteer" });
    }
  });

  router.patch("/volunteers/:id", requireAdmin, async (req, res) => {
    const body = req.body || {};
    const patch = {};
    if (body.name !== undefined) {
      const name = trimStr(body.name, 120);
      if (!name) return res.status(400).json({ error: "name cannot be empty" });
      patch.name = name;
    }
    if (body.email !== undefined) patch.email = trimStr(body.email, 200);
    if (body.phone !== undefined) patch.phone = trimStr(body.phone, 60);
    if (body.grade !== undefined) patch.grade = trimStr(body.grade, 40);
    if (body.active !== undefined) patch.active = Boolean(body.active);
    if (body.customFields !== undefined)
      patch.customFields = sanitizeCustomFields(body.customFields);

    try {
      const volunteer = await store.updateVolunteer(req.params.id, patch);
      if (!volunteer)
        return res.status(404).json({ error: "Volunteer not found" });
      res.json(volunteer);
    } catch (err) {
      if (err && err.code === "name_conflict") {
        return res.status(409).json({ error: err.message });
      }
      console.error("Failed to update volunteer", err);
      res.status(500).json({ error: "Failed to update volunteer" });
    }
  });

  router.delete("/volunteers/:id", requireAdmin, async (req, res) => {
    try {
      const ok = await store.deleteVolunteer(req.params.id);
      if (!ok) return res.status(404).json({ error: "Volunteer not found" });
      res.json({ ok: true });
    } catch (err) {
      console.error("Failed to delete volunteer", err);
      res.status(500).json({ error: "Failed to delete volunteer" });
    }
  });

  // ---------- Submissions ----------

  router.get("/submissions", async (req, res) => {
    try {
      const subs = await store.listSubmissions();
      // Admins see full rows (needed for the Excel export + attendance detail).
      // Public callers get a projection WITHOUT the exact check-in/out clock
      // times or free-text comments — those are the same internal details
      // publicEvent() strips from /events, and this data is about minors.
      res.json(
        isAdminRequest(req)
          ? subs
          : subs.map((s) => ({
              id: s.id,
              eventId: s.eventId,
              volunteerName: s.volunteerName,
              grade: s.grade,
              eventName: s.eventName,
              customEventName: s.customEventName,
              eventDate: s.eventDate,
              hours: s.hours,
            }))
      );
    } catch (err) {
      console.error("Failed to read submissions", err);
      res.status(500).json({ error: "Failed to read submissions" });
    }
  });

  // Note: there is no public POST /submissions anymore. Service hours are
  // derived from a volunteer's check-in / check-out times (QR scan or the
  // admin's manual time edit on the event page) — see the store's
  // reconcileSubmission. GET /submissions still serves those derived rows.

  // ---------- Events ----------

  router.get("/events", async (req, res) => {
    try {
      const events = await store.listEvents();
      // Full attendance (codes, ids, timestamps) only for admins.
      res.json(isAdminRequest(req) ? events : events.map(publicEvent));
    } catch (err) {
      console.error("Failed to read events", err);
      res.status(500).json({ error: "Failed to read events" });
    }
  });

  router.post("/events", requireAdmin, async (req, res) => {
    const { name, customName, date } = req.body || {};
    const errors = [];
    if (!name || typeof name !== "string") errors.push("name is required");
    if (!isValidDate(date)) errors.push("date must be YYYY-MM-DD");
    if (
      name === "Others - please specify" &&
      (!customName || typeof customName !== "string")
    ) {
      errors.push("customName is required when name is 'Others'");
    }
    if (errors.length > 0) return res.status(400).json({ errors });

    try {
      const event = await store.createEvent({
        name: name.trim(),
        customName:
          name === "Others - please specify" ? String(customName).trim() : null,
        date,
      });
      res.status(201).json(event);
    } catch (err) {
      console.error("Failed to create event", err);
      res.status(500).json({ error: "Failed to create event" });
    }
  });

  router.delete("/events/:id", requireAdmin, async (req, res) => {
    try {
      await store.deleteEvent(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      console.error("Failed to delete event", err);
      res.status(500).json({ error: "Failed to delete event" });
    }
  });

  router.post("/events/:id/attendance", requireAdmin, async (req, res) => {
    const { volunteerNames } = req.body || {};
    if (!Array.isArray(volunteerNames)) {
      return res.status(400).json({ error: "volunteerNames must be an array" });
    }
    try {
      const event = await store.addAttendees(req.params.id, volunteerNames);
      if (!event) return res.status(404).json({ error: "Event not found" });
      res.json(event);
    } catch (err) {
      console.error("Failed to add attendees", err);
      res.status(500).json({ error: "Failed to add attendees" });
    }
  });

  router.patch("/events/:id/attendance", requireAdmin, async (req, res) => {
    const body = req.body || {};
    const { volunteerName, staffCheckin, volunteerCheckout } = body;
    if (!volunteerName || typeof volunteerName !== "string") {
      return res.status(400).json({ error: "volunteerName is required" });
    }
    const patch = {};
    if (typeof staffCheckin === "boolean") patch.staffCheckin = staffCheckin;
    if (typeof volunteerCheckout === "boolean")
      patch.volunteerCheckout = volunteerCheckout;
    // Manual time edits: a present key sets the value (valid ISO, or null to
    // clear). An UNPARSEABLE value is ignored (not coerced to null) so a bad
    // request can never silently wipe a real check-in/out time.
    if ("checkinAt" in body) {
      const v = normalizeIsoOrNull(body.checkinAt);
      if (v !== undefined) patch.checkinAt = v;
    }
    if ("checkoutAt" in body) {
      const v = normalizeIsoOrNull(body.checkoutAt);
      if (v !== undefined) patch.checkoutAt = v;
    }

    try {
      const event = await store.patchAttendance(
        req.params.id,
        volunteerName,
        patch
      );
      if (!event) return res.status(404).json({ error: "Event not found" });
      res.json(event);
    } catch (err) {
      console.error("Failed to update attendance", err);
      res.status(500).json({ error: "Failed to update attendance" });
    }
  });

  router.delete("/events/:id/attendance", requireAdmin, async (req, res) => {
    const { volunteerName } = req.body || {};
    if (!volunteerName || typeof volunteerName !== "string") {
      return res.status(400).json({ error: "volunteerName is required" });
    }
    try {
      const event = await store.removeAttendance(req.params.id, volunteerName);
      if (!event) return res.status(404).json({ error: "Event not found" });
      res.json(event);
    } catch (err) {
      console.error("Failed to remove attendee", err);
      res.status(500).json({ error: "Failed to remove attendee" });
    }
  });

  // ---------- QR check-in / check-out (admin scanner) ----------

  async function handleScan(req, res, kind) {
    const code = trimStr((req.body || {}).code, 120);
    if (!code) return res.status(400).json({ error: "code is required" });
    try {
      const fn = kind === "checkin" ? store.checkInByCode : store.checkOutByCode;
      const result = await fn(req.params.id, code);
      if (!result.ok) {
        if (result.reason === "unknown_event")
          return res.status(404).json({ error: "Event not found" });
        return res.status(404).json({
          error: "No volunteer matches that QR code",
          reason: "unknown_code",
        });
      }
      res.json({
        ok: true,
        volunteer: result.volunteer,
        attendance: result.attendance,
        event: result.event,
        alreadyDone: result.alreadyDone === true,
      });
    } catch (err) {
      console.error(`Failed to ${kind}`, err);
      res.status(500).json({ error: `Failed to ${kind}` });
    }
  }

  router.post("/events/:id/checkin", requireAdmin, (req, res) =>
    handleScan(req, res, "checkin")
  );
  router.post("/events/:id/checkout", requireAdmin, (req, res) =>
    handleScan(req, res, "checkout")
  );

  // ---------- Admin maintenance ----------

  router.post("/admin/reset", requireAdmin, async (_req, res) => {
    try {
      await store.reset();
      res.json({ ok: true });
    } catch (err) {
      console.error("Failed to reset", err);
      res.status(500).json({ error: "Failed to reset" });
    }
  });

  router.get("/admin/export", requireAdmin, async (_req, res) => {
    try {
      const data = await store.exportAll();
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ela-tcya-backup-${stamp}.json"`
      );
      res.send(JSON.stringify(data, null, 2));
    } catch (err) {
      console.error("Failed to export", err);
      res.status(500).json({ error: "Failed to export" });
    }
  });

  router.post("/admin/import", requireAdmin, async (req, res) => {
    const body = req.body || {};
    if (
      !Array.isArray(body.events) &&
      !Array.isArray(body.submissions) &&
      !Array.isArray(body.volunteers)
    ) {
      return res.status(400).json({
        error: "Provide at least one of: events, submissions, volunteers",
      });
    }
    // Reject duplicate volunteer codes/ids up front (fail loud + identically on
    // both stores) rather than letting Postgres silently drop or PK-violate.
    if (Array.isArray(body.volunteers)) {
      const codes = new Set();
      const ids = new Set();
      for (const v of body.volunteers) {
        if (!v || typeof v !== "object") continue;
        if (typeof v.code !== "string" || !v.code.trim()) {
          return res.status(400).json({ error: "Every imported volunteer must have a code" });
        }
        {
          if (codes.has(v.code))
            return res.status(400).json({ error: `Duplicate volunteer code in import: ${v.code}` });
          codes.add(v.code);
        }
        if (typeof v.id === "string") {
          if (ids.has(v.id))
            return res.status(400).json({ error: `Duplicate volunteer id in import: ${v.id}` });
          ids.add(v.id);
        }
      }
    }
    try {
      const data = await store.importAll(body);
      res.json({
        ok: true,
        counts: {
          volunteers: data.volunteers.length,
          events: data.events.length,
          submissions: data.submissions.length,
        },
      });
    } catch (err) {
      console.error("Failed to import", err);
      res.status(500).json({ error: "Failed to import data" });
    }
  });

  return router;
}

export function deriveSessionSecret(adminUsername, adminPassword) {
  return crypto
    .createHash("sha256")
    .update("ela-tcya-default-secret-" + adminUsername + ":" + adminPassword)
    .digest("hex");
}
