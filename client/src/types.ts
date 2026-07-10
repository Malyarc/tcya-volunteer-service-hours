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
  hours: number;
  comments: string;
  submittedAt: string; // ISO timestamp
}

export interface NewSubmission {
  volunteerName: string;
  grade: string;
  eventId: string;
  arrivalTime: string;
  endTime: string;
  comments?: string;
}

export interface AttendanceEntry {
  volunteerName: string;
  volunteerId?: string | null;
  code?: string | null;
  staffCheckin: boolean;
  checkinAt?: string | null; // ISO timestamp of staff check-in (QR or manual)
  volunteerCheckout: boolean;
  checkoutAt?: string | null; // ISO timestamp of volunteer check-out
  // True when the volunteer submitted a form for this event but the admin
  // never pre-added them. These show at the bottom of the attendance list.
  selfAdded?: boolean;
}

export interface VolunteerEvent {
  id: string;
  name: string;
  customName: string | null;
  date: string; // YYYY-MM-DD
  createdAt: string;
  attendance: AttendanceEntry[];
}

export interface NewEvent {
  name: string;
  customName?: string | null;
  date: string;
}

// ---------- Volunteers (QR "ID card" records) ----------

export interface Volunteer {
  id: string;
  code: string; // TCYA-0001 — the QR unique_ID
  name: string;
  email: string;
  phone: string;
  grade: string;
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
  customFields?: Record<string, string>;
}

export interface VolunteerPatch {
  name?: string;
  email?: string;
  phone?: string;
  grade?: string;
  active?: boolean;
  customFields?: Record<string, string>;
}

// Public roster entry — names + grade only, no contact info.
export interface RosterEntry {
  name: string;
  grade: string;
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
