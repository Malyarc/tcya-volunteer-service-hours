// Client-side session helper.
//
// The token is an HMAC produced by the server, so possession of the token IS
// the access — the stored role is only a UI hint about which token we hold.
// Every privileged action is still authorized server-side, so a tampered role
// in localStorage buys nothing: the officer token simply gets a 403 from the
// admin routes.
//
// Persisted in localStorage so nobody has to sign in again on every page load
// (an officer scanning a queue of volunteers must not be logged out by a
// screen lock).

import type { AccountRole } from "./types";

const STORAGE_KEY = "ela-tcya-admin-token";
const ROLE_KEY = "ela-tcya-account-role";

export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// The role of the stored session, or null when signed out. A token with no
// stored role is treated as an admin session: that is the only shape sessions
// saved before officer accounts existed can have, and the server re-checks it
// on the next request anyway.
export function getAccountRole(): AccountRole | null {
  try {
    if (!localStorage.getItem(STORAGE_KEY)) return null;
    const role = localStorage.getItem(ROLE_KEY);
    return role === "officer" ? "officer" : "admin";
  } catch {
    return null;
  }
}

export function setSession(token: string, role: AccountRole): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
    localStorage.setItem(ROLE_KEY, role);
  } catch {
    // localStorage might be disabled (private browsing, etc.). The session
    // simply won't persist across reloads in that case.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ROLE_KEY);
  } catch {
    // ignore
  }
  // Notify the app so it can drop the privileged UI (e.g. after a 401 clears a
  // stale token mid-session) instead of stranding a tokenless "admin" state.
  try {
    window.dispatchEvent(new Event("ela-tcya-token-cleared"));
  } catch {
    // ignore (non-browser / unsupported)
  }
}

export function isSignedIn(): boolean {
  return Boolean(getAdminToken());
}
