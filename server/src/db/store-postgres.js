// Postgres-backed implementation of the Store interface (see store-memory.js
// for the reference semantics — the two are kept in lock-step by a shared test
// suite). Uses @neondatabase/serverless, which speaks HTTP so it needs no
// persistent connection pool and works identically on EC2 (long-lived Node)
// and Netlify Functions (serverless). Multi-statement atomic writes use
// sql.transaction([...]) (a single non-interactive transaction over one
// request); all data needed for those statements is fetched first so no
// statement depends on another's runtime result.

import crypto from "crypto";
import { neon } from "@neondatabase/serverless";
import { SCHEMA_STATEMENTS, SEED_LOCK_KEY } from "./schema.js";
import { SEED_VOLUNTEERS } from "../data/seed-volunteers.js";

// ---------- row → API-shape mappers ----------

function toIso(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

function mapVolunteer(r) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    email: r.email || "",
    phone: r.phone || "",
    grade: r.grade || "",
    customFields:
      r.custom_fields && typeof r.custom_fields === "object"
        ? r.custom_fields
        : {},
    active: r.active !== false,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

function mapAttendance(r) {
  return {
    volunteerName: r.volunteer_name,
    volunteerId: r.volunteer_id || null,
    code: r.v_code || null,
    staffCheckin: !!r.staff_checkin,
    checkinAt: toIso(r.checkin_at),
    volunteerCheckout: !!r.volunteer_checkout,
    checkoutAt: toIso(r.checkout_at),
    selfAdded: !!r.self_added,
  };
}

function mapSubmission(r) {
  return {
    id: r.id,
    eventId: r.event_id || null,
    volunteerName: r.volunteer_name,
    grade: r.grade || "",
    eventName: r.event_name || "",
    customEventName: r.custom_event_name || null,
    eventDate: r.event_date || "",
    arrivalTime: r.arrival_time || "",
    endTime: r.end_time || "",
    hours: Number(r.hours) || 0,
    comments: r.comments || "",
    submittedAt: toIso(r.submitted_at),
  };
}

function assembleEvent(eventRow, attRows) {
  return {
    id: eventRow.id,
    name: eventRow.name,
    customName: eventRow.custom_name || null,
    date: eventRow.date,
    createdAt: toIso(eventRow.created_at),
    attendance: attRows.map(mapAttendance),
  };
}

function isUniqueViolation(e) {
  return (
    e &&
    (e.code === "23505" ||
      /duplicate key|unique constraint/i.test(String(e.message || "")))
  );
}

function isUuid(v) {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

export function createPostgresStore(connectionString) {
  const sql = neon(connectionString);

  // ---------- schema + one-time seed ----------

  let readyPromise = null;
  async function ensureReady() {
    if (!readyPromise) {
      readyPromise = (async () => {
        // Run DDL and the one-time seed inside a SINGLE advisory-locked
        // transaction. The lock serializes concurrent cold starts so they can't
        // race on CREATE TABLE / ADD COLUMN (Postgres' IF NOT EXISTS DDL is not
        // concurrency-safe on its own), and WHERE NOT EXISTS makes only the
        // first seeder insert.
        await sql.transaction([
          sql`SELECT pg_advisory_xact_lock(${SEED_LOCK_KEY})`,
          ...SCHEMA_STATEMENTS.map((s) => sql([s])),
          sql`INSERT INTO volunteers (code, name)
              SELECT 'TCYA-' || lpad(nextval('volunteer_code_seq')::text, 4, '0'), t.name
              FROM unnest(${SEED_VOLUNTEERS}::text[]) WITH ORDINALITY AS t(name, ord)
              WHERE NOT EXISTS (SELECT 1 FROM volunteers)
              ORDER BY t.ord`,
        ]);
      })().catch((err) => {
        readyPromise = null; // let the next call retry a transient failure
        throw err;
      });
    }
    return readyPromise;
  }

  // ---------- internal reads ----------

  async function eventRowById(id) {
    if (!isUuid(id)) return null;
    const rows = await sql`SELECT * FROM events WHERE id = ${id}`;
    return rows[0] || null;
  }

  async function attendanceForEvent(id) {
    return sql`
      SELECT a.*, v.code AS v_code
      FROM attendance a
      LEFT JOIN volunteers v ON v.id = a.volunteer_id
      WHERE a.event_id = ${id}
      ORDER BY a.seq ASC`;
  }

  // ---------- volunteers ----------

  async function listVolunteers() {
    await ensureReady();
    const rows = await sql`SELECT * FROM volunteers ORDER BY lower(name) ASC, code ASC`;
    return rows.map(mapVolunteer);
  }

  async function getVolunteer(id) {
    await ensureReady();
    if (!isUuid(id)) return null;
    const rows = await sql`SELECT * FROM volunteers WHERE id = ${id}`;
    return rows[0] ? mapVolunteer(rows[0]) : null;
  }

  async function getVolunteerByCode(code) {
    await ensureReady();
    const rows = await sql`SELECT * FROM volunteers WHERE code = ${code}`;
    return rows[0] ? mapVolunteer(rows[0]) : null;
  }

  async function getVolunteerByName(name) {
    await ensureReady();
    const rows = await sql`
      SELECT * FROM volunteers WHERE lower(name) = lower(${name})
      ORDER BY created_at ASC LIMIT 1`;
    return rows[0] ? mapVolunteer(rows[0]) : null;
  }

  async function createVolunteer({
    name,
    email = "",
    phone = "",
    grade = "",
    customFields = {},
  }) {
    await ensureReady();
    const rows = await sql`
      INSERT INTO volunteers (code, name, email, phone, grade, custom_fields)
      VALUES (
        'TCYA-' || lpad(nextval('volunteer_code_seq')::text, 4, '0'),
        ${name}, ${email}, ${phone}, ${grade}, ${JSON.stringify(customFields)}::jsonb
      )
      RETURNING *`;
    return mapVolunteer(rows[0]);
  }

  async function updateVolunteer(id, patch) {
    await ensureReady();
    if (!isUuid(id)) return null;
    const existingRows = await sql`SELECT * FROM volunteers WHERE id = ${id}`;
    if (!existingRows[0]) return null;
    const cur = existingRows[0];

    const next = {
      name: patch.name !== undefined ? patch.name : cur.name,
      email: patch.email !== undefined ? patch.email : cur.email,
      phone: patch.phone !== undefined ? patch.phone : cur.phone,
      grade: patch.grade !== undefined ? patch.grade : cur.grade,
      customFields:
        patch.customFields !== undefined ? patch.customFields : cur.custom_fields,
      active: patch.active !== undefined ? patch.active : cur.active,
    };
    const nameChanged = next.name !== cur.name;

    const statements = [
      sql`UPDATE volunteers
          SET name = ${next.name}, email = ${next.email}, phone = ${next.phone},
              grade = ${next.grade}, custom_fields = ${JSON.stringify(next.customFields)}::jsonb,
              active = ${next.active}, updated_at = now()
          WHERE id = ${id}
          RETURNING *`,
    ];
    if (nameChanged) {
      // Cascade the rename to keep history attached. Touch submissions BEFORE
      // attendance so the lock order matches upsertSubmission (submission then
      // attendance) — otherwise the two could deadlock.
      statements.push(
        sql`UPDATE submissions SET volunteer_name = ${next.name}
            WHERE volunteer_name = ${cur.name}`
      );
      statements.push(
        sql`UPDATE attendance SET volunteer_name = ${next.name}
            WHERE volunteer_id = ${id} OR volunteer_name = ${cur.name}`
      );
    }

    try {
      const results = await sql.transaction(statements);
      return mapVolunteer(results[0][0]);
    } catch (e) {
      if (isUniqueViolation(e)) {
        const err = new Error(
          "That name already appears on an event this volunteer attended; rename would collide."
        );
        err.code = "name_conflict";
        throw err;
      }
      throw e;
    }
  }

  async function deleteVolunteer(id) {
    await ensureReady();
    if (!isUuid(id)) return false;
    const rows = await sql`DELETE FROM volunteers WHERE id = ${id} RETURNING id`;
    return rows.length > 0;
  }

  // ---------- events ----------

  async function listEvents() {
    await ensureReady();
    const events = await sql`SELECT * FROM events ORDER BY date DESC, created_at DESC`;
    if (events.length === 0) return [];
    const att = await sql`
      SELECT a.*, v.code AS v_code
      FROM attendance a
      LEFT JOIN volunteers v ON v.id = a.volunteer_id
      ORDER BY a.seq ASC`;
    const byEvent = new Map();
    for (const a of att) {
      if (!byEvent.has(a.event_id)) byEvent.set(a.event_id, []);
      byEvent.get(a.event_id).push(a);
    }
    return events.map((e) => assembleEvent(e, byEvent.get(e.id) || []));
  }

  async function getEvent(id) {
    await ensureReady();
    const ev = await eventRowById(id);
    if (!ev) return null;
    const att = await attendanceForEvent(id);
    return assembleEvent(ev, att);
  }

  async function createEvent({ name, customName = null, date }) {
    await ensureReady();
    const rows = await sql`
      INSERT INTO events (name, custom_name, date)
      VALUES (${name}, ${customName}, ${date})
      RETURNING *`;
    return assembleEvent(rows[0], []);
  }

  async function deleteEvent(id) {
    await ensureReady();
    if (!isUuid(id)) return false;
    const rows = await sql`DELETE FROM events WHERE id = ${id} RETURNING id`;
    return rows.length > 0;
  }

  // ---------- attendance ----------

  async function addAttendees(eventId, names) {
    await ensureReady();
    if (!(await eventRowById(eventId))) return null;
    // Dedupe: a single INSERT ... ON CONFLICT can't touch the same conflict
    // target twice (SQLSTATE 21000), so duplicate names in one request must
    // collapse to one row (the flags set are constant, so nothing is lost).
    const clean = [...new Set(names.filter((n) => typeof n === "string" && n.trim()))];
    if (clean.length > 0) {
      await sql`
        INSERT INTO attendance (event_id, volunteer_id, volunteer_name, staff_checkin, volunteer_checkout, self_added)
        SELECT ${eventId},
               (SELECT id FROM volunteers WHERE name = n.name ORDER BY created_at LIMIT 1),
               n.name, true, false, false
        FROM unnest(${clean}::text[]) AS n(name)
        ON CONFLICT (event_id, volunteer_name) DO UPDATE
          SET staff_checkin = true,
              self_added = false,
              volunteer_id = COALESCE(attendance.volunteer_id, EXCLUDED.volunteer_id)`;
    }
    return getEvent(eventId);
  }

  async function checkInByCode(eventId, code) {
    await ensureReady();
    const vol = await getVolunteerByCode(code);
    if (!vol) return { ok: false, reason: "unknown_code" };
    if (!(await eventRowById(eventId))) return { ok: false, reason: "unknown_event" };
    const prior = await sql`
      SELECT staff_checkin FROM attendance WHERE event_id = ${eventId} AND volunteer_name = ${vol.name}`;
    const alreadyDone = prior[0]?.staff_checkin === true;
    const rows = await sql`
      INSERT INTO attendance (event_id, volunteer_id, volunteer_name, staff_checkin, checkin_at, volunteer_checkout, self_added)
      VALUES (${eventId}, ${vol.id}, ${vol.name}, true, now(), false, false)
      ON CONFLICT (event_id, volunteer_name) DO UPDATE
        SET staff_checkin = true,
            volunteer_id = EXCLUDED.volunteer_id,
            checkin_at = COALESCE(attendance.checkin_at, now()),
            self_added = false
      RETURNING *`;
    return {
      ok: true,
      volunteer: vol,
      // RETURNING * has no joined volunteer code; supply it from `vol` so the
      // response matches the memory store (which resolves the code).
      attendance: { ...mapAttendance(rows[0]), code: vol.code },
      event: await getEvent(eventId),
      alreadyDone,
    };
  }

  async function checkOutByCode(eventId, code) {
    await ensureReady();
    const vol = await getVolunteerByCode(code);
    if (!vol) return { ok: false, reason: "unknown_code" };
    if (!(await eventRowById(eventId))) return { ok: false, reason: "unknown_event" };
    const prior = await sql`
      SELECT volunteer_checkout FROM attendance WHERE event_id = ${eventId} AND volunteer_name = ${vol.name}`;
    const alreadyDone = prior[0]?.volunteer_checkout === true;
    const rows = await sql`
      INSERT INTO attendance (event_id, volunteer_id, volunteer_name, staff_checkin, volunteer_checkout, checkout_at, self_added)
      VALUES (${eventId}, ${vol.id}, ${vol.name}, false, true, now(), false)
      ON CONFLICT (event_id, volunteer_name) DO UPDATE
        SET volunteer_checkout = true,
            volunteer_id = EXCLUDED.volunteer_id,
            checkout_at = now()
      RETURNING *`;
    return {
      ok: true,
      volunteer: vol,
      attendance: { ...mapAttendance(rows[0]), code: vol.code },
      event: await getEvent(eventId),
      alreadyDone,
    };
  }

  async function patchAttendance(eventId, volunteerName, patch) {
    await ensureReady();
    if (!isUuid(eventId)) return null;

    // Compute overrides in JS so this is a SINGLE atomic UPDATE (no
    // read-modify-write that a concurrent scan could clobber). null override =>
    // keep the current column value via COALESCE. Providing a non-null
    // timestamp also marks that side checked ("setting a time marks it").
    let staffOverride = null;
    if (typeof patch.staffCheckin === "boolean") staffOverride = patch.staffCheckin;
    else if ("checkinAt" in patch && patch.checkinAt != null) staffOverride = true;

    let checkoutOverride = null;
    if (typeof patch.volunteerCheckout === "boolean")
      checkoutOverride = patch.volunteerCheckout;
    else if ("checkoutAt" in patch && patch.checkoutAt != null) checkoutOverride = true;

    const checkinProvided = "checkinAt" in patch;
    const checkinVal = checkinProvided ? patch.checkinAt ?? null : null;
    const checkoutProvided = "checkoutAt" in patch;
    const checkoutVal = checkoutProvided ? patch.checkoutAt ?? null : null;

    const rows = await sql`
      UPDATE attendance SET
        staff_checkin = COALESCE(${staffOverride}::boolean, staff_checkin),
        volunteer_checkout = COALESCE(${checkoutOverride}::boolean, volunteer_checkout),
        checkin_at = CASE
          WHEN ${checkinProvided}::boolean THEN ${checkinVal}::timestamptz
          WHEN COALESCE(${staffOverride}::boolean, staff_checkin) AND checkin_at IS NULL THEN now()
          ELSE checkin_at END,
        checkout_at = CASE
          WHEN ${checkoutProvided}::boolean THEN ${checkoutVal}::timestamptz
          WHEN COALESCE(${checkoutOverride}::boolean, volunteer_checkout) AND checkout_at IS NULL THEN now()
          ELSE checkout_at END
      WHERE event_id = ${eventId} AND volunteer_name = ${volunteerName}
      RETURNING id`;
    if (rows.length === 0) return null;
    return getEvent(eventId);
  }

  async function removeAttendance(eventId, volunteerName) {
    await ensureReady();
    if (!(await eventRowById(eventId))) return null;
    await sql`DELETE FROM attendance WHERE event_id = ${eventId} AND volunteer_name = ${volunteerName}`;
    return getEvent(eventId);
  }

  // ---------- submissions ----------

  async function listSubmissions() {
    await ensureReady();
    const rows = await sql`SELECT * FROM submissions ORDER BY submitted_at ASC`;
    return rows.map(mapSubmission);
  }

  async function upsertSubmission({
    eventId,
    volunteerName,
    grade,
    arrivalTime,
    endTime,
    hours,
    comments,
  }) {
    await ensureReady();
    const ev = await eventRowById(eventId);
    if (!ev) return null;
    const eventName = ev.custom_name ? ev.custom_name : ev.name;
    const customEventName = ev.custom_name || null;
    const eventDate = ev.date;

    // submission upsert BEFORE attendance upsert — see updateVolunteer for why
    // the lock order must be consistent across writers.
    const results = await sql.transaction([
      sql`
        INSERT INTO submissions
          (event_id, volunteer_name, grade, event_name, custom_event_name, event_date, arrival_time, end_time, hours, comments)
        VALUES
          (${eventId}, ${volunteerName}, ${grade}, ${eventName}, ${customEventName}, ${eventDate}, ${arrivalTime}, ${endTime}, ${hours}, ${comments})
        ON CONFLICT (event_id, volunteer_name) DO UPDATE
          SET grade = EXCLUDED.grade, event_name = EXCLUDED.event_name,
              custom_event_name = EXCLUDED.custom_event_name, event_date = EXCLUDED.event_date,
              arrival_time = EXCLUDED.arrival_time, end_time = EXCLUDED.end_time,
              hours = EXCLUDED.hours, comments = EXCLUDED.comments, submitted_at = now()
        RETURNING *`,
      sql`
        INSERT INTO attendance
          (event_id, volunteer_id, volunteer_name, staff_checkin, volunteer_checkout, checkout_at, self_added)
        VALUES
          (${eventId},
           (SELECT id FROM volunteers WHERE name = ${volunteerName} ORDER BY created_at LIMIT 1),
           ${volunteerName}, false, true, now(), true)
        ON CONFLICT (event_id, volunteer_name) DO UPDATE
          SET volunteer_checkout = true,
              checkout_at = COALESCE(attendance.checkout_at, now()),
              volunteer_id = COALESCE(attendance.volunteer_id, EXCLUDED.volunteer_id)`,
    ]);
    return { submission: mapSubmission(results[0][0]), event: await getEvent(eventId) };
  }

  // ---------- admin ----------

  async function reset() {
    await ensureReady();
    await sql.transaction([
      sql`DELETE FROM submissions`,
      sql`DELETE FROM attendance`,
      sql`DELETE FROM events`,
    ]);
  }

  async function exportAll() {
    await ensureReady();
    const [volunteers, events, submissions] = await Promise.all([
      listVolunteers(),
      listEvents(),
      listSubmissions(),
    ]);
    return { volunteers, events, submissions };
  }

  async function importAll(payload) {
    await ensureReady();
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const submissionsRaw = Array.isArray(payload?.submissions)
      ? payload.submissions
      : [];
    const volunteers = Array.isArray(payload?.volunteers)
      ? payload.volunteers
      : null;

    const byPair = new Map();
    const legacy = [];
    for (const s of submissionsRaw) {
      if (!s || typeof s !== "object") continue;
      if (!s.eventId) {
        legacy.push(s);
        continue;
      }
      const key = s.eventId + " " + s.volunteerName;
      const cur = byPair.get(key);
      if (!cur || String(s.submittedAt || "") > String(cur.submittedAt || "")) {
        byPair.set(key, s);
      }
    }
    const submissions = [...byPair.values(), ...legacy];

    const stmts = [
      sql`DELETE FROM submissions`,
      sql`DELETE FROM attendance`,
      sql`DELETE FROM events`,
    ];

    if (volunteers && volunteers.length > 0) {
      stmts.push(sql`DELETE FROM volunteers`);
      for (const v of volunteers) {
        stmts.push(sql`
          INSERT INTO volunteers (id, code, name, email, phone, grade, custom_fields, active, created_at, updated_at)
          VALUES (
            ${isUuid(v.id) ? v.id : crypto.randomUUID()},
            ${v.code}, ${v.name}, ${v.email || ""}, ${v.phone || ""}, ${v.grade || ""},
            ${JSON.stringify(v.customFields || {})}::jsonb, ${v.active !== false},
            ${v.createdAt || new Date().toISOString()}, ${v.updatedAt || new Date().toISOString()}
          )
          ON CONFLICT (code) DO NOTHING`);
      }
      // Advance the sequence so the next auto-code is (max imported numeric
      // code)+1 — computed in JS to match the memory store exactly.
      const maxNum = volunteers.reduce((m, v) => {
        const n = parseInt(String(v.code).replace(/[^0-9]/g, ""), 10);
        return Number.isFinite(n) ? Math.max(m, n) : m;
      }, 0);
      stmts.push(
        sql`SELECT setval('volunteer_code_seq', ${Math.max(maxNum, 1)}, ${maxNum >= 1})`
      );
    }

    for (const e of events) {
      if (!e || typeof e !== "object") continue;
      const eid = isUuid(e.id) ? e.id : crypto.randomUUID();
      stmts.push(sql`
        INSERT INTO events (id, name, custom_name, date, created_at)
        VALUES (${eid}, ${e.name || ""}, ${e.customName ?? null}, ${e.date || ""}, ${e.createdAt || new Date().toISOString()})
        ON CONFLICT (id) DO NOTHING`);
      for (const a of Array.isArray(e.attendance) ? e.attendance : []) {
        if (!a || typeof a.volunteerName !== "string") continue;
        stmts.push(sql`
          INSERT INTO attendance
            (event_id, volunteer_id, volunteer_name, staff_checkin, checkin_at, volunteer_checkout, checkout_at, self_added)
          VALUES (
            ${eid},
            (SELECT id FROM volunteers WHERE name = ${a.volunteerName} ORDER BY created_at LIMIT 1),
            ${a.volunteerName}, ${!!a.staffCheckin}, ${a.checkinAt ?? null},
            ${!!a.volunteerCheckout}, ${a.checkoutAt ?? null}, ${!!a.selfAdded}
          )
          ON CONFLICT (event_id, volunteer_name) DO NOTHING`);
      }
    }

    for (const s of submissions) {
      const sid = isUuid(s.id) ? s.id : crypto.randomUUID();
      stmts.push(sql`
        INSERT INTO submissions
          (id, event_id, volunteer_name, grade, event_name, custom_event_name, event_date, arrival_time, end_time, hours, comments, submitted_at)
        VALUES (
          ${sid}, ${s.eventId || null}, ${s.volunteerName || ""}, ${s.grade || ""},
          ${s.eventName || ""}, ${s.customEventName ?? null}, ${s.eventDate || null},
          ${s.arrivalTime || ""}, ${s.endTime || ""}, ${Number(s.hours) || 0},
          ${s.comments || ""}, ${s.submittedAt || new Date().toISOString()}
        )
        ON CONFLICT (event_id, volunteer_name) DO NOTHING`);
    }

    await sql.transaction(stmts);
    return exportAll();
  }

  return {
    kind: "postgres",
    ensureReady,
    listVolunteers,
    getVolunteer,
    getVolunteerByCode,
    getVolunteerByName,
    createVolunteer,
    updateVolunteer,
    deleteVolunteer,
    listEvents,
    getEvent,
    createEvent,
    deleteEvent,
    addAttendees,
    checkInByCode,
    checkOutByCode,
    patchAttendance,
    removeAttendance,
    listSubmissions,
    upsertSubmission,
    reset,
    exportAll,
    importAll,
  };
}
