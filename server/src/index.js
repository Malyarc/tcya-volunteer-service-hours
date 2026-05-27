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
// In production, the Express server also serves the built React client.
const CLIENT_DIST = path.resolve(__dirname, "..", "..", "client", "dist");

// Ensure the data directory and file exist on startup. Storing the data on
// disk as a single JSON object keeps things simple for a single EC2 instance.
if (!fssync.existsSync(DATA_DIR)) {
  fssync.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fssync.existsSync(DATA_FILE)) {
  fssync.writeFileSync(
    DATA_FILE,
    JSON.stringify({ submissions: [] }, null, 2),
    "utf-8"
  );
}

// Serialize writes so concurrent submissions can't clobber each other.
let writeQueue = Promise.resolve();

async function readData() {
  const raw = await fs.readFile(DATA_FILE, "utf-8");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.submissions)) {
      return { submissions: [] };
    }
    return parsed;
  } catch {
    return { submissions: [] };
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
  // Times come in as HH:MM strings. We compute the elapsed hours assuming
  // the volunteer arrived and left on the same day.
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

const app = express();
app.use(cors());
app.use(express.json({ limit: "200kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

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
  const {
    volunteerName,
    grade,
    eventName,
    customEventName,
    eventDate,
    arrivalTime,
    endTime,
    comments,
  } = body;

  const errors = [];
  if (!volunteerName || typeof volunteerName !== "string") {
    errors.push("volunteerName is required");
  }
  if (!grade || typeof grade !== "string") {
    errors.push("grade is required");
  }
  if (!eventName || typeof eventName !== "string") {
    errors.push("eventName is required");
  }
  if (eventName === "Others - please specify") {
    if (!customEventName || typeof customEventName !== "string") {
      errors.push("customEventName is required when eventName is 'Others'");
    }
  }
  if (!isValidDate(eventDate)) errors.push("eventDate must be YYYY-MM-DD");
  if (!isValidTime(arrivalTime)) errors.push("arrivalTime must be HH:MM");
  if (!isValidTime(endTime)) errors.push("endTime must be HH:MM");

  const hours = computeHours(arrivalTime || "", endTime || "");
  if (hours <= 0) errors.push("endTime must be after arrivalTime");

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  const submission = {
    id: crypto.randomUUID(),
    volunteerName: volunteerName.trim(),
    grade: grade.trim(),
    eventName: eventName.trim(),
    customEventName:
      eventName === "Others - please specify"
        ? String(customEventName).trim()
        : null,
    eventDate,
    arrivalTime,
    endTime,
    hours,
    comments: typeof comments === "string" ? comments.trim() : "",
    submittedAt: new Date().toISOString(),
  };

  try {
    const next = await writeData(async (current) => ({
      ...current,
      submissions: [...current.submissions, submission],
    }));
    res.status(201).json({ submission, total: next.submissions.length });
  } catch (err) {
    console.error("Failed to save submission", err);
    res.status(500).json({ error: "Failed to save submission" });
  }
});

// Serve the built React app (after `npm run build` in /client). Any non-API
// route falls back to index.html so client-side routing works.
if (fssync.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Volunteer tracker API listening on port ${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
