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
import { SCHEMA_STATEMENTS, SEED_LOCK_KEY, normalizeStrikes } from "./schema.js";
import { normalizeAuditEntry } from "../audit.js";
import { SEED_VOLUNTEERS } from "../data/seed-volunteers.js";
import { deriveSubmissionFields, normalizeExpectedHours } from "../hours.js";
import { ROLE_OFFICER, normalizeRole } from "../roles.js";
import {
  ARCHIVE_REASON_RETIRED,
  MIGRATION_PROMOTE_OFFICERS,
  MIGRATION_PURGE_RETIRED,
  MIGRATION_PURGE_TEST_AUDIT,
  ARCHIVE_REASON_TEST_AUDIT,
  TEST_AUDIT_EVENT_PREFIX,
  OFFICER_NAMES,
  RETIRED_MEMBER_NAMES,
} from "./data-migrations.js";

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
    role: normalizeRole(r.role),
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
    // Resolved from the linked volunteer record, else the name lookup — the
    // memory store's `vol || pickVolunteerByName(...)` in SQL form.
    role: normalizeRole(r.v_role),
    staffCheckin: !!r.staff_checkin,
    checkinAt: toIso(r.checkin_at),
    volunteerCheckout: !!r.volunteer_checkout,
    checkoutAt: toIso(r.checkout_at),
    selfAdded: !!r.self_added,
    strikes: normalizeStrikes(r.strikes),
  };
}

function mapSubmission(r) {
  const hours = Number(r.hours) || 0;
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
    hours,
    // Rows written before raw_hours existed have no uncapped figure to report;
    // they were never capped, so the credited value IS the raw value.
    rawHours: r.raw_hours == null ? hours : Number(r.raw_hours) || 0,
    comments: r.comments || "",
    submittedAt: toIso(r.submitted_at),
  };
}

function mapAudit(r) {
  return {
    id: r.id,
    at: toIso(r.at),
    actorRole: r.actor_role,
    action: r.action,
    volunteerName: r.volunteer_name || "",
    volunteerCode: r.volunteer_code || null,
    eventId: r.event_id || null,
    eventName: r.event_name || "",
    eventDate: r.event_date || "",
    details:
      r.details && typeof r.details === "object" && !Array.isArray(r.details)
        ? r.details
        : {},
  };
}

function assembleEvent(eventRow, attRows) {
  return {
    id: eventRow.id,
    name: eventRow.name,
    customName: eventRow.custom_name || null,
    date: eventRow.date,
    startTime: eventRow.start_time || "",
    endTime: eventRow.end_time || "",
    expectedHours: normalizeExpectedHours(eventRow.expected_hours),
    createdAt: toIso(eventRow.created_at),
    attendance: attRows.map(mapAttendance),
  };
}

// The stored-event shape `deriveSubmissionFields` expects, from a raw row.
function eventForDerivation(r) {
  return {
    name: r.ev_name,
    customName: r.custom_name || null,
    date: r.ev_date,
    expectedHours: normalizeExpectedHours(r.expected_hours),
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
          ...dataMigrationStatements(),
        ]);
      })().catch((err) => {
        readyPromise = null; // let the next call retry a transient failure
        throw err;
      });
    }
    return readyPromise;
  }

  // ---------- one-time data migrations (see data-migrations.js) ----------

  // Returned as statements so they run inside the SAME advisory-locked
  // transaction as the schema + seed: concurrent cold starts can't double-apply
  // them, and a failure rolls the whole boot back rather than half-migrating.
  //
  // `sql.transaction([...])` is non-interactive (no reading a result mid-flight)
  // so every statement carries its OWN "has this migration run?" guard in the
  // WHERE clause instead of being wrapped in an if.
  function dataMigrationStatements() {
    // NB: the guard is written out longhand in every statement below rather
    // than factored into a helper — the Neon HTTP tag does NOT compose nested
    // `sql` fragments (an interpolated query object would be bound as a plain
    // parameter), which would silently disarm the guard.
    return [
      // 1. Promote the chapter's student leaders. Names absent from the roster
      //    are simply not matched, so this is a no-op on a foreign database.
      sql`UPDATE volunteers SET role = ${ROLE_OFFICER}, updated_at = now()
          WHERE name = ANY(${OFFICER_NAMES}::text[])
            AND role IS DISTINCT FROM ${ROLE_OFFICER}
            AND NOT EXISTS (
              SELECT 1 FROM app_migrations m WHERE m.name = ${MIGRATION_PROMOTE_OFFICERS})`,
      sql`INSERT INTO app_migrations (name) VALUES (${MIGRATION_PROMOTE_OFFICERS})
          ON CONFLICT (name) DO NOTHING`,

      // 2. Archive-then-purge the leftover records of former members. Both the
      //    archive and the deletes use the identical predicate — name is on the
      //    list AND no volunteer record carries that name — so a person who is
      //    ever re-added to the roster is untouchable here.
      sql`INSERT INTO archived_records (reason, payload)
          SELECT ${ARCHIVE_REASON_RETIRED}, jsonb_build_object(
            'attendance', (
              SELECT coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) FROM attendance a
              WHERE a.volunteer_name = ANY(${RETIRED_MEMBER_NAMES}::text[])
                AND NOT EXISTS (SELECT 1 FROM volunteers v WHERE v.name = a.volunteer_name)),
            'submissions', (
              SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) FROM submissions s
              WHERE s.volunteer_name = ANY(${RETIRED_MEMBER_NAMES}::text[])
                AND NOT EXISTS (SELECT 1 FROM volunteers v WHERE v.name = s.volunteer_name)))
          WHERE NOT EXISTS (
              SELECT 1 FROM app_migrations m WHERE m.name = ${MIGRATION_PURGE_RETIRED})
            AND (
              EXISTS (SELECT 1 FROM attendance a
                      WHERE a.volunteer_name = ANY(${RETIRED_MEMBER_NAMES}::text[])
                        AND NOT EXISTS (SELECT 1 FROM volunteers v WHERE v.name = a.volunteer_name))
              OR EXISTS (SELECT 1 FROM submissions s
                      WHERE s.volunteer_name = ANY(${RETIRED_MEMBER_NAMES}::text[])
                        AND NOT EXISTS (SELECT 1 FROM volunteers v WHERE v.name = s.volunteer_name)))`,
      sql`DELETE FROM submissions s
          WHERE s.volunteer_name = ANY(${RETIRED_MEMBER_NAMES}::text[])
            AND NOT EXISTS (SELECT 1 FROM volunteers v WHERE v.name = s.volunteer_name)
            AND NOT EXISTS (
              SELECT 1 FROM app_migrations m WHERE m.name = ${MIGRATION_PURGE_RETIRED})`,
      sql`DELETE FROM attendance a
          WHERE a.volunteer_name = ANY(${RETIRED_MEMBER_NAMES}::text[])
            AND NOT EXISTS (SELECT 1 FROM volunteers v WHERE v.name = a.volunteer_name)
            AND NOT EXISTS (
              SELECT 1 FROM app_migrations m WHERE m.name = ${MIGRATION_PURGE_RETIRED})`,
      sql`INSERT INTO app_migrations (name) VALUES (${MIGRATION_PURGE_RETIRED})
          ON CONFLICT (name) DO NOTHING`,

      // 3. Archive-then-purge the audit entries left by verifying the audit
      //    feature against production. Same archive-first discipline; matched
      //    on the scratch events' name prefix so nothing real is touched.
      sql`INSERT INTO archived_records (reason, payload)
          SELECT ${ARCHIVE_REASON_TEST_AUDIT}, jsonb_build_object(
            'audit', (SELECT coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) FROM audit_log a
                      WHERE a.event_name LIKE ${TEST_AUDIT_EVENT_PREFIX + "%"}))
          WHERE NOT EXISTS (
              SELECT 1 FROM app_migrations m WHERE m.name = ${MIGRATION_PURGE_TEST_AUDIT})
            AND EXISTS (SELECT 1 FROM audit_log a
                        WHERE a.event_name LIKE ${TEST_AUDIT_EVENT_PREFIX + "%"})`,
      sql`DELETE FROM audit_log a
          WHERE a.event_name LIKE ${TEST_AUDIT_EVENT_PREFIX + "%"}
            AND NOT EXISTS (
              SELECT 1 FROM app_migrations m WHERE m.name = ${MIGRATION_PURGE_TEST_AUDIT})`,
      sql`INSERT INTO app_migrations (name) VALUES (${MIGRATION_PURGE_TEST_AUDIT})
          ON CONFLICT (name) DO NOTHING`,
    ];
  }

  // ---------- internal reads ----------

  async function eventRowById(id) {
    if (!isUuid(id)) return null;
    const rows = await sql`SELECT * FROM events WHERE id = ${id}`;
    return rows[0] || null;
  }

  async function attendanceForEvent(id) {
    return sql`
      SELECT a.*, v.code AS v_code, COALESCE(v.role, vn.role) AS v_role
      FROM attendance a
      LEFT JOIN volunteers v ON v.id = a.volunteer_id
      LEFT JOIN LATERAL (
        SELECT role FROM volunteers vv
        WHERE vv.name = a.volunteer_name
        ORDER BY vv.created_at ASC, vv.code ASC LIMIT 1
      ) vn ON true
      WHERE a.event_id = ${id}
      ORDER BY a.seq ASC`;
  }

  // Everything needed to re-derive submissions — for ONE attendance row, for a
  // whole event, or for one person across every event. Deliberately a single
  // query with optional (nullable) filters rather than three near-identical
  // ones, so a single-row reconcile and a bulk re-reconcile can never resolve
  // the grade / role / cap differently. Pass null to skip a filter.
  async function reconcileRows(eventId, volunteerName) {
    const eid = eventId == null ? null : eventId;
    const vname = volunteerName == null ? null : volunteerName;
    return sql`
      SELECT a.event_id, a.volunteer_name, a.checkin_at, a.checkout_at,
             e.name AS ev_name, e.custom_name, e.date AS ev_date, e.expected_hours,
             v.grade AS v_grade, v.role AS v_role
      FROM attendance a
      JOIN events e ON e.id = a.event_id
      LEFT JOIN LATERAL (
        SELECT grade, role FROM volunteers vv
        WHERE vv.name = a.volunteer_name
        ORDER BY vv.created_at ASC, vv.code ASC LIMIT 1
      ) v ON true
      WHERE (${eid}::uuid IS NULL OR a.event_id = ${eid}::uuid)
        AND (${vname}::text IS NULL OR a.volunteer_name = ${vname}::text)`;
  }

  // Build the (upsert | delete) plan for a set of reconcile rows.
  function planReconcile(rows) {
    const upserts = [];
    const completeNames = [];
    for (const r of rows) {
      const fields = deriveSubmissionFields({
        checkinAt: toIso(r.checkin_at),
        checkoutAt: toIso(r.checkout_at),
        event: eventForDerivation(r),
        volunteer: { grade: r.v_grade, role: r.v_role },
      });
      if (!fields) continue;
      completeNames.push(r.volunteer_name);
      upserts.push(
        sql`
        INSERT INTO submissions
          (event_id, volunteer_name, grade, event_name, custom_event_name, event_date,
           arrival_time, end_time, hours, raw_hours, comments)
        VALUES
          (${r.event_id}, ${r.volunteer_name}, ${fields.grade}, ${fields.eventName},
           ${fields.customEventName}, ${fields.eventDate}, ${fields.arrivalTime},
           ${fields.endTime}, ${fields.hours}, ${fields.rawHours}, '')
        ON CONFLICT (event_id, volunteer_name) DO UPDATE
          SET grade = EXCLUDED.grade, event_name = EXCLUDED.event_name,
              custom_event_name = EXCLUDED.custom_event_name, event_date = EXCLUDED.event_date,
              arrival_time = EXCLUDED.arrival_time, end_time = EXCLUDED.end_time,
              hours = EXCLUDED.hours, raw_hours = EXCLUDED.raw_hours, submitted_at = now()`
      );
    }
    return { upserts, completeNames };
  }

  // Keep the volunteer's submission for this event in sync with their check-in /
  // out times: a submission (= counted service hours) exists exactly when the
  // attendance row is complete (both times set, checkout after check-in). This
  // is how "hours" flow from the QR scan / manual times, with no stale rows.
  async function reconcileSubmission(eventId, volunteerName) {
    if (!isUuid(eventId)) return;
    const { upserts } = planReconcile(await reconcileRows(eventId, volunteerName));
    if (upserts.length === 0) {
      await sql`DELETE FROM submissions WHERE event_id = ${eventId} AND volunteer_name = ${volunteerName}`;
      return;
    }
    await sql.transaction(upserts);
  }

  // Re-derive EVERY submission of one event. Needed whenever a property the
  // submissions copy from the event changes — its name, date, or (crucially)
  // its Expected Volunteer Hours, which caps non-officers' credit.
  async function reconcileEvent(eventId) {
    if (!isUuid(eventId)) return;
    const { upserts, completeNames } = planReconcile(
      await reconcileRows(eventId, null)
    );
    // One statement removes both the now-incomplete rows AND any submission
    // whose attendance row vanished entirely.
    await sql.transaction([
      sql`DELETE FROM submissions
          WHERE event_id = ${eventId}
            AND NOT (volunteer_name = ANY(${completeNames}::text[]))`,
      ...upserts,
    ]);
  }

  // Re-derive every event this person has hours for. Needed when their ROLE
  // changes (officer ⇄ volunteer switches the cap off/on) or their grade
  // changes (submissions carry a copy of it).
  async function reconcileVolunteerName(volunteerName) {
    const { upserts } = planReconcile(await reconcileRows(null, volunteerName));
    if (upserts.length > 0) await sql.transaction(upserts);
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
    role = undefined,
    customFields = {},
  }) {
    await ensureReady();
    const rows = await sql`
      INSERT INTO volunteers (code, name, email, phone, grade, role, custom_fields)
      VALUES (
        'TCYA-' || lpad(nextval('volunteer_code_seq')::text, 4, '0'),
        ${name}, ${email}, ${phone}, ${grade}, ${normalizeRole(role)},
        ${JSON.stringify(customFields)}::jsonb
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
      role:
        patch.role !== undefined ? normalizeRole(patch.role) : normalizeRole(cur.role),
      customFields:
        patch.customFields !== undefined ? patch.customFields : cur.custom_fields,
      active: patch.active !== undefined ? patch.active : cur.active,
    };
    const nameChanged = next.name !== cur.name;
    const derivationChanged =
      next.role !== normalizeRole(cur.role) || next.grade !== cur.grade;

    const statements = [
      sql`UPDATE volunteers
          SET name = ${next.name}, email = ${next.email}, phone = ${next.phone},
              grade = ${next.grade}, role = ${next.role},
              custom_fields = ${JSON.stringify(next.customFields)}::jsonb,
              active = ${next.active}, updated_at = now()
          WHERE id = ${id}
          RETURNING *`,
    ];
    if (nameChanged) {
      // Cascade the rename to keep history attached. Touch submissions BEFORE
      // attendance for a consistent lock order across writers (avoids deadlock).
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
      // Promoting to officer lifts the per-event cap (and demoting re-applies
      // it), and submissions carry a copy of the grade — so either change has to
      // re-derive this person's EXISTING hours, not just future ones.
      if (derivationChanged) await reconcileVolunteerName(next.name);
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
      SELECT a.*, v.code AS v_code, COALESCE(v.role, vn.role) AS v_role
      FROM attendance a
      LEFT JOIN volunteers v ON v.id = a.volunteer_id
      LEFT JOIN LATERAL (
        SELECT role FROM volunteers vv
        WHERE vv.name = a.volunteer_name
        ORDER BY vv.created_at ASC, vv.code ASC LIMIT 1
      ) vn ON true
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

  async function createEvent({
    name,
    customName = null,
    date,
    startTime = "",
    endTime = "",
    expectedHours = null,
  }) {
    await ensureReady();
    const rows = await sql`
      INSERT INTO events (name, custom_name, date, start_time, end_time, expected_hours)
      VALUES (${name}, ${customName}, ${date}, ${startTime || ""}, ${endTime || ""},
              ${normalizeExpectedHours(expectedHours)})
      RETURNING *`;
    return assembleEvent(rows[0], []);
  }

  // Edit an event in place. Every field here is either copied into the derived
  // submissions (name/date) or governs them (expectedHours ⇒ the cap), so the
  // whole event is re-derived afterwards — an admin lowering the expected hours
  // must immediately correct everyone's already-credited hours.
  async function updateEvent(id, patch) {
    await ensureReady();
    if (!isUuid(id)) return null;
    const cur = await eventRowById(id);
    if (!cur) return null;
    const next = {
      name: patch.name !== undefined ? patch.name : cur.name,
      customName:
        patch.customName !== undefined ? patch.customName || null : cur.custom_name,
      date: patch.date !== undefined ? patch.date : cur.date,
      startTime:
        patch.startTime !== undefined ? patch.startTime || "" : cur.start_time || "",
      endTime: patch.endTime !== undefined ? patch.endTime || "" : cur.end_time || "",
      expectedHours:
        patch.expectedHours !== undefined
          ? normalizeExpectedHours(patch.expectedHours)
          : normalizeExpectedHours(cur.expected_hours),
    };
    const rows = await sql`
      UPDATE events
      SET name = ${next.name}, custom_name = ${next.customName}, date = ${next.date},
          start_time = ${next.startTime}, end_time = ${next.endTime},
          expected_hours = ${next.expectedHours}
      WHERE id = ${id}
      RETURNING *`;
    if (rows.length === 0) return null;
    await reconcileEvent(id);
    return getEvent(id);
  }

  async function deleteEvent(id) {
    await ensureReady();
    if (!isUuid(id)) return false;
    // Delete the event's submissions too (attendance cascades via FK). Without
    // this, a deleted event leaves orphaned "pending" rows in the roster.
    const results = await sql.transaction([
      sql`DELETE FROM submissions WHERE event_id = ${id}`,
      sql`DELETE FROM events WHERE id = ${id} RETURNING id`,
    ]);
    return results[1].length > 0;
  }

  // ---------- attendance ----------

  async function addAttendees(eventId, names) {
    await ensureReady();
    if (!(await eventRowById(eventId))) return null;
    // Pre-registering only puts volunteers on the list — it does NOT check them
    // in (staff_checkin stays false / in sync with checkin_at). Dedupe because a
    // single INSERT ... ON CONFLICT can't touch the same conflict target twice.
    const clean = [...new Set(names.filter((n) => typeof n === "string" && n.trim()))];
    if (clean.length > 0) {
      await sql`
        INSERT INTO attendance (event_id, volunteer_id, volunteer_name, staff_checkin, volunteer_checkout, self_added)
        SELECT ${eventId},
               (SELECT id FROM volunteers WHERE name = n.name ORDER BY created_at LIMIT 1),
               n.name, false, false, false
        FROM unnest(${clean}::text[]) AS n(name)
        ON CONFLICT (event_id, volunteer_name) DO UPDATE
          SET self_added = false,
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
    await reconcileSubmission(eventId, vol.name);
    return {
      ok: true,
      volunteer: vol,
      // RETURNING * has no joined volunteer code/role; supply them from `vol`
      // so the response matches the memory store (which resolves both).
      attendance: { ...mapAttendance(rows[0]), code: vol.code, role: vol.role },
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
    await reconcileSubmission(eventId, vol.name);
    return {
      ok: true,
      volunteer: vol,
      // RETURNING * has no joined volunteer code/role; supply them from `vol`
      // so the response matches the memory store (which resolves both).
      attendance: { ...mapAttendance(rows[0]), code: vol.code, role: vol.role },
      event: await getEvent(eventId),
      alreadyDone,
    };
  }

  async function patchAttendance(eventId, volunteerName, patch) {
    await ensureReady();
    if (!isUuid(eventId)) return null;

    // Keep the boolean flag and its timestamp in lock-step (single atomic
    // UPDATE, no read-modify-write): an explicit checkinAt sets the time and the
    // flag = (time != null); toggling the flag on stamps the time (now if none),
    // toggling off CLEARS the time. Symmetric for check-out. This guarantees the
    // derived hours (from timestamps) never disagree with the "confirmed" flags.
    const checkinProvided = "checkinAt" in patch;
    const checkinVal = checkinProvided ? patch.checkinAt ?? null : null;
    const staffProvided = typeof patch.staffCheckin === "boolean";
    const staffVal = staffProvided ? patch.staffCheckin : null;

    const checkoutProvided = "checkoutAt" in patch;
    const checkoutVal = checkoutProvided ? patch.checkoutAt ?? null : null;
    const coProvided = typeof patch.volunteerCheckout === "boolean";
    const coVal = coProvided ? patch.volunteerCheckout : null;

    // Conduct strikes are independent of the times and never touch hours.
    const strikesProvided = patch.strikes !== undefined;
    const strikesVal = strikesProvided ? normalizeStrikes(patch.strikes) : null;

    const rows = await sql`
      UPDATE attendance SET
        strikes = CASE
          WHEN ${strikesProvided}::boolean THEN ${strikesVal}::integer
          ELSE strikes END,
        staff_checkin = CASE
          WHEN ${checkinProvided}::boolean THEN (${checkinVal}::timestamptz IS NOT NULL)
          WHEN ${staffProvided}::boolean THEN ${staffVal}::boolean
          ELSE staff_checkin END,
        checkin_at = CASE
          WHEN ${checkinProvided}::boolean THEN ${checkinVal}::timestamptz
          WHEN ${staffProvided}::boolean AND ${staffVal}::boolean THEN COALESCE(checkin_at, now())
          WHEN ${staffProvided}::boolean THEN NULL
          ELSE checkin_at END,
        volunteer_checkout = CASE
          WHEN ${checkoutProvided}::boolean THEN (${checkoutVal}::timestamptz IS NOT NULL)
          WHEN ${coProvided}::boolean THEN ${coVal}::boolean
          ELSE volunteer_checkout END,
        checkout_at = CASE
          WHEN ${checkoutProvided}::boolean THEN ${checkoutVal}::timestamptz
          WHEN ${coProvided}::boolean AND ${coVal}::boolean THEN COALESCE(checkout_at, now())
          WHEN ${coProvided}::boolean THEN NULL
          ELSE checkout_at END
      WHERE event_id = ${eventId} AND volunteer_name = ${volunteerName}
      RETURNING id`;
    if (rows.length === 0) return null;
    await reconcileSubmission(eventId, volunteerName);
    return getEvent(eventId);
  }

  async function removeAttendance(eventId, volunteerName) {
    await ensureReady();
    if (!(await eventRowById(eventId))) return null;
    await sql`DELETE FROM attendance WHERE event_id = ${eventId} AND volunteer_name = ${volunteerName}`;
    // Removing a volunteer from an event removes their derived hours too.
    await reconcileSubmission(eventId, volunteerName);
    return getEvent(eventId);
  }

  // ---------- submissions ----------

  async function listSubmissions() {
    await ensureReady();
    const rows = await sql`SELECT * FROM submissions ORDER BY submitted_at ASC`;
    return rows.map(mapSubmission);
  }

  // ---------- event order (the Events page section order) ----------

  // Read back sorted by position, then by name so a hand-edited table with
  // duplicate positions still yields one deterministic order. The returned
  // positions are re-indexed 0..n-1 to match the memory store exactly.
  async function listEventOrder() {
    await ensureReady();
    const rows = await sql`SELECT name, position FROM event_order ORDER BY position ASC, name ASC`;
    return rows.map((r, i) => ({ name: r.name, position: i }));
  }

  async function setEventOrder(names) {
    await ensureReady();
    const seen = new Set();
    const clean = [];
    for (const raw of Array.isArray(names) ? names : []) {
      const name = typeof raw === "string" ? raw.trim() : "";
      if (!name || seen.has(name)) continue;
      seen.add(name);
      clean.push(name);
    }
    // One transaction: the page must never observe a half-applied order.
    // Replacing wholesale also prunes names that no longer exist.
    const stmts = [sql`DELETE FROM event_order`];
    clean.forEach((name, i) => {
      stmts.push(sql`INSERT INTO event_order (name, position) VALUES (${name}, ${i})`);
    });
    await sql.transaction(stmts);
    return clean.map((name, position) => ({ name, position }));
  }

  // ---------- admin ----------

  // ---------- audit log (append-only; see audit.js) ----------

  async function appendAudit(entry) {
    await ensureReady();
    const r = normalizeAuditEntry(entry);
    await sql`
      INSERT INTO audit_log
        (at, actor_role, action, volunteer_name, volunteer_code, event_id, event_name, event_date, details)
      VALUES
        (${r.at}::timestamptz, ${r.actorRole}, ${r.action}, ${r.volunteerName},
         ${r.volunteerCode}, ${r.eventId}::uuid, ${r.eventName}, ${r.eventDate},
         ${JSON.stringify(r.details)}::jsonb)`;
    return r;
  }

  async function listAudit({ volunteerName, action, actorRole, since, limit } = {}) {
    await ensureReady();
    const cap = Number.isFinite(Number(limit))
      ? Math.max(1, Math.min(1000, Number(limit)))
      : 200;
    // Every filter is optional and applied in ONE statement: passing null for
    // an unused filter keeps the query plan (and the parity with the memory
    // store's predicate chain) identical whichever combination is used.
    const rows = await sql`
      SELECT * FROM audit_log
       WHERE (${volunteerName ?? null}::text IS NULL OR volunteer_name = ${volunteerName ?? null})
         AND (${action ?? null}::text IS NULL OR action = ${action ?? null})
         AND (${actorRole ?? null}::text IS NULL OR actor_role = ${actorRole ?? null})
         AND (${since ?? null}::timestamptz IS NULL OR at >= ${since ?? null}::timestamptz)
       ORDER BY at DESC, ctid DESC
       LIMIT ${cap}`;
    return rows.map(mapAudit);
  }

  async function reset() {
    await ensureReady();
    await sql.transaction([
      sql`DELETE FROM submissions`,
      sql`DELETE FROM attendance`,
      sql`DELETE FROM events`,
      // No events ⇒ no groups to order (mirrors the memory store).
      sql`DELETE FROM event_order`,
      // NOT audit_log: a reset is itself an action worth having a record of,
      // and a log that a reset erases is no record at all. Mirrored in the
      // memory store.
    ]);
  }

  // Cheap liveness probe for /health — proves the DB is actually reachable.
  async function ping() {
    await sql`SELECT 1`;
    return true;
  }

  async function exportAll() {
    await ensureReady();
    const [volunteers, events, submissions, eventOrder] = await Promise.all([
      listVolunteers(),
      listEvents(),
      listSubmissions(),
      listEventOrder(),
    ]);
    return {
      volunteers,
      events,
      submissions,
      eventOrder: eventOrder.map((r) => r.name),
    };
  }

  async function importAll(payload) {
    await ensureReady();
    // Only the categories PRESENT in the payload are wiped + replaced. A partial
    // import (e.g. a volunteers-only restore) must NOT delete event history —
    // that footgun previously turned a partial restore into a full wipe.
    const hasEvents = Array.isArray(payload?.events);
    const hasSubs = Array.isArray(payload?.submissions);
    const events = hasEvents ? payload.events : [];
    const submissionsRaw = hasSubs ? payload.submissions : [];
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

    const stmts = [];
    // Deleting events cascades to attendance (FK ON DELETE CASCADE); the
    // explicit attendance delete is belt-and-suspenders.
    if (hasSubs) stmts.push(sql`DELETE FROM submissions`);
    if (hasEvents) {
      stmts.push(sql`DELETE FROM attendance`);
      stmts.push(sql`DELETE FROM events`);
    }

    if (volunteers && volunteers.length > 0) {
      stmts.push(sql`DELETE FROM volunteers`);
      for (const v of volunteers) {
        stmts.push(sql`
          INSERT INTO volunteers (id, code, name, email, phone, grade, role, custom_fields, active, created_at, updated_at)
          VALUES (
            ${isUuid(v.id) ? v.id : crypto.randomUUID()},
            ${v.code}, ${v.name}, ${v.email || ""}, ${v.phone || ""}, ${v.grade || ""},
            ${normalizeRole(v.role)},
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

    // Skip a duplicate event id entirely — including its attendance — so a
    // second event sharing an id can't smuggle new attendance rows onto the
    // first. (The memory store `continue`s the whole event; mirror it here so
    // ON CONFLICT on attendance doesn't diverge from memory's behavior.)
    const seenEventIds = new Set();
    for (const e of events) {
      if (!e || typeof e !== "object") continue;
      const eid = isUuid(e.id) ? e.id : crypto.randomUUID();
      if (seenEventIds.has(eid)) continue;
      seenEventIds.add(eid);
      stmts.push(sql`
        INSERT INTO events (id, name, custom_name, date, start_time, end_time, expected_hours, created_at)
        VALUES (${eid}, ${e.name || ""}, ${e.customName ?? null}, ${e.date || ""},
                ${e.startTime || ""}, ${e.endTime || ""}, ${normalizeExpectedHours(e.expectedHours)},
                ${e.createdAt || new Date().toISOString()})
        ON CONFLICT (id) DO NOTHING`);
      for (const a of Array.isArray(e.attendance) ? e.attendance : []) {
        if (!a || typeof a.volunteerName !== "string") continue;
        stmts.push(sql`
          INSERT INTO attendance
            (event_id, volunteer_id, volunteer_name, staff_checkin, checkin_at, volunteer_checkout, checkout_at, self_added, strikes)
          VALUES (
            ${eid},
            (SELECT id FROM volunteers WHERE name = ${a.volunteerName} ORDER BY created_at LIMIT 1),
            ${a.volunteerName}, ${!!a.staffCheckin}, ${a.checkinAt ?? null},
            ${!!a.volunteerCheckout}, ${a.checkoutAt ?? null}, ${!!a.selfAdded},
            ${normalizeStrikes(a.strikes)}
          )
          ON CONFLICT (event_id, volunteer_name) DO NOTHING`);
      }
    }

    for (const s of submissions) {
      const sid = isUuid(s.id) ? s.id : crypto.randomUUID();
      stmts.push(sql`
        INSERT INTO submissions
          (id, event_id, volunteer_name, grade, event_name, custom_event_name, event_date, arrival_time, end_time, hours, raw_hours, comments, submitted_at)
        VALUES (
          ${sid}, ${s.eventId || null}, ${s.volunteerName || ""}, ${s.grade || ""},
          ${s.eventName || ""}, ${s.customEventName ?? null}, ${s.eventDate || null},
          ${s.arrivalTime || ""}, ${s.endTime || ""}, ${Number(s.hours) || 0},
          ${s.rawHours == null ? Number(s.hours) || 0 : Number(s.rawHours) || 0},
          ${s.comments || ""}, ${s.submittedAt || new Date().toISOString()}
        )
        ON CONFLICT (event_id, volunteer_name) DO NOTHING`);
    }

    // If the roster was re-imported, re-link any surviving attendance rows to it
    // by name. `DELETE FROM volunteers` above nulled attendance.volunteer_id via
    // the ON DELETE SET NULL FK; a partial import that KEPT attendance (events
    // not in the payload) must restore the link so the QR code still resolves —
    // matching the memory store, which keeps the link through preserved ids.
    if (volunteers && volunteers.length > 0) {
      stmts.push(sql`
        UPDATE attendance a
        SET volunteer_id = (
          SELECT v.id FROM volunteers v
          WHERE v.name = a.volunteer_name
          ORDER BY v.created_at ASC, v.code ASC
          LIMIT 1
        )`);
    }

    // Only replace the Events page order when the payload carries one (the same
    // by-category rule as everything above), and inside the SAME transaction so
    // a failed import can't leave a new order behind.
    if (Array.isArray(payload?.eventOrder)) {
      const seen = new Set();
      stmts.push(sql`DELETE FROM event_order`);
      let i = 0;
      for (const raw of payload.eventOrder) {
        const name = typeof raw === "string" ? raw.trim() : "";
        if (!name || seen.has(name)) continue;
        seen.add(name);
        stmts.push(sql`INSERT INTO event_order (name, position) VALUES (${name}, ${i})`);
        i += 1;
      }
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
    updateEvent,
    deleteEvent,
    addAttendees,
    checkInByCode,
    checkOutByCode,
    patchAttendance,
    removeAttendance,
    listSubmissions,
    listEventOrder,
    setEventOrder,
    appendAudit,
    listAudit,
    reset,
    ping,
    exportAll,
    importAll,
  };
}
