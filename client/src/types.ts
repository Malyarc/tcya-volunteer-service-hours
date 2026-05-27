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
  staffCheckin: boolean;
  volunteerCheckout: boolean;
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
