import { useEffect, useRef } from "react";

// The big, unmissable confirmation that shows over the scanner after every scan.
//
// Why it exists: the old feedback was a small text bar under the camera. At an
// event you are holding a phone at arm's length, in sunlight, with the next
// volunteer already stepping forward — a one-line status bar is invisible. This
// takes over the whole screen for ~1 second so both the operator AND the
// volunteer can see, from a distance, that the scan landed.
//
// Behaviour:
//   - auto-dismisses after `durationMs` (default 1s) and returns to the camera;
//   - a tap anywhere fast-forwards it, so a fast queue is never gated on it;
//   - scanning continues underneath the whole time — this is pure feedback;
//   - sized in viewport units with a hard px ceiling, so it is correctly
//     proportioned on a phone, a tablet and a laptop without media queries;
//   - honours prefers-reduced-motion (fades instead of popping/drawing).

export type ScanFlashKind = "ok" | "warn" | "error";

export interface ScanFlashState {
  // Bumped on every scan so re-scanning the same person re-triggers the effect.
  id: number;
  kind: ScanFlashKind;
  title: string;
  subtitle?: string;
  mode: "in" | "out";
}

const PALETTE: Record<
  ScanFlashKind,
  { ring: string; disc: string; glow: string; text: string; label: string }
> = {
  ok: {
    ring: "#34d399",
    disc: "linear-gradient(145deg,#34d399 0%,#059669 100%)",
    glow: "rgba(16,185,129,0.55)",
    text: "#ecfdf5",
    label: "#a7f3d0",
  },
  warn: {
    ring: "#fbbf24",
    disc: "linear-gradient(145deg,#fbbf24 0%,#d97706 100%)",
    glow: "rgba(245,158,11,0.5)",
    text: "#fffbeb",
    label: "#fde68a",
  },
  error: {
    ring: "#f87171",
    disc: "linear-gradient(145deg,#f87171 0%,#dc2626 100%)",
    glow: "rgba(239,68,68,0.5)",
    text: "#fef2f2",
    label: "#fecaca",
  },
};

export function ScanFlash({
  state,
  durationMs = 1000,
  onDone,
}: {
  state: ScanFlashState | null;
  durationMs?: number;
  onDone: () => void;
}) {
  const timerRef = useRef<number | null>(null);
  // Held in a ref so the dismiss timer depends ONLY on which scan is showing.
  // Keying the effect on the callback would restart the countdown on every
  // parent re-render (each scan re-renders the scanner several times), and a
  // busy queue could keep the overlay up indefinitely.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const flashId = state?.id;
  useEffect(() => {
    if (flashId === undefined) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => onDoneRef.current(), durationMs);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    // `flashId` changes on every scan, restarting the countdown for the new one.
  }, [flashId, durationMs]);

  if (!state) return null;
  const c = PALETTE[state.kind];

  return (
    <div
      // Tap anywhere to fast-forward. role="status" + aria-live means a
      // screen reader announces the result instead of seeing a bare graphic.
      onPointerDown={onDone}
      role="status"
      aria-live="assertive"
      className="scan-flash absolute inset-0 z-20 flex flex-col items-center justify-center gap-[3vmin] px-6 text-center"
      style={{ background: "rgba(2,6,23,0.82)", backdropFilter: "blur(2px)" }}
    >
      <div className="scan-flash-badge relative flex items-center justify-center">
        {/* Expanding ring — reads as "captured" even in peripheral vision. */}
        <span
          aria-hidden
          className="scan-flash-ring absolute inset-0 rounded-full"
          style={{ border: `0.6vmin solid ${c.ring}` }}
        />
        <span
          aria-hidden
          className="scan-flash-disc flex h-full w-full items-center justify-center rounded-full"
          style={{ background: c.disc, boxShadow: `0 0 12vmin ${c.glow}` }}
        >
          <svg
            viewBox="0 0 52 52"
            fill="none"
            stroke="#fff"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-1/2 w-1/2"
            aria-hidden
          >
            {state.kind === "error" ? (
              <path className="scan-flash-mark" d="M17 17 L35 35 M35 17 L17 35" />
            ) : (
              <path className="scan-flash-mark" d="M14 27.5 L22.5 36 L38 17" />
            )}
          </svg>
        </span>
      </div>

      <div className="scan-flash-copy">
        <div
          className="font-extrabold leading-tight tracking-tight"
          style={{ color: c.text, fontSize: "clamp(1.5rem, 6.2vmin, 2.75rem)" }}
        >
          {state.title}
        </div>
        <div
          className="mt-[0.6vmin] font-bold uppercase tracking-[0.18em]"
          style={{ color: c.label, fontSize: "clamp(0.7rem, 2.4vmin, 1rem)" }}
        >
          {state.subtitle ??
            (state.kind === "error"
              ? "Not scanned"
              : `Checked ${state.mode === "in" ? "in" : "out"}`)}
        </div>
      </div>
    </div>
  );
}

// A short, pleasant confirmation chime (a rising two-note major third) for a
// successful scan, and a duller low tone for a problem. Separate from the UI so
// the scanner can play it the instant the request resolves.
export function playScanTone(ctx: AudioContext, kind: ScanFlashKind) {
  const now = ctx.currentTime;
  // ok: C6 → E6. warn: a single mid tone. error: a low, flat buzz.
  const notes =
    kind === "ok"
      ? [
          { f: 1046.5, at: 0, dur: 0.12 },
          { f: 1318.5, at: 0.1, dur: 0.22 },
        ]
      : kind === "warn"
        ? [{ f: 660, at: 0, dur: 0.22 }]
        : [{ f: 200, at: 0, dur: 0.3 }];

  for (const n of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = kind === "error" ? "sawtooth" : "sine";
    osc.frequency.setValueAtTime(n.f, now + n.at);
    // Exponential ramps avoid the click a hard gain change makes.
    gain.gain.setValueAtTime(0.0001, now + n.at);
    gain.gain.exponentialRampToValueAtTime(kind === "error" ? 0.2 : 0.32, now + n.at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + n.at + n.dur);
    osc.start(now + n.at);
    osc.stop(now + n.at + n.dur + 0.02);
  }
}
