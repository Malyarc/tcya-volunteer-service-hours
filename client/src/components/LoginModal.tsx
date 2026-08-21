import { useEffect, useRef, useState } from "react";
import { login } from "../api";
import { setSession } from "../auth";
import type { AccountRole } from "../types";
import { useFocusTrap } from "../useFocusTrap";

interface Props {
  open: boolean;
  onClose: () => void;
  onLoggedIn: (role: AccountRole) => void;
}

// What each account is for, in the words the chapter uses. Shown under the
// picker so whoever is holding the phone chooses the right one without being
// told twice.
const ACCOUNTS: Array<{
  role: AccountRole;
  label: string;
  blurb: string;
  icon: JSX.Element;
}> = [
  {
    role: "admin",
    label: "Admin",
    blurb: "Full access — events, volunteers, hours and exports.",
    icon: <path d="M12 2L3 7v6c0 5 4 9 9 11 5-2 9-6 9-11V7l-9-5z" />,
  },
  {
    role: "officer",
    label: "Officer",
    blurb: "Open an event, scan volunteers in and out, and flag conduct strikes.",
    icon: (
      <>
        <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
        <line x1="7" y1="12" x2="17" y2="12" />
      </>
    ),
  },
];

export function LoginModal({ open, onClose, onLoggedIn }: Props) {
  const [role, setRole] = useState<AccountRole>("admin");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (open) {
      setRole("admin");
      setPassword("");
      setError(null);
      setShowPassword(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function pickRole(next: AccountRole) {
    setRole(next);
    setError(null);
    // The two accounts have different passcodes, so a half-typed one is never
    // right for the other — clear it rather than leaving a doomed value behind.
    setPassword("");
    passwordRef.current?.focus();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!password.trim()) {
      setError("Please enter the passcode.");
      return;
    }
    try {
      setSubmitting(true);
      const session = await login(role, password);
      setSession(session.token, session.role);
      onLoggedIn(session.role);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const active = ACCOUNTS.find((a) => a.role === role) ?? ACCOUNTS[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={dialogRef}
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
      >
        <div className="bg-gradient-to-br from-brand-700 to-brand-800 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <div>
              <h2 id="login-title" className="text-lg font-semibold">Sign In</h2>
              <p className="text-sm text-white/80">
                Choose your account, then enter its passcode.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5">
          <span className="label" id="login-role-label">Account</span>
          <div
            className="grid grid-cols-2 gap-2"
            role="radiogroup"
            aria-labelledby="login-role-label"
          >
            {ACCOUNTS.map((a) => {
              const on = a.role === role;
              return (
                <button
                  key={a.role}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => pickRole(a.role)}
                  disabled={submitting}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                    on
                      ? "border-brand-600 bg-brand-600 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4 flex-none"
                    aria-hidden
                  >
                    {a.icon}
                  </svg>
                  {a.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500">{active.blurb}</p>

          <label className="label mt-4" htmlFor="login-password">
            Passcode
          </label>
          <div className="relative">
            <input
              id="login-password"
              ref={passwordRef}
              type={showPassword ? "text" : "password"}
              className="input pr-12"
              autoFocus
              inputMode="numeric"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`Enter the ${active.label.toLowerCase()} passcode`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label={showPassword ? "Hide passcode" : "Show passcode"}
            >
              {showPassword ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-4 w-4"
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-4 w-4"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          {error && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting}
            >
              {submitting ? "Signing in…" : "Sign In"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
