export interface Submission {
  id: string;
  volunteerName: string;
  grade: string;
  eventName: string;
  customEventName: string | null;
  eventDate: string; // YYYY-MM-DD
  arrivalTime: string; // HH:MM
  endTime: string; // HH:MM
  hours: number;
  comments: string;
  submittedAt: string; // ISO timestamp
}

export interface NewSubmission {
  volunteerName: string;
  grade: string;
  eventName: string;
  customEventName?: string | null;
  eventDate: string;
  arrivalTime: string;
  endTime: string;
  comments?: string;
}
