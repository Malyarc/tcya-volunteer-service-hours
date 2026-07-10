// In-memory implementation of the Store interface. It is the reference for the
// store semantics (the Postgres store mirrors it) and is used by the test
// suite and as the local-dev fallback when no DATABASE_URL is configured.
//
// Data is held in plain arrays; events assemble their attendance on read. A
// monotonic insertion counter gives attendance a stable display order that
// matches the Postgres store's `ORDER BY created_at ASC`.

import crypto from "crypto";
import { formatVolunteerCode } from "./schema.js";
import { SEED_VOLUNTEERS } from "../data/seed-volunteers.js";
import { hoursBetween, localHHMM, isComplete } from "../hours.js";

const nowIso = () => new Date().toISOString();

export function createMemoryStore(seed) {
  let volunteers = [];
  let events = [];
  let attendance = [];
  let submissions = [];
  let codeSeq = 0;
  let insertSeq = 0;

  function assignCode() {
    codeSeq += 1;
    return formatVolunteerCode(codeSeq);
  }

  // Seed the roster once (skipped when an explicit seed is supplied, e.g. tests
  // that want an empty or custom starting state).
  if (seed === undefined) {
    for (const name of SEED_VOLUNTEERS) {
      volunteers.push(makeVolunteer({ name }));
    }
  } else if (seed) {
    volunteers = (seed.volunteers || []).map((v) => ({ ...v }));
    events = (seed.events || []).map((e) => ({ ...e }));
    submissions = (seed.submissions || []).map((s) => ({ ...s }));
    // A seed may express attendance inline on events (old shape) — flatten it.
    for (const e of events) {
      for (const a of e.attendance || []) {
        attendance.push({
          id: crypto.randomUUID(),
          _seq: (insertSeq += 1),
          eventId: e.id,
          volunteerId: a.volunteerId || matchVolunteerId(a.volunteerName),
          volunteerName: a.volunteerName,
          staffCheckin: !!a.staffCheckin,
          checkinAt: a.checkinAt ?? null,
          volunteerCheckout: !!a.volunteerCheckout,
          checkoutAt: a.checkoutAt ?? null,
          selfAdded: !!a.selfAdded,
        });
      }
      delete e.attendance;
    }
    codeSeq = volunteers.length;
  }

  function makeVolunteer({
    name,
    email = "",
    phone = "",
    grade = "",
    customFields = {},
  }) {
    const ts = nowIso();
    return {
      id: crypto.randomUUID(),
      code: assignCode(),
      name,
      email,
      phone,
      grade,
      customFields: { ...customFields },
      active: true,
      createdAt: ts,
      updatedAt: ts,
    };
  }

  function matchVolunteerId(name) {
    const v = volunteers.find((x) => x.name === name);
    return v ? v.id : null;
  }

  function cloneVolunteer(v) {
    return { ...v, customFields: { ...v.customFields } };
  }

  function attRowToApi(a) {
    const vol = a.volunteerId
      ? volunteers.find((v) => v.id === a.volunteerId)
      : null;
    return {
      volunteerName: a.volunteerName,
      volunteerId: a.volunteerId || null,
      code: vol ? vol.code : null,
      staffCheckin: !!a.staffCheckin,
      checkinAt: a.checkinAt ?? null,
      volunteerCheckout: !!a.volunteerCheckout,
      checkoutAt: a.checkoutAt ?? null,
      selfAdded: !!a.selfAdded,
    };
  }

  function assembleEvent(e) {
    const rows = attendance
      .filter((a) => a.eventId === e.id)
      .sort((a, b) => a._seq - b._seq)
      .map(attRowToApi);
    return {
      id: e.id,
      name: e.name,
      customName: e.customName || null,
      date: e.date,
      createdAt: e.createdAt,
      attendance: rows,
    };
  }

  function findAtt(eventId, volunteerName) {
    return attendance.find(
      (a) => a.eventId === eventId && a.volunteerName === volunteerName
    );
  }

  function insertAtt(row) {
    attendance.push({ id: crypto.randomUUID(), _seq: (insertSeq += 1), ...row });
  }

  // Keep the volunteer's submission for this event in sync with their
  // attendance check-in/out times. A submission (= counted service hours) exists
  // exactly when the attendance row is complete (both times set, checkout after
  // check-in). This is what makes "hours" flow from the QR scan / manual times,
  // and why removing/incompleting attendance can't leave a stale row behind.
  function reconcileSubmission(eventId, volunteerName) {
    const ev = events.find((e) => e.id === eventId);
    const row = findAtt(eventId, volunteerName);
    const idx = submissions.findIndex(
      (s) => s.eventId === eventId && s.volunteerName === volunteerName
    );
    if (!ev || !row || !isComplete(row.checkinAt, row.checkoutAt)) {
      if (idx >= 0) submissions.splice(idx, 1);
      return;
    }
    const hrs = hoursBetween(row.checkinAt, row.checkoutAt);
    // Deterministic pick on duplicate names (matches Postgres ORDER BY
    // created_at LIMIT 1) so the derived grade never diverges between stores.
    const vol = volunteers
      .filter((v) => v.name === volunteerName)
      .sort((a, b) =>
        a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.code.localeCompare(b.code)
      )[0];
    const fields = {
      grade: vol?.grade || "",
      eventName: ev.customName ? ev.customName : ev.name,
      customEventName: ev.customName || null,
      eventDate: ev.date,
      arrivalTime: localHHMM(row.checkinAt),
      endTime: localHHMM(row.checkoutAt),
      hours: hrs,
      comments: idx >= 0 ? submissions[idx].comments : "",
      submittedAt: nowIso(),
    };
    if (idx >= 0) Object.assign(submissions[idx], fields);
    else
      submissions.push({
        id: crypto.randomUUID(),
        eventId,
        volunteerName,
        ...fields,
      });
  }

  // ---------- volunteers ----------

  async function listVolunteers() {
    return [...volunteers]
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
          a.code.localeCompare(b.code)
      )
      .map(cloneVolunteer);
  }

  async function getVolunteer(id) {
    const v = volunteers.find((x) => x.id === id);
    return v ? cloneVolunteer(v) : null;
  }

  async function getVolunteerByCode(code) {
    const v = volunteers.find((x) => x.code === code);
    return v ? cloneVolunteer(v) : null;
  }

  async function getVolunteerByName(name) {
    const lower = String(name).toLowerCase();
    const v = volunteers.find((x) => x.name.toLowerCase() === lower);
    return v ? cloneVolunteer(v) : null;
  }

  async function createVolunteer(fields) {
    const v = makeVolunteer(fields);
    volunteers.push(v);
    return cloneVolunteer(v);
  }

  async function updateVolunteer(id, patch) {
    const v = volunteers.find((x) => x.id === id);
    if (!v) return null;
    const oldName = v.name;
    const newName = patch.name !== undefined ? patch.name : v.name;
    const nameChanged = newName !== oldName;

    if (nameChanged) {
      const conflict = () => {
        const err = new Error(
          "That name already appears on an event this volunteer attended; rename would collide."
        );
        err.code = "name_conflict";
        return err;
      };
      // Mirror the Postgres UNIQUE(event_id, volunteer_name) on BOTH attendance
      // and submissions: renaming must not collide with a different row already
      // using the new name.
      const affectedEvents = new Set(
        attendance
          .filter((a) => a.volunteerId === id || a.volunteerName === oldName)
          .map((a) => a.eventId)
      );
      for (const eid of affectedEvents) {
        const clash = attendance.find(
          (a) =>
            a.eventId === eid &&
            a.volunteerName === newName &&
            a.volunteerId !== id &&
            a.volunteerName !== oldName
        );
        if (clash) throw conflict();
      }
      for (const s of submissions) {
        if (s.volunteerName !== oldName) continue;
        // Legacy (null-eventId) rows never collide — Postgres UNIQUE treats NULL
        // event_ids as distinct (NULLS DISTINCT), so match that here.
        if (!s.eventId) continue;
        const clash = submissions.find(
          (t) =>
            t !== s && t.eventId === s.eventId && t.volunteerName === newName
        );
        if (clash) throw conflict();
      }
    }

    if (patch.name !== undefined) v.name = patch.name;
    if (patch.email !== undefined) v.email = patch.email;
    if (patch.phone !== undefined) v.phone = patch.phone;
    if (patch.grade !== undefined) v.grade = patch.grade;
    if (patch.customFields !== undefined)
      v.customFields = { ...patch.customFields };
    if (patch.active !== undefined) v.active = patch.active;
    v.updatedAt = nowIso();

    if (nameChanged) {
      for (const a of attendance) {
        if (a.volunteerId === id || a.volunteerName === oldName) {
          a.volunteerName = newName;
        }
      }
      for (const s of submissions) {
        if (s.volunteerName === oldName) s.volunteerName = newName;
      }
    }
    return cloneVolunteer(v);
  }

  async function deleteVolunteer(id) {
    const idx = volunteers.findIndex((x) => x.id === id);
    if (idx < 0) return false;
    volunteers.splice(idx, 1);
    // ON DELETE SET NULL: keep the name on attendance rows for history.
    for (const a of attendance) if (a.volunteerId === id) a.volunteerId = null;
    return true;
  }

  // ---------- events ----------

  async function listEvents() {
    return [...events]
      .sort(
        (a, b) =>
          (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
          (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)
      )
      .map(assembleEvent);
  }

  async function getEvent(id) {
    const e = events.find((x) => x.id === id);
    return e ? assembleEvent(e) : null;
  }

  async function createEvent({ name, customName = null, date }) {
    const e = {
      id: crypto.randomUUID(),
      name,
      customName: customName || null,
      date,
      createdAt: nowIso(),
    };
    events.push(e);
    return assembleEvent(e);
  }

  async function deleteEvent(id) {
    // Purge the event's submissions + attendance unconditionally (matches the
    // Postgres store, which deletes by event_id regardless of whether the event
    // row exists), so a deleted event never leaves orphaned "pending" rows.
    submissions = submissions.filter((s) => s.eventId !== id);
    attendance = attendance.filter((a) => a.eventId !== id);
    const idx = events.findIndex((x) => x.id === id);
    if (idx < 0) return false;
    events.splice(idx, 1);
    return true;
  }

  // ---------- attendance ----------

  async function addAttendees(eventId, names) {
    if (!events.find((e) => e.id === eventId)) return null;
    // Pre-registering only puts volunteers on the list — it does NOT check them
    // in. "Checked in" means having a check-in time (staffCheckin stays in sync
    // with checkinAt), which happens via a QR scan or a manual time.
    const clean = [...new Set(names.filter((n) => typeof n === "string" && n.trim()))];
    for (const name of clean) {
      const existing = findAtt(eventId, name);
      if (existing) {
        existing.selfAdded = false;
        if (!existing.volunteerId) existing.volunteerId = matchVolunteerId(name);
      } else {
        insertAtt({
          eventId,
          volunteerId: matchVolunteerId(name),
          volunteerName: name,
          staffCheckin: false,
          checkinAt: null,
          volunteerCheckout: false,
          checkoutAt: null,
          selfAdded: false,
        });
      }
    }
    return getEvent(eventId);
  }

  async function checkInByCode(eventId, code) {
    const vol = volunteers.find((v) => v.code === code);
    if (!vol) return { ok: false, reason: "unknown_code" };
    if (!events.find((e) => e.id === eventId))
      return { ok: false, reason: "unknown_event" };
    let row = findAtt(eventId, vol.name);
    const alreadyDone = row ? row.staffCheckin === true : false;
    if (row) {
      row.staffCheckin = true;
      row.volunteerId = vol.id;
      row.checkinAt = row.checkinAt || nowIso();
      row.selfAdded = false;
    } else {
      insertAtt({
        eventId,
        volunteerId: vol.id,
        volunteerName: vol.name,
        staffCheckin: true,
        checkinAt: nowIso(),
        volunteerCheckout: false,
        checkoutAt: null,
        selfAdded: false,
      });
      row = findAtt(eventId, vol.name);
    }
    reconcileSubmission(eventId, vol.name);
    return {
      ok: true,
      volunteer: cloneVolunteer(vol),
      attendance: attRowToApi(row),
      event: await getEvent(eventId),
      alreadyDone,
    };
  }

  async function checkOutByCode(eventId, code) {
    const vol = volunteers.find((v) => v.code === code);
    if (!vol) return { ok: false, reason: "unknown_code" };
    if (!events.find((e) => e.id === eventId))
      return { ok: false, reason: "unknown_event" };
    let row = findAtt(eventId, vol.name);
    const alreadyDone = row ? row.volunteerCheckout === true : false;
    if (row) {
      row.volunteerCheckout = true;
      row.volunteerId = vol.id;
      row.checkoutAt = nowIso();
    } else {
      insertAtt({
        eventId,
        volunteerId: vol.id,
        volunteerName: vol.name,
        staffCheckin: false,
        checkinAt: null,
        volunteerCheckout: true,
        checkoutAt: nowIso(),
        selfAdded: false,
      });
      row = findAtt(eventId, vol.name);
    }
    reconcileSubmission(eventId, vol.name);
    return {
      ok: true,
      volunteer: cloneVolunteer(vol),
      attendance: attRowToApi(row),
      event: await getEvent(eventId),
      alreadyDone,
    };
  }

  async function patchAttendance(eventId, volunteerName, patch) {
    const row = findAtt(eventId, volunteerName);
    if (!row) return null;
    // The boolean flag and the timestamp are kept in lock-step so hours (derived
    // from timestamps) and the "confirmed" flags never disagree:
    //   - an explicit checkinAt sets the time and the flag = (time != null);
    //   - toggling the flag on stamps the time (now, if none); toggling off
    //     CLEARS the time. Same for check-out.
    let checkinAt = row.checkinAt;
    let staffCheckin = row.staffCheckin;
    if ("checkinAt" in patch) {
      checkinAt = patch.checkinAt ?? null;
      staffCheckin = checkinAt != null;
    } else if (typeof patch.staffCheckin === "boolean") {
      if (patch.staffCheckin) {
        checkinAt = row.checkinAt || nowIso();
        staffCheckin = true;
      } else {
        checkinAt = null;
        staffCheckin = false;
      }
    }

    let checkoutAt = row.checkoutAt;
    let volunteerCheckout = row.volunteerCheckout;
    if ("checkoutAt" in patch) {
      checkoutAt = patch.checkoutAt ?? null;
      volunteerCheckout = checkoutAt != null;
    } else if (typeof patch.volunteerCheckout === "boolean") {
      if (patch.volunteerCheckout) {
        checkoutAt = row.checkoutAt || nowIso();
        volunteerCheckout = true;
      } else {
        checkoutAt = null;
        volunteerCheckout = false;
      }
    }

    row.staffCheckin = staffCheckin;
    row.volunteerCheckout = volunteerCheckout;
    row.checkinAt = checkinAt ?? null;
    row.checkoutAt = checkoutAt ?? null;
    reconcileSubmission(eventId, volunteerName);
    return getEvent(eventId);
  }

  async function removeAttendance(eventId, volunteerName) {
    if (!events.find((e) => e.id === eventId)) return null;
    attendance = attendance.filter(
      (a) => !(a.eventId === eventId && a.volunteerName === volunteerName)
    );
    // Removing a volunteer from an event removes their derived hours too.
    reconcileSubmission(eventId, volunteerName);
    return getEvent(eventId);
  }

  // ---------- submissions ----------

  async function listSubmissions() {
    return [...submissions]
      .sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : a.submittedAt > b.submittedAt ? 1 : 0))
      .map((s) => ({ ...s }));
  }

  // ---------- admin ----------

  async function reset() {
    events = [];
    attendance = [];
    submissions = [];
  }

  async function exportAll() {
    return {
      volunteers: await listVolunteers(),
      events: await listEvents(),
      submissions: await listSubmissions(),
    };
  }

  async function importAll(payload) {
    // Only the categories PRESENT in the payload are wiped + replaced (mirrors
    // the Postgres store): a partial import (e.g. volunteers-only) must NOT
    // delete event history.
    const hasEvents = Array.isArray(payload?.events);
    const hasSubs = Array.isArray(payload?.submissions);
    const inEvents = hasEvents ? payload.events : [];
    const inSubsRaw = hasSubs ? payload.submissions : [];
    const inVols = Array.isArray(payload?.volunteers)
      ? payload.volunteers
      : null;

    if (hasEvents) {
      events = [];
      attendance = [];
    }
    if (hasSubs) {
      submissions = [];
    }

    if (inVols && inVols.length > 0) {
      volunteers = inVols.map((v) => ({
        id: v.id && isUuid(v.id) ? v.id : crypto.randomUUID(),
        code: v.code,
        name: v.name,
        email: v.email || "",
        phone: v.phone || "",
        grade: v.grade || "",
        customFields: { ...(v.customFields || {}) },
        active: v.active !== false,
        createdAt: v.createdAt || nowIso(),
        updatedAt: v.updatedAt || nowIso(),
      }));
      // Import REPLACES the roster, so the next auto-code is (max imported
      // numeric code)+1 — matching the Postgres store's setval.
      const maxNum = volunteers.reduce((m, v) => {
        const n = parseInt(String(v.code).replace(/[^0-9]/g, ""), 10);
        return Number.isFinite(n) ? Math.max(m, n) : m;
      }, 0);
      codeSeq = maxNum;
    }

    for (const e of inEvents) {
      if (!e || typeof e !== "object") continue;
      const eid = isUuid(e.id) ? e.id : crypto.randomUUID();
      if (events.some((x) => x.id === eid)) continue; // skip dup id (parity with ON CONFLICT DO NOTHING)
      events.push({
        id: eid,
        name: e.name || "",
        customName: e.customName ?? null,
        date: e.date || "",
        createdAt: e.createdAt || nowIso(),
      });
      for (const a of Array.isArray(e.attendance) ? e.attendance : []) {
        if (!a || typeof a.volunteerName !== "string") continue;
        if (findAtt(eid, a.volunteerName)) continue;
        insertAtt({
          eventId: eid,
          volunteerId: matchVolunteerId(a.volunteerName),
          volunteerName: a.volunteerName,
          staffCheckin: !!a.staffCheckin,
          checkinAt: a.checkinAt ?? null,
          volunteerCheckout: !!a.volunteerCheckout,
          checkoutAt: a.checkoutAt ?? null,
          selfAdded: !!a.selfAdded,
        });
      }
    }

    // Dedupe submissions per (eventId, volunteerName) keeping latest.
    const byPair = new Map();
    const legacy = [];
    for (const s of inSubsRaw) {
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
    for (const s of [...byPair.values(), ...legacy]) {
      submissions.push({
        id: isUuid(s.id) ? s.id : crypto.randomUUID(),
        eventId: s.eventId || null,
        volunteerName: s.volunteerName || "",
        grade: s.grade || "",
        eventName: s.eventName || "",
        customEventName: s.customEventName ?? null,
        eventDate: s.eventDate || "",
        arrivalTime: s.arrivalTime || "",
        endTime: s.endTime || "",
        hours: Number(s.hours) || 0,
        comments: s.comments || "",
        submittedAt: s.submittedAt || nowIso(),
      });
    }
    return exportAll();
  }

  async function ensureReady() {
    /* no-op for memory */
  }

  // Liveness probe for /health. The in-memory store is always "reachable" — the
  // durability signal (persistent:false) comes from the backend name, not this.
  async function ping() {
    return true;
  }

  return {
    kind: "memory",
    ensureReady,
    ping,
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
    reset,
    exportAll,
    importAll,
  };
}

function isUuid(v) {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}
