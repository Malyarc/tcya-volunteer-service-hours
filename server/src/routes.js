// Shared Express router. The same routes serve both the EC2 deployment
// (`server/src/index.js` with file-backed storage) and the Netlify Functions
// deployment (`netlify/functions/api/api.mjs` with Netlify Blobs storage).
//
// Storage is injected so this module has no I/O concerns of its own.

import express from "express";
import crypto from "crypto";

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function computeHours(arrivalTime, endTime) {
  const [aH, aM] = arrivalTime.split(":").map(Number);
  const [eH, eM] = endTime.split(":").map(Number);
  const minutes = eH * 60 + eM - (aH * 60 + aM);
  if (Number.isNaN(minutes) || minutes <= 0) return 0;
  return Math.round((minutes / 60) * 100) / 100;
}

function isValidTime(t) {
  if (typeof t !== "string" || !/^\d{2}:\d{2}$/.test(t)) return false;
  const hours = parseInt(t.slice(0, 2), 10);
  const minutes = parseInt(t.slice(3, 5), 10);
  // Must be a real wall-clock time (00:00–23:59), on a 15-minute boundary
  // (:00, :15, :30, :45). Without the range check the regex alone accepts
  // impossible values like "99:45", letting a raw API call claim absurd
  // hours (e.g. 00:00 → 99:45 computed to 99.75 hours). The <input type=time>
  // on the client already constrains this; the server must too.
  if (hours > 23 || minutes > 59) return false;
  return minutes % 15 === 0;
}
function isValidDate(d) {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

export function createRouter({
  readData,
  writeData,
  adminUsername,
  adminPassword,
  sessionSecret,
}) {
  const ADMIN_TOKEN = crypto
    .createHmac("sha256", sessionSecret)
    .update(adminUsername + ":" + adminPassword)
    .digest("hex");

  function isAdminRequest(req) {
    const token = (req.headers["x-admin-token"] || "").toString();
    return constantTimeEqual(token, ADMIN_TOKEN);
  }

  function requireAdmin(req, res, next) {
    if (isAdminRequest(req)) return next();
    res.status(401).json({ error: "Admin authentication required" });
  }

  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // ---------- Auth ----------

  router.post("/login", (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== "string" || username.length === 0) {
      return res.status(400).json({ error: "Username is required" });
    }
    if (typeof password !== "string" || password.length === 0) {
      return res.status(400).json({ error: "Password is required" });
    }
    const userOk = constantTimeEqual(username, adminUsername);
    const passOk = constantTimeEqual(password, adminPassword);
    // Always evaluate both checks so the response time doesn't leak which
    // field was wrong.
    if (!userOk || !passOk) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    res.json({ token: ADMIN_TOKEN });
  });

  router.get("/session", (req, res) => {
    res.json({ admin: isAdminRequest(req) });
  });

  // ---------- Submissions ----------

  router.get("/submissions", async (_req, res) => {
    try {
      const data = await readData();
      res.json(data.submissions);
    } catch (err) {
      console.error("Failed to read submissions", err);
      res.status(500).json({ error: "Failed to read submissions" });
    }
  });

  router.post("/submissions", async (req, res) => {
    const body = req.body || {};
    const { volunteerName, grade, eventId, arrivalTime, endTime, comments } =
      body;

    const errors = [];
    if (!volunteerName || typeof volunteerName !== "string") {
      errors.push("volunteerName is required");
    }
    if (!grade || typeof grade !== "string") errors.push("grade is required");
    if (!eventId || typeof eventId !== "string")
      errors.push("eventId is required");
    if (!isValidTime(arrivalTime))
      errors.push("arrivalTime must be HH:MM on a 15-minute boundary");
    if (!isValidTime(endTime))
      errors.push("endTime must be HH:MM on a 15-minute boundary");

    const hours = computeHours(arrivalTime || "", endTime || "");
    if (hours <= 0) errors.push("endTime must be after arrivalTime");

    if (errors.length > 0) return res.status(400).json({ errors });

    const data = await readData();
    const event = data.events.find((e) => e.id === eventId);
    if (!event) {
      return res
        .status(400)
        .json({ errors: ["Selected event no longer exists"] });
    }

    const volunteerNameClean = volunteerName.trim();
    const baseSubmission = {
      eventId,
      volunteerName: volunteerNameClean,
      grade: grade.trim(),
      eventName: event.customName ? event.customName : event.name,
      customEventName: event.customName || null,
      eventDate: event.date,
      arrivalTime,
      endTime,
      hours,
      comments: typeof comments === "string" ? comments.trim() : "",
      submittedAt: new Date().toISOString(),
    };

    try {
      let savedSubmission;
      await writeData(async (current) => {
        // Upsert: keep exactly one submission per (event, volunteer). The
        // attendance list already holds a single row per volunteer per event,
        // so a second submission for the same event must not create a second
        // countable record — that double-counted the volunteer's hours.
        // Re-submitting instead corrects the existing entry (fixed times,
        // comments, or grade). Collapsing *all* prior matches (not just the
        // first) also self-heals any duplicates that pre-date this rule.
        const samePair = (s) =>
          s.eventId === eventId && s.volunteerName === volunteerNameClean;
        const prior = current.submissions.filter(samePair);
        savedSubmission = {
          ...baseSubmission,
          // Preserve the earliest existing id so identity stays stable on edit.
          id: prior[0]?.id ?? crypto.randomUUID(),
        };
        const submissions = [
          ...current.submissions.filter((s) => !samePair(s)),
          savedSubmission,
        ];

        const updatedEvents = current.events.map((e) => {
          if (e.id !== eventId) return e;
          const attendance = Array.isArray(e.attendance)
            ? [...e.attendance]
            : [];
          const idx = attendance.findIndex(
            (a) => a.volunteerName === volunteerNameClean
          );
          if (idx >= 0) {
            attendance[idx] = { ...attendance[idx], volunteerCheckout: true };
          } else {
            attendance.push({
              volunteerName: volunteerNameClean,
              staffCheckin: false,
              volunteerCheckout: true,
              selfAdded: true,
            });
          }
          return { ...e, attendance };
        });
        return { ...current, submissions, events: updatedEvents };
      });
      res.status(201).json({ submission: savedSubmission });
    } catch (err) {
      console.error("Failed to save submission", err);
      res.status(500).json({ error: "Failed to save submission" });
    }
  });

  // ---------- Events ----------

  router.get("/events", async (_req, res) => {
    try {
      const data = await readData();
      res.json(data.events);
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

    const newEvent = {
      id: crypto.randomUUID(),
      name: name.trim(),
      customName:
        name === "Others - please specify" ? String(customName).trim() : null,
      date,
      createdAt: new Date().toISOString(),
      attendance: [],
    };

    await writeData(async (current) => ({
      ...current,
      events: [...current.events, newEvent],
    }));

    res.status(201).json(newEvent);
  });

  router.delete("/events/:id", requireAdmin, async (req, res) => {
    const { id } = req.params;
    await writeData(async (current) => ({
      ...current,
      events: current.events.filter((e) => e.id !== id),
    }));
    res.json({ ok: true });
  });

  router.post("/events/:id/attendance", requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { volunteerNames } = req.body || {};
    if (!Array.isArray(volunteerNames)) {
      return res.status(400).json({ error: "volunteerNames must be an array" });
    }

    let updatedEvent = null;
    await writeData(async (current) => {
      const events = current.events.map((e) => {
        if (e.id !== id) return e;
        const map = new Map();
        for (const a of e.attendance || []) map.set(a.volunteerName, a);
        for (const name of volunteerNames) {
          if (typeof name !== "string") continue;
          const existing = map.get(name);
          if (existing) {
            map.set(name, {
              ...existing,
              staffCheckin: true,
              selfAdded: false,
            });
          } else {
            map.set(name, {
              volunteerName: name,
              staffCheckin: true,
              volunteerCheckout: false,
              selfAdded: false,
            });
          }
        }
        const updated = { ...e, attendance: Array.from(map.values()) };
        updatedEvent = updated;
        return updated;
      });
      return { ...current, events };
    });

    if (!updatedEvent)
      return res.status(404).json({ error: "Event not found" });
    res.json(updatedEvent);
  });

  router.patch("/events/:id/attendance", requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { volunteerName, staffCheckin, volunteerCheckout } = req.body || {};
    if (!volunteerName || typeof volunteerName !== "string") {
      return res.status(400).json({ error: "volunteerName is required" });
    }

    let updatedEvent = null;
    await writeData(async (current) => {
      const events = current.events.map((e) => {
        if (e.id !== id) return e;
        const attendance = (e.attendance || []).map((a) => {
          if (a.volunteerName !== volunteerName) return a;
          return {
            ...a,
            staffCheckin:
              typeof staffCheckin === "boolean" ? staffCheckin : a.staffCheckin,
            volunteerCheckout:
              typeof volunteerCheckout === "boolean"
                ? volunteerCheckout
                : a.volunteerCheckout,
          };
        });
        const updated = { ...e, attendance };
        updatedEvent = updated;
        return updated;
      });
      return { ...current, events };
    });

    if (!updatedEvent)
      return res.status(404).json({ error: "Event not found" });
    res.json(updatedEvent);
  });

  router.delete("/events/:id/attendance", requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { volunteerName } = req.body || {};
    if (!volunteerName || typeof volunteerName !== "string") {
      return res.status(400).json({ error: "volunteerName is required" });
    }

    let updatedEvent = null;
    await writeData(async (current) => {
      const events = current.events.map((e) => {
        if (e.id !== id) return e;
        const updated = {
          ...e,
          attendance: (e.attendance || []).filter(
            (a) => a.volunteerName !== volunteerName
          ),
        };
        updatedEvent = updated;
        return updated;
      });
      return { ...current, events };
    });

    if (!updatedEvent)
      return res.status(404).json({ error: "Event not found" });
    res.json(updatedEvent);
  });

  // ---------- Admin maintenance ----------

  // Wipes all data and starts fresh. Useful when reset can't be done from the
  // shell (e.g. on a serverless deploy).
  router.post("/admin/reset", requireAdmin, async (_req, res) => {
    await writeData(async () => ({ submissions: [], events: [] }));
    res.json({ ok: true });
  });

  // Returns the full data file as a downloadable JSON, useful for backups
  // when the data isn't on a server you can scp from.
  router.get("/admin/export", requireAdmin, async (_req, res) => {
    const data = await readData();
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ela-tcya-backup-${stamp}.json"`
    );
    res.send(JSON.stringify(data, null, 2));
  });

  return router;
}

export function deriveSessionSecret(adminUsername, adminPassword) {
  return crypto
    .createHash("sha256")
    .update("ela-tcya-default-secret-" + adminUsername + ":" + adminPassword)
    .digest("hex");
}
