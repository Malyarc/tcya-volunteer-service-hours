import type { NewSubmission, Submission } from "./types";

const API_BASE = "/api";

export async function fetchSubmissions(): Promise<Submission[]> {
  const res = await fetch(`${API_BASE}/submissions`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load submissions (${res.status})`);
  return res.json();
}

export async function createSubmission(
  payload: NewSubmission
): Promise<Submission> {
  const res = await fetch(`${API_BASE}/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = `Failed to save (${res.status})`;
    try {
      const data = await res.json();
      if (Array.isArray(data?.errors)) message = data.errors.join(", ");
      else if (data?.error) message = data.error;
    } catch {
      // ignore JSON parse errors and fall back to the default message
    }
    throw new Error(message);
  }
  const data = await res.json();
  return data.submission as Submission;
}
