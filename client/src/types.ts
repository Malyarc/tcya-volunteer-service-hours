// Ordinary volunteers are capped at an event's expectedHours; officers are not
// (they set up before and clean up after, and that time counts).
export type VolunteerRole = "volunteer" | "officer";

// Which account someone signed in with. A DIFFERENT axis from VolunteerRole
// (which is about the hours cap):
//   "admin"   — full access.
//   "officer" — may only open an event an admin created and check volunteers
//               in / out by scanning their QR. No edits of any kind.
//   null      — signed out; the public, passcode-gated view.
export type AccountRole = "admin" | "officer";

// One event-type section's saved position on the Events page.
export interface EventOrderEntry {
  name: string;
  position: number;
}

export interface Submission {
  id: string;
  eventId: string;
  volunteerName: string;
  grade: string;
  eventName: string;
  customEventName: string | null;
  eventDate: string; // YYYY-MM-DD (taken from the event)
  arrivalTime: string; // HH:MM
  endTime: string; // HH:MM
  hours: number; // CREDITED hours (capped for non-officers)
  // The uncapped checkout − checkin span. Admin-only: the public projection
  // omits it, so treat it as optional.
  rawHours?: number;
  comments: string;
  submittedAt: string; // ISO timestamp
}

// One line of the audit log: an action a staff ACCOUNT took on a volunteer.
// Append-only server-side; the client only ever reads it.
export type AuditAction =
  | "checkin"
  | "checkout"
  | "checkin_cleared"
  | "checkout_cleared"
  | "time_corrected"
  | "strike_set"
  | "attendee_added"
  | "attendee_removed"
  | "volunteer_created"
  | "volunteer_updated"
  | "volunteer_deleted";

export interface AuditEntry {
  id: string;
  at: string; // absolute ISO instant; rendered in chapter time
  // The ACCOUNT, never a person — both passcodes are chapter-shared.
  actorRole: AccountRole;
  action: AuditAction;
  volunteerName: string;
  volunteerCode: string | null;
  eventId: string | null;
  // Snapshots taken when the entry was written, so a deleted event still reads.
  eventName: string;
  eventDate: string;
  details: Record<string, string | number | boolean>;
}

export interface AttendanceEntry {
  volunteerName: string;
  volunteerId?: string | null;
  code?: string | null;
  role?: VolunteerRole;
  staffCheckin: boolean;
  checkinAt?: string | null; // ISO timestamp of staff check-in (QR or manual)
  volunteerCheckout: boolean;
  checkoutAt?: string | null; // ISO timestamp of volunteer check-out
  // True when the volunteer submitted a form for this event but the admin
  // never pre-added them. These show at the bottom of the attendance list.
  selfAdded?: boolean;
  // Conduct strikes recorded against this volunteer AT THIS EVENT. 0 = clean.
  strikes?: number;
}

export interface VolunteerEvent {
  id: string;
  name: string;
  customName: string | null;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM, "" when not set
  endTime: string; // HH:MM, "" when not set
  // Max hours an ordinary volunteer can be credited for this event. null = no
  // cap (every event created before this feature existed).
  expectedHours: number | null;
  createdAt: string;
  attendance: AttendanceEntry[];
}

export interface NewEvent {
  name: string;
  customName?: string | null;
  date: string;
  startTime?: string;
  endTime?: string;
  expectedHours?: number | null;
}

export interface EventPatch {
  name?: string;
  customName?: string | null;
  date?: string;
  startTime?: string;
  endTime?: string;
  expectedHours?: number | null;
}

// ---------- Volunteers (QR "ID card" records) ----------

export interface Volunteer {
  id: string;
  code: string; // TCYA-0001 — the QR unique_ID
  name: string;
  email: string;
  phone: string;
  grade: string;
  role: VolunteerRole;
  customFields: Record<string, string>;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NewVolunteer {
  name: string;
  email?: string;
  phone?: string;
  grade?: string;
  role?: VolunteerRole;
  customFields?: Record<string, string>;
}

export interface VolunteerPatch {
  name?: string;
  email?: string;
  phone?: string;
  grade?: string;
  role?: VolunteerRole;
  active?: boolean;
  customFields?: Record<string, string>;
}

// Public roster entry — names + grade + role only, no contact info.
export interface RosterEntry {
  name: string;
  grade: string;
  role?: VolunteerRole;
}

// Result of a QR scan check-in / check-out.
export interface ScanResult {
  ok: true;
  volunteer: Volunteer;
  attendance: AttendanceEntry;
  event: VolunteerEvent;
  // True when the volunteer was already checked in/out before this scan.
  alreadyDone?: boolean;
}
