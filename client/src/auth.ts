// Tiny client-side admin session helper. The token is an HMAC produced by the
// server, so possession of the token == admin-level access. We persist it in
// localStorage so the admin doesn't have to log in on every page load.

const STORAGE_KEY = "ela-tcya-admin-token";

export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // localStorage might be disabled (private browsing, etc.). The session
    // simply won't persist across reloads in that case.
  }
}

export function clearAdminToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function isAdminLoggedIn(): boolean {
  return Boolean(getAdminToken());
}
