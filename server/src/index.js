import express from "express";
import cors from "cors";
import fs from "fs/promises";
import fssync from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4000;
const DATA_DIR = path.resolve(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "submissions.json");
const CLIENT_DIST = path.resolve(__dirname, "..", "..", "client", "dist");

// Admin credentials. The default works out of the box for testing — set
// ADMIN_PASSWORD (and ideally SESSION_SECRET) in the environment for production.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "tcya-admin-2026";
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto
    .createHash("sha256")
    .update("ela-tcya-default-secret-" + ADMIN_PASSWORD)
    .digest("hex");
const ADMIN_TOKEN = crypto
  .createHmac("sha256", SESSION_SECRET)
  .update(ADMIN_PASSWORD)
  .digest("hex");

if (!fssync.existsSync(DATA_DIR)) {
  fssync.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fssync.existsSync(DATA_FILE)) {
  fssync.writeFileSync(
    DATA_FILE,
    JSON.stringify({ submissions: [], events: [] }, null, 2),
    "utf-8"
  );
}

let writeQueue = Promise.resolve();

async function readData() {
  const raw = await fs.readFile(DATA_FILE, "utf-8");
  try {
    const parsed = JSON.parse(raw);
    return {
      submissions: Array.isArray(parsed?.submissions) ? parsed.submissions : [],
      events: Array.isArray(parsed?.events) ? parsed.events : [],
    };
  } catch {
    return { submissions: [], events: [] };
  }
}

function writeData(updater) {
  writeQueue = writeQueue.then(async () => {
    const current = await readData();
    const next = await updater(current);
    const tmp = DATA_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf-8");
    await fs.rename(tmp, DATA_FILE);
    return next;
  });
  return writeQueue;
}

function computeHours(arrivalTime, endTime) {
  const [aH, aM] = arrivalTime.split(":").map(Number);
  const [eH, eM] = endTime.split(":").map(Number);
  const minutes = eH * 60 + eM - (aH * 60 + aM);
  if (Number.isNaN(minutes) || minutes <= 0) return 0;
  return Math.round((minutes / 60) * 100) / 100;
}

function isValidTime(t) {
  return typeof t === "string" && /^\d{2}:\d{2}$/.test(t);
}
function isValidDate(d) {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function isAdminRequest(req) {
  const token = (req.headers["x-admin-token"] || "").toString();
  return constantTimeEqual(token, ADMIN_TOKEN);
}

function requireAdmin(req, res, next) {
  if (isAdminRequest(req)) return next();
  res.status(401).json({ error: "Admin authentication required" });
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "200kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// Auth: returns the admin token on correct password.
app.post("/api/login", (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== "string" || password.length === 0) {
    return res.status(400).json({ error: "Password is required" });
  }
  if (!constantTimeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "Invalid password" });
  }
  res.json({ token: ADMIN_TOKEN });
});

// Lets the client verify a stored token without exposing it (used on page load).
app.get("/api/session", (req, res) => {
  res.json({ admin: isAdminRequest(req) });
});

// ---------- Submissions ----------

app.get("/api/submissions", async (_req, res) => {
  try {
    const data = await readData();
    res.json(data.submissions);
  } catch (err) {
    console.error("Failed to read submissions", err);
    res.status(500).json({ error: "Failed to read submissions" });
  }
});

app.post("/api/submissions", async (req, res) => {
  const body = req.body || {};
  const { volunteerName, grade, eventId, arrivalTime, endTime, comments } =
    body;

  const errors = [];
  if (!volunteerName || typeof volunteerName !== "string") {
    errors.push("volunteerName is required");
  }
  if (!grade || typeof grade !== "string") errors.push("grade is required");
  if (!eventId || typeof eventId !== "string") errors.push("eventId is required");
  if (!isValidTime(arrivalTime)) errors.push("arrivalTime must be HH:MM");
  if (!isValidTime(endTime)) errors.push("endTime must be HH:MM");

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

  const submission = {
    id: crypto.randomUUID(),
    eventId,
    volunteerName: volunteerName.trim(),
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
    await writeData(async (current) => {
      // Update the event's attendance: if the volunteer was already on the
      // staff list, mark them as checked out by the volunteer. Otherwise
      // append them at the end with staffCheckin=false, volunteerCheckout=true
      // so the admin can spot self-added entries.
      const updatedEvents = current.events.map((e) => {
        if (e.id !== eventId) return e;
        const attendance = Array.isArray(e.attendance) ? [...e.attendance] : [];
        const idx = attendance.findIndex(
          (a) => a.volunteerName === submission.volunteerName
        );
        if (idx >= 0) {
          attendance[idx] = { ...attendance[idx], volunteerCheckout: true };
        } else {
          attendance.push({
            volunteerName: submission.volunteerName,
            staffCheckin: false,
            volunteerCheckout: true,
            selfAdded: true,
          });
        }
        return { ...e, attendance };
      });
      return {
        ...current,
        submissions: [...current.submissions, submission],
        events: updatedEvents,
      };
    });
    res.status(201).json({ submission });
  } catch (err) {
    console.error("Failed to save submission", err);
    res.status(500).json({ error: "Failed to save submission" });
  }
});

// ---------- Events ----------

app.get("/api/events", async (_req, res) => {
  try {
    const data = await readData();
    res.json(data.events);
  } catch (err) {
    console.error("Failed to read events", err);
    res.status(500).json({ error: "Failed to read events" });
  }
});

app.post("/api/events", requireAdmin, async (req, res) => {
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

app.delete("/api/events/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  await writeData(async (current) => ({
    ...current,
    events: current.events.filter((e) => e.id !== id),
  }));
  res.json({ ok: true });
});

// Admin adds one or more volunteers to the event's attendance list.
app.post("/api/events/:id/attendance", requireAdmin, async (req, res) => {
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
          // If already in the list, force staffCheckin=true (admin re-affirms)
          // and clear the "selfAdded" tag.
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

  if (!updatedEvent) return res.status(404).json({ error: "Event not found" });
  res.json(updatedEvent);
});

// Toggle staffCheckin / volunteerCheckout for a single attendee.
app.patch("/api/events/:id/attendance", requireAdmin, async (req, res) => {
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

  if (!updatedEvent) return res.status(404).json({ error: "Event not found" });
  res.json(updatedEvent);
});

// Remove an attendee from the event's attendance list.
app.delete("/api/events/:id/attendance", requireAdmin, async (req, res) => {
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

  if (!updatedEvent) return res.status(404).json({ error: "Event not found" });
  res.json(updatedEvent);
});

// ---------- Static client ----------

if (fssync.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Volunteer tracker API listening on port ${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
  console.log(
    `Admin login enabled. ${
      process.env.ADMIN_PASSWORD
        ? "(ADMIN_PASSWORD is set via environment)"
        : "(default password in use — set ADMIN_PASSWORD env var to change)"
    }`
  );
});
