// Shared Express router. The same routes serve both the EC2 deployment
// (server/src/index.js) and the Netlify Functions deployment
// (netlify/functions/api/api.mjs). The storage backend (Postgres or in-memory)
// is injected as a `store` so this module has no I/O concerns of its own.

import express from "express";
import crypto from "crypto";
import { VOLUNTEER_ROLES, normalizeRole } from "./roles.js";
import {
  ACCOUNT_ADMIN,
  ACCOUNT_OFFICER,
  ADMIN_PASSWORD as BUILT_IN_ADMIN_PASSWORD,
  ADMIN_USERNAME as BUILT_IN_ADMIN_USERNAME,
  OFFICER_PASSWORD as BUILT_IN_OFFICER_PASSWORD,
  OFFICER_USERNAME as BUILT_IN_OFFICER_USERNAME,
} from "./accounts.js";
import { MAX_STRIKES } from "./db/schema.js";
import { AUDIT_ACTIONS, AUDIT_METHODS, isAuditAction } from "./audit.js";

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function isValidDate(d) {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

// Event start/end are wall-clock 'HH:MM' strings (or "" for not set). They are
// scheduling metadata only — credited hours still come from each volunteer's
// own check-in/out timestamps, never from these.
function isValidClock(t) {
  return typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}
function parseClockField(v) {
  if (v === null || v === "") return "";
  if (isValidClock(v)) return v;
  return undefined; // invalid → caller reports an error
}

// Expected Volunteer Hours: a non-negative number, or null for "no cap".
function parseExpectedHours(v) {
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 24) return undefined; // invalid
  return n;
}

// A strike count off the wire: a real number, or a numeric string. Everything
// else is rejected rather than coerced. Bare `Number()` would take null, false,
// "" and [] to 0 (silently CLEARING a recorded strike) and true to 1 (inventing
// one) — precisely the silent write both strike routes promise never to make.
function parseStrikes(v) {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && v.trim() !== ""
        ? Number(v)
        : NaN;
  if (!Number.isInteger(n) || n < 0 || n > MAX_STRIKES) return undefined;
  return n;
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
// `role` and `strikes` ARE included: the chapter wants the Officer badge and a
// volunteer's own strike count visible on the passcode-gated roster page. They
// carry no contact info, no ID and no clock times.
function publicEvent(event) {
  return {
    ...event,
    attendance: (event.attendance || []).map((a) => ({
      volunteerName: a.volunteerName,
      staffCheckin: a.staffCheckin,
      volunteerCheckout: a.volunteerCheckout,
      selfAdded: a.selfAdded,
      role: a.role,
      strikes: a.strikes,
    })),
  };
}

// The projection an OFFICER sees. Officers run the door: they need to see who
// is on the list and who has already been scanned in or out, so unlike the
// anonymous projection this keeps the check-in/out timestamps. It still strips
// the two things an officer has no business holding: the volunteer QR `code`
// (a check-in credential — an officer must scan the card, not type a code they
// read off the screen) and the internal `volunteerId`.
function officerAttendance(a) {
  return {
    volunteerName: a.volunteerName,
    staffCheckin: a.staffCheckin,
    checkinAt: a.checkinAt ?? null,
    volunteerCheckout: a.volunteerCheckout,
    checkoutAt: a.checkoutAt ?? null,
    selfAdded: a.selfAdded,
    role: a.role,
    strikes: a.strikes,
  };
}

function officerEvent(event) {
  return {
    ...event,
    attendance: (event.attendance || []).map(officerAttendance),
  };
}

// The volunteer record an officer gets back from their OWN scan. The QR they
// just scanned already carries the code and the name, so echoing those back is
// not a disclosure — but the stored contact details are, and an officer never
// needs them.
function officerVolunteer(v) {
  return {
    code: v.code,
    name: v.name,
    grade: v.grade || "",
    role: v.role,
  };
}

// A list of event-group names, sanitized: trimmed, de-duplicated, bounded.
// Unknown names are harmless (the client ignores an order entry with no group),
// so this validates shape only.
function parseOrderNames(v) {
  if (!Array.isArray(v)) return undefined;
  if (v.length > 500) return undefined;
  const out = [];
  const seen = new Set();
  for (const raw of v) {
    if (typeof raw !== "string") return undefined;
    const name = raw.trim().slice(0, 200);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function createRouter({
  store,
  // The active storage backend ("postgres" | "memory" | "unknown"), surfaced by
  // /health so a non-durable deploy is detectable by any monitor.
  backend = "unknown",
  adminUsername = BUILT_IN_ADMIN_USERNAME,
  adminPassword = BUILT_IN_ADMIN_PASSWORD,
  officerUsername = BUILT_IN_OFFICER_USERNAME,
  officerPassword = BUILT_IN_OFFICER_PASSWORD,
  sessionSecret,
  // When false, /login and every privileged route are disabled. Kept as an
  // explicit kill switch (and exercised by the tests); the shipped entry points
  // pass true because the credentials live in accounts.js, not in deploy
  // configuration, so there is no "unset password" state to fail closed on.
  adminEnabled = true,
}) {
  // Two independent bearer tokens, each an HMAC of that account's credentials.
  // Distinct derivation prefixes mean the two can never collide even if the
  // chapter ever picks the same passcode for both.
  const ADMIN_TOKEN = crypto
    .createHmac("sha256", sessionSecret)
    .update(adminUsername + ":" + adminPassword)
    .digest("hex");
  const OFFICER_TOKEN = crypto
    .createHmac("sha256", sessionSecret)
    .update("officer:" + officerUsername + ":" + officerPassword)
    .digest("hex");

  // The account role a request is authenticated as, or null. Admin is tested
  // first so a (misconfigured) shared passcode resolves to the stronger role
  // for its own token only — the tokens themselves stay distinct.
  function accountRole(req) {
    if (!adminEnabled) return null;
    const token = (req.headers["x-admin-token"] || "").toString();
    if (constantTimeEqual(token, ADMIN_TOKEN)) return ACCOUNT_ADMIN;
    if (constantTimeEqual(token, OFFICER_TOKEN)) return ACCOUNT_OFFICER;
    return null;
  }

  function isAdminRequest(req) {
    return accountRole(req) === ACCOUNT_ADMIN;
  }

  function isOfficerRequest(req) {
    return accountRole(req) === ACCOUNT_OFFICER;
  }

  function disabledResponse(res) {
    return res.status(503).json({
      error: "Sign-in is disabled on this deployment.",
    });
  }

  function requireAdmin(req, res, next) {
    if (!adminEnabled) return disabledResponse(res);
    const role = accountRole(req);
    if (role === ACCOUNT_ADMIN) return next();
    // An OFFICER is authenticated, just not allowed here. That is a 403, never
    // a 401: the client clears its stored token on a 401, so answering 401
    // would silently sign a working officer out mid-event.
    if (role === ACCOUNT_OFFICER) {
      return res.status(403).json({
        error:
          "Officers can only scan volunteers in and out and record conduct strikes. Ask an admin to make this change.",
        code: "officer_forbidden",
      });
    }
    res.status(401).json({ error: "Admin authentication required" });
  }

  // Door duty — the privileged capabilities an officer holds: the QR scanner
  // (check-in / check-out) and recording a conduct strike. Both roles pass;
  // anonymous callers do not. Nothing else may ever be mounted here: every
  // route under this guard must be one an officer running a door needs, and
  // must be narrow enough that it cannot edit hours, times or the roster.
  function requireScanner(req, res, next) {
    if (!adminEnabled) return disabledResponse(res);
    if (accountRole(req)) return next();
    res.status(401).json({ error: "Admin or officer authentication required" });
  }

  // ---- Audit log ----
  //
  // Append one entry for an action that has ALREADY succeeded. It swallows its
  // own errors on purpose: the mutation is done and answered, so failing the
  // request over a failed log write would tell the user their change did not
  // happen — and they would retry it, applying it twice. A missing log line is
  // the lesser loss, and it is reported to the server log rather than silently.
  //
  // The actor is the ACCOUNT (admin | officer), never a person: both passcodes
  // are chapter-shared, so this cannot identify an individual (see accounts.js).
  async function logAudit(req, entry) {
    try {
      await store.appendAudit({
        ...entry,
        actorRole: accountRole(req) === ACCOUNT_OFFICER ? "officer" : "admin",
      });
    } catch (err) {
      console.error("Failed to write an audit entry:", err?.message || err);
    }
  }

  // The event fields every entry snapshots, so a log line still reads after the
  // event it refers to has been deleted.
  function eventStamp(event) {
    if (!event) return { eventId: null, eventName: "", eventDate: "" };
    return {
      eventId: event.id,
      eventName: event.customName || event.name || "",
      eventDate: event.date || "",
    };
  }

  // Everything that changed on ONE attendance row, as audit entries. Derived by
  // comparing the row before and after the write rather than from the request
  // body, so an edit that turned out to be a no-op logs nothing, and a single
  // PATCH that moves both times logs both facts.
  function attendanceDiff(before, after, event, method) {
    const out = [];
    const stamp = eventStamp(event);
    const base = {
      ...stamp,
      volunteerName: after?.volunteerName || before?.volunteerName || "",
      volunteerCode: after?.code || before?.code || null,
    };
    const pairs = [
      ["checkinAt", AUDIT_ACTIONS.CHECKIN, AUDIT_ACTIONS.CHECKIN_CLEARED, "checkin"],
      ["checkoutAt", AUDIT_ACTIONS.CHECKOUT, AUDIT_ACTIONS.CHECKOUT_CLEARED, "checkout"],
    ];
    for (const [field, setAction, clearAction, side] of pairs) {
      const from = before?.[field] ?? null;
      const to = after?.[field] ?? null;
      if (from === to) continue;
      if (to && !from) {
        out.push({ ...base, action: setAction, details: { side, method, to } });
      } else if (!to && from) {
        out.push({ ...base, action: clearAction, details: { side, from } });
      } else {
        // Both sides set and different — a correction, which is the one case
        // where the PREVIOUS value is the interesting half.
        out.push({
          ...base,
          action: AUDIT_ACTIONS.TIME_CORRECTED,
          details: { side, from, to },
        });
      }
    }
    const sFrom = before?.strikes ?? 0;
    const sTo = after?.strikes ?? 0;
    if (sFrom !== sTo) {
      out.push({
        ...base,
        action: AUDIT_ACTIONS.STRIKE_SET,
        details: { from: sFrom, to: sTo },
      });
    }
    return out;
  }

  function findAttendance(event, volunteerName) {
    return (event?.attendance || []).find((a) => a.volunteerName === volunteerName) || null;
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

  // Health + durability signal. Reports the active backend and whether it's a
  // persistent store, and actively probes the database so a "Postgres is
  // configured but unreachable" state returns 503 instead of a green light.
  // `persistent:false` (the in-memory store) is the tell-tale for a deploy that
  // would silently lose data — monitor this in production.
  router.get("/health", async (_req, res) => {
    const persistent = backend === "postgres";
    let dbOk = true;
    try {
      if (typeof store.ping === "function") await store.ping();
    } catch (err) {
      dbOk = false;
      console.error("Health probe: storage unreachable —", err?.message || err);
    }
    res
      .status(dbOk ? 200 : 503)
      .json({ ok: dbOk, backend, persistent, dbOk });
  });

  // ---------- Auth ----------

  router.post("/login", (req, res) => {
    if (!adminEnabled) return disabledResponse(res);
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
    // Which account do these credentials belong to? Both comparisons always
    // run so the response time doesn't reveal which half matched.
    const isAdmin =
      constantTimeEqual(username, adminUsername) &&
      constantTimeEqual(password, adminPassword);
    const isOfficer =
      constantTimeEqual(username, officerUsername) &&
      constantTimeEqual(password, officerPassword);
    if (!isAdmin && !isOfficer) {
      loginRecordFail(key);
      return res.status(401).json({ error: "Invalid username or password" });
    }
    loginRecordSuccess(key);
    res.json(
      isAdmin
        ? { token: ADMIN_TOKEN, role: ACCOUNT_ADMIN }
        : { token: OFFICER_TOKEN, role: ACCOUNT_OFFICER }
    );
  });

  router.get("/session", (req, res) => {
    const role = accountRole(req);
    // `admin` is kept for compatibility with anything still reading the old
    // shape; `role` is the field to branch on.
    res.json({
      admin: role === ACCOUNT_ADMIN,
      officer: role === ACCOUNT_OFFICER,
      role,
    });
  });

  // ---------- Public roster (names + grade only, no PII) ----------

  router.get("/roster", async (_req, res) => {
    try {
      const vols = await store.listVolunteers();
      // Names, grade and role only — role drives the Officer badge and carries
      // no personal information beyond what the roster already shows.
      res.json(
        vols.map((v) => ({
          name: v.name,
          grade: v.grade || "",
          role: normalizeRole(v.role),
        }))
      );
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
        role: normalizeRole(body.role),
        customFields: sanitizeCustomFields(body.customFields),
      });
      await logAudit(req, {
        action: AUDIT_ACTIONS.VOLUNTEER_CREATED,
        volunteerName: volunteer.name,
        volunteerCode: volunteer.code || null,
        details: { grade: volunteer.grade || "", role: volunteer.role },
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
    if (body.role !== undefined) {
      // Reject an unrecognized role loudly rather than silently demoting an
      // officer to the default — a typo must not quietly re-apply the hours cap.
      if (!VOLUNTEER_ROLES.includes(String(body.role))) {
        return res.status(400).json({
          error: `role must be one of: ${VOLUNTEER_ROLES.join(", ")}`,
        });
      }
      patch.role = normalizeRole(body.role);
    }
    if (body.active !== undefined) patch.active = Boolean(body.active);
    if (body.customFields !== undefined)
      patch.customFields = sanitizeCustomFields(body.customFields);

    try {
      const before = await store.getVolunteer(req.params.id);
      const volunteer = await store.updateVolunteer(req.params.id, patch);
      if (!volunteer)
        return res.status(404).json({ error: "Volunteer not found" });
      // Name the fields that actually MOVED. A rename and a role change are the
      // two that alter what the rest of the app computes (attendance is keyed
      // by name; role lifts the hours cap), so both carry their before/after.
      const changed = {};
      if (before) {
        if (before.name !== volunteer.name) {
          changed.nameFrom = before.name;
          changed.nameTo = volunteer.name;
        }
        if (before.role !== volunteer.role) {
          changed.roleFrom = before.role;
          changed.roleTo = volunteer.role;
        }
        if (before.grade !== volunteer.grade) {
          changed.gradeFrom = before.grade || "—";
          changed.gradeTo = volunteer.grade || "—";
        }
        for (const f of ["email", "phone"]) {
          // Contact details are PII; record THAT they changed, never the values.
          if (before[f] !== volunteer[f]) changed[f] = "changed";
        }
        if (JSON.stringify(before.customFields) !== JSON.stringify(volunteer.customFields)) {
          changed.customFields = "changed";
        }
      }
      if (Object.keys(changed).length > 0) {
        await logAudit(req, {
          action: AUDIT_ACTIONS.VOLUNTEER_UPDATED,
          volunteerName: volunteer.name,
          volunteerCode: volunteer.code || null,
          details: changed,
        });
      }
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
      // Read the record BEFORE deleting it — afterwards there is no name left
      // to write into the log, which is exactly when the log matters most.
      const before = await store.getVolunteer(req.params.id);
      const ok = await store.deleteVolunteer(req.params.id);
      if (!ok) return res.status(404).json({ error: "Volunteer not found" });
      await logAudit(req, {
        action: AUDIT_ACTIONS.VOLUNTEER_DELETED,
        volunteerName: before?.name || "",
        volunteerCode: before?.code || null,
        details: { grade: before?.grade || "", role: before?.role || "" },
      });
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
      // Three tiers: admins get everything (codes, ids, timestamps); officers
      // get the timestamps they need to run the door but no QR codes or ids;
      // anonymous callers get neither.
      if (isAdminRequest(req)) return res.json(events);
      const project = isOfficerRequest(req) ? officerEvent : publicEvent;
      res.json(events.map(project));
    } catch (err) {
      console.error("Failed to read events", err);
      res.status(500).json({ error: "Failed to read events" });
    }
  });

  router.post("/events", requireAdmin, async (req, res) => {
    const body = req.body || {};
    const { name, customName, date } = body;
    const errors = [];
    if (!name || typeof name !== "string") errors.push("name is required");
    if (!isValidDate(date)) errors.push("date must be YYYY-MM-DD");
    if (
      name === "Others - please specify" &&
      (!customName || typeof customName !== "string")
    ) {
      errors.push("customName is required when name is 'Others'");
    }
    const startTime = body.startTime === undefined ? "" : parseClockField(body.startTime);
    const endTime = body.endTime === undefined ? "" : parseClockField(body.endTime);
    const expectedHours =
      body.expectedHours === undefined ? null : parseExpectedHours(body.expectedHours);
    if (startTime === undefined) errors.push("startTime must be HH:MM");
    if (endTime === undefined) errors.push("endTime must be HH:MM");
    if (expectedHours === undefined)
      errors.push("expectedHours must be a number between 0 and 24");
    if (errors.length > 0) return res.status(400).json({ errors });

    try {
      const event = await store.createEvent({
        name: name.trim(),
        customName:
          name === "Others - please specify" ? String(customName).trim() : null,
        date,
        startTime,
        endTime,
        expectedHours,
      });
      res.status(201).json(event);
    } catch (err) {
      console.error("Failed to create event", err);
      res.status(500).json({ error: "Failed to create event" });
    }
  });

  // Edit an event. Only the keys PRESENT in the body change; the store
  // re-derives every submission for the event afterwards, because the name and
  // date are copied into them and expectedHours caps the credited hours.
  router.patch("/events/:id", requireAdmin, async (req, res) => {
    const body = req.body || {};
    const patch = {};
    const errors = [];

    if (body.name !== undefined) {
      const name = trimStr(body.name, 200);
      if (!name) errors.push("name cannot be empty");
      else patch.name = name;
    }
    if (body.customName !== undefined) {
      patch.customName = body.customName === null ? null : trimStr(body.customName, 200) || null;
    }
    if (body.date !== undefined) {
      if (!isValidDate(body.date)) errors.push("date must be YYYY-MM-DD");
      else patch.date = body.date;
    }
    if (body.startTime !== undefined) {
      const v = parseClockField(body.startTime);
      if (v === undefined) errors.push("startTime must be HH:MM");
      else patch.startTime = v;
    }
    if (body.endTime !== undefined) {
      const v = parseClockField(body.endTime);
      if (v === undefined) errors.push("endTime must be HH:MM");
      else patch.endTime = v;
    }
    if (body.expectedHours !== undefined) {
      const v = parseExpectedHours(body.expectedHours);
      if (v === undefined) errors.push("expectedHours must be a number between 0 and 24");
      else patch.expectedHours = v;
    }
    if (errors.length > 0) return res.status(400).json({ errors });
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "No editable fields were provided" });
    }

    try {
      const event = await store.updateEvent(req.params.id, patch);
      if (!event) return res.status(404).json({ error: "Event not found" });
      res.json(event);
    } catch (err) {
      console.error("Failed to update event", err);
      res.status(500).json({ error: "Failed to update event" });
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
      const before = await store.getEvent(req.params.id);
      const had = new Set((before?.attendance || []).map((a) => a.volunteerName));
      const event = await store.addAttendees(req.params.id, volunteerNames);
      if (!event) return res.status(404).json({ error: "Event not found" });
      // Only the names actually ADDED — re-adding someone already on the list
      // is a no-op and must not read as an action in the log.
      for (const a of event.attendance) {
        if (had.has(a.volunteerName)) continue;
        await logAudit(req, {
          ...eventStamp(event),
          action: AUDIT_ACTIONS.ATTENDEE_ADDED,
          volunteerName: a.volunteerName,
          volunteerCode: a.code || null,
        });
      }
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
    // Conduct strikes for this volunteer AT THIS EVENT. Rejected loudly when
    // malformed so a bad value can never silently clear a recorded strike.
    if (body.strikes !== undefined) {
      const v = parseStrikes(body.strikes);
      if (v === undefined) {
        return res
          .status(400)
          .json({ error: `strikes must be a whole number between 0 and ${MAX_STRIKES}` });
      }
      patch.strikes = v;
    }

    try {
      const before = findAttendance(await store.getEvent(req.params.id), volunteerName);
      const event = await store.patchAttendance(
        req.params.id,
        volunteerName,
        patch
      );
      if (!event) return res.status(404).json({ error: "Event not found" });
      // Derived from the before/after rows, not the request body: a PATCH that
      // set a time to the value it already had records nothing.
      for (const entry of attendanceDiff(
        before,
        findAttendance(event, volunteerName),
        event,
        AUDIT_METHODS.MANUAL
      )) {
        await logAudit(req, entry);
      }
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
      const before = findAttendance(await store.getEvent(req.params.id), volunteerName);
      const event = await store.removeAttendance(req.params.id, volunteerName);
      if (!event) return res.status(404).json({ error: "Event not found" });
      if (before) {
        await logAudit(req, {
          ...eventStamp(event),
          action: AUDIT_ACTIONS.ATTENDEE_REMOVED,
          volunteerName,
          volunteerCode: before.code || null,
          // Removal deletes the derived submission too, so say what was lost.
          details: {
            checkinAt: before.checkinAt ?? null,
            checkoutAt: before.checkoutAt ?? null,
            strikes: before.strikes ?? 0,
          },
        });
      }
      res.json(event);
    } catch (err) {
      console.error("Failed to remove attendee", err);
      res.status(500).json({ error: "Failed to remove attendee" });
    }
  });

  // Record (or clear) a conduct strike. This is the SECOND capability an
  // officer holds, alongside the scanner: the student leader running the door
  // is the person who actually witnesses the conduct, and making them track an
  // admin down afterwards is how a strike got lost.
  //
  // It is deliberately its OWN route rather than a relaxation of the admin
  // PATCH above. This handler can only ever write `strikes` — no times, no
  // flags, no removal — so an officer's reach cannot silently widen the day
  // someone adds a new field to the general attendance patch.
  router.patch("/events/:id/attendance/strikes", requireScanner, async (req, res) => {
    const body = req.body || {};
    const { volunteerName } = body;
    if (!volunteerName || typeof volunteerName !== "string") {
      return res.status(400).json({ error: "volunteerName is required" });
    }
    // Rejected loudly when malformed, exactly like the admin route: a bad value
    // must never silently clear a recorded strike.
    const strikes = parseStrikes(body.strikes);
    if (strikes === undefined) {
      return res
        .status(400)
        .json({ error: `strikes must be a whole number between 0 and ${MAX_STRIKES}` });
    }
    try {
      const before = findAttendance(await store.getEvent(req.params.id), volunteerName);
      const event = await store.patchAttendance(req.params.id, volunteerName, {
        strikes,
      });
      if (!event) {
        // The store answers null both for "no such event" and for "that person
        // isn't on this one" — say which. An officer staring at the event while
        // being told "Event not found" would think it had been deleted.
        const exists = await store.getEvent(req.params.id);
        return res.status(404).json({
          error: exists
            ? "That volunteer is not on this event's attendance list."
            : "Event not found",
        });
      }
      for (const entry of attendanceDiff(before, findAttendance(event, volunteerName), event)) {
        await logAudit(req, entry);
      }
      // Officers read the event back through their own projection, so recording
      // a strike can't hand back the QR codes GET /events withheld.
      res.json(isAdminRequest(req) ? event : officerEvent(event));
    } catch (err) {
      console.error("Failed to update strikes", err);
      res.status(500).json({ error: "Failed to update strikes" });
    }
  });

  // ---------- QR check-in / check-out (admin + officer scanner) ----------

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
      // Officers see the scan through their own projection, so a scan response
      // can't hand back the contact details or the whole event's QR codes that
      // GET /events deliberately withheld.
      const asAdmin = isAdminRequest(req);
      // A repeat scan changes nothing (the store answers alreadyDone and leaves
      // the original time alone), so it is not an action to record — logging it
      // would fill the log with duplicates that never moved a time.
      if (!result.alreadyDone) {
        await logAudit(req, {
          ...eventStamp(result.event),
          action: kind === "checkin" ? AUDIT_ACTIONS.CHECKIN : AUDIT_ACTIONS.CHECKOUT,
          volunteerName: result.attendance?.volunteerName || result.volunteer?.name || "",
          volunteerCode: result.volunteer?.code || null,
          details: {
            side: kind,
            method: AUDIT_METHODS.SCAN,
            to:
              kind === "checkin"
                ? result.attendance?.checkinAt ?? null
                : result.attendance?.checkoutAt ?? null,
          },
        });
      }
      res.json({
        ok: true,
        volunteer: asAdmin ? result.volunteer : officerVolunteer(result.volunteer),
        attendance: asAdmin ? result.attendance : officerAttendance(result.attendance),
        event: asAdmin ? result.event : officerEvent(result.event),
        alreadyDone: result.alreadyDone === true,
      });
    } catch (err) {
      console.error(`Failed to ${kind}`, err);
      res.status(500).json({ error: `Failed to ${kind}` });
    }
  }

  router.post("/events/:id/checkin", requireScanner, (req, res) =>
    handleScan(req, res, "checkin")
  );
  router.post("/events/:id/checkout", requireScanner, (req, res) =>
    handleScan(req, res, "checkout")
  );

  // ---------- Audit log (admin only) ----------
  //
  // Admin-only without exception. The log names volunteers alongside conduct
  // strikes and roster edits, so it is strictly more sensitive than any public
  // projection — there is no officer or anonymous view of it, and officers get
  // the usual 403 rather than a filtered copy.
  router.get("/audit", requireAdmin, async (req, res) => {
    const q = req.query || {};
    const volunteerName = trimStr(q.volunteer, 200) || undefined;
    const actorRole =
      q.actor === "admin" || q.actor === "officer" ? q.actor : undefined;
    const action = isAuditAction(q.action) ? String(q.action) : undefined;
    // `since` is an ISO instant; anything unparseable is ignored rather than
    // rejected, so a stale bookmark degrades to "everything" instead of a 400.
    const since = normalizeIsoOrNull(q.since) || undefined;
    const limitRaw = Number(q.limit);
    const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
    try {
      const entries = await store.listAudit({
        volunteerName,
        actorRole,
        action,
        since,
        limit,
      });
      res.json(entries);
    } catch (err) {
      console.error("Failed to read the audit log", err);
      res.status(500).json({ error: "Failed to read the audit log" });
    }
  });

  // ---------- Event order (the Events page section order) ----------
  //
  // The Events page groups events into one section per event NAME. Admins can
  // drag those sections into the order the chapter thinks about them, and that
  // order is stored server-side so it is the same for every device and every
  // person. Names with no stored position fall back to the automatic order
  // (soonest upcoming first) BELOW the ordered ones — a newly created event
  // type therefore appears without an admin having to re-save anything.

  router.get("/event-order", async (_req, res) => {
    try {
      res.json(await store.listEventOrder());
    } catch (err) {
      console.error("Failed to read the event order", err);
      res.status(500).json({ error: "Failed to read the event order" });
    }
  });

  router.put("/event-order", requireAdmin, async (req, res) => {
    const names = parseOrderNames((req.body || {}).names);
    if (names === undefined) {
      return res
        .status(400)
        .json({ error: "names must be an array of event names (max 500)" });
    }
    try {
      // Replaces the whole order, so names that no longer exist are pruned
      // rather than accumulating forever. An empty array = back to automatic.
      res.json(await store.setEventOrder(names));
    } catch (err) {
      console.error("Failed to save the event order", err);
      res.status(500).json({ error: "Failed to save the event order" });
    }
  });

  // ---------- Admin maintenance ----------

  router.post("/admin/reset", requireAdmin, async (req, res) => {
    // Reset permanently deletes ALL events, attendance, and derived hours (the
    // roster is kept). Require an explicit typed confirmation so it can't be
    // triggered by an accidental/replayed request. Callers should export a
    // backup (GET /admin/export) first.
    const confirm = (req.body && req.body.confirm) || "";
    if (confirm !== "RESET") {
      return res.status(400).json({
        error:
          'Reset requires explicit confirmation. Send {"confirm":"RESET"}. This permanently deletes all events, attendance, and derived service hours (the volunteer roster is preserved). Export a backup with GET /api/admin/export first.',
      });
    }
    try {
      // Snapshot the pre-wipe counts for the audit log (the HTTP path has no
      // filesystem to write a backup file to, unlike the CLI reset script).
      let before = null;
      try {
        const snap = await store.exportAll();
        before = {
          events: snap.events.length,
          submissions: snap.submissions.length,
        };
        console.warn(
          `ADMIN RESET: wiping ${before.events} events + ${before.submissions} submissions (roster kept).`
        );
      } catch {
        /* non-fatal: proceed with the reset even if the snapshot failed */
      }
      await store.reset();
      res.json({ ok: true, wiped: before });
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
