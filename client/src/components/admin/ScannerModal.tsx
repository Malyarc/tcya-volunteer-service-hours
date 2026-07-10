import { useCallback, useEffect, useRef, useState } from "react";
import type { Volunteer, VolunteerEvent } from "../../types";
import { checkInByCode, checkOutByCode } from "../../api";
import { parseScannedCode } from "../../qr";
import { formatClockFromIso, getEventDisplayName } from "../../utils";

type Mode = "in" | "out";
type Feedback = { kind: "ok" | "warn" | "error"; text: string; at: number } | null;
interface RecentScan {
  name: string;
  code: string;
  mode: Mode;
  time: string;
  status: "ok" | "unknown";
}

const DEBOUNCE_MS = 3500; // ignore the same code re-appearing within this window
const SCAN_INTERVAL_MS = 180;

interface Props {
  open: boolean;
  event: VolunteerEvent;
  volunteers: Volunteer[];
  onClose: () => void;
  onScanned: (updatedEvent: VolunteerEvent) => void;
}

export function ScannerModal({ open, event, volunteers, onClose, onScanned }: Props) {
  const [mode, setMode] = useState<Mode>("in");
  const [cameraState, setCameraState] = useState<"idle" | "starting" | "on" | "error">("idle");
  const [cameraError, setCameraError] = useState<string>("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [recent, setRecent] = useState<RecentScan[]>([]);
  const [manualCode, setManualCode] = useState("");
  const [manualPick, setManualPick] = useState("");
  const [processing, setProcessing] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<number | null>(null);
  const jsqrRef = useRef<typeof import("jsqr")["default"] | null>(null);
  const detectorRef = useRef<{ detect: (v: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } | null>(null);
  const seenRef = useRef<Map<string, number>>(new Map());
  const processingRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  // Keep the latest mode/event available inside the scan loop without
  // re-subscribing the interval.
  const modeRef = useRef<Mode>(mode);
  const eventIdRef = useRef<string>(event.id);
  // Generation counter: bumped whenever the scanner opens/closes so an async
  // getUserMedia that resolves after close can detect it's stale and stop the
  // stream instead of leaking the camera.
  const runIdRef = useRef(0);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { eventIdRef.current = event.id; }, [event.id]);

  function beep(kind: "ok" | "error") {
    try {
      if (!audioRef.current) {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioRef.current = new Ctor();
      }
      const ctx = audioRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = kind === "ok" ? 880 : 240;
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.start();
      osc.stop(ctx.currentTime + 0.19);
    } catch {
      /* audio is best-effort */
    }
  }

  const stopCamera = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const processCode = useCallback(
    async (rawCode: string, source: "scan" | "manual") => {
      const parsed = parseScannedCode(rawCode);
      if (!parsed) {
        setFeedback({ kind: "warn", text: "That QR isn't a TCYA volunteer code.", at: Date.now() });
        if (source === "scan") beep("error");
        return;
      }
      if (processingRef.current) return;
      processingRef.current = true;
      setProcessing(true);
      try {
        const fn = modeRef.current === "in" ? checkInByCode : checkOutByCode;
        const res = await fn(eventIdRef.current, parsed.code);
        onScanned(res.event);
        const inMode = modeRef.current === "in";
        const t = inMode ? res.attendance.checkinAt : res.attendance.checkoutAt;
        const verb = inMode ? "in" : "out";
        beep("ok");
        // Distinguish a fresh scan from re-scanning someone already done.
        const text = res.alreadyDone
          ? `${res.volunteer.name} was already checked ${verb}${t ? " at " + formatClockFromIso(t) : ""}`
          : `${res.volunteer.name} checked ${verb}${t ? " at " + formatClockFromIso(t) : ""}`;
        setFeedback({ kind: res.alreadyDone ? "warn" : "ok", text, at: Date.now() });
        setRecent((prev) =>
          [
            {
              name: res.volunteer.name + (res.alreadyDone ? " (already done)" : ""),
              code: res.volunteer.code,
              mode: modeRef.current,
              time: formatClockFromIso(t) || "now",
              status: "ok" as const,
            },
            ...prev,
          ].slice(0, 12)
        );
      } catch (err) {
        beep("error");
        const msg = err instanceof Error ? err.message : "Scan failed.";
        setFeedback({ kind: "error", text: msg, at: Date.now() });
        setRecent((prev) =>
          [
            { name: msg, code: parsed.code, mode: modeRef.current, time: "", status: "unknown" as const },
            ...prev,
          ].slice(0, 12)
        );
      } finally {
        processingRef.current = false;
        setProcessing(false);
      }
    },
    [onScanned]
  );

  const tick = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || processingRef.current) return;

    let raw: string | null = null;
    try {
      if (detectorRef.current) {
        const codes = await detectorRef.current.detect(video);
        raw = codes[0]?.rawValue || null;
      } else if (jsqrRef.current) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) return;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        raw = jsqrRef.current(img.data, w, h)?.data || null;
      }
    } catch {
      return; // transient decode error; try next frame
    }
    if (!raw) return;

    // Debounce per (code, mode) so flipping Check-In ↔ Check-Out and re-scanning
    // the same QR within the window still registers the second action.
    const key = `${raw}|${modeRef.current}`;
    const now = Date.now();
    const last = seenRef.current.get(key) || 0;
    if (now - last < DEBOUNCE_MS) return;
    seenRef.current.set(key, now);
    await processCode(raw, "scan");
  }, [processCode]);

  const startCamera = useCallback(async () => {
    const myRun = runIdRef.current;
    setCameraError("");
    if (!window.isSecureContext) {
      setCameraState("error");
      setCameraError("Camera needs a secure (https) connection. You can still check people in manually below.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("error");
      setCameraError("This browser can't open the camera. Use manual check-in below.");
      return;
    }
    setCameraState("starting");
    try {
      // Prefer the native detector; fall back to the jsQR library.
      const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
      if (BD) {
        try {
          detectorRef.current = new BD({ formats: ["qr_code"] });
        } catch {
          detectorRef.current = null;
        }
      }
      if (!detectorRef.current && !jsqrRef.current) {
        const mod = await import("jsqr");
        jsqrRef.current = mod.default;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      // Closed / reopened while we were awaiting permission? Stop this stream
      // instead of leaking the camera, and don't overwrite a newer one.
      if (myRun !== runIdRef.current || !videoRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      await video.play().catch(() => {});
      setCameraState("on");
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = window.setInterval(tick, SCAN_INTERVAL_MS);
    } catch (err) {
      setCameraState("error");
      const name = (err as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        setCameraError("Camera permission was blocked. Allow camera access, or use manual check-in below.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setCameraError("No camera found. Use manual check-in below.");
      } else {
        setCameraError("Couldn't start the camera. Use manual check-in below.");
      }
    }
  }, [tick]);

  // Open / close lifecycle. Bump the generation on every transition so an
  // in-flight getUserMedia can tell it's stale (see startCamera).
  useEffect(() => {
    runIdRef.current += 1;
    if (open) {
      setFeedback(null);
      seenRef.current.clear();
      startCamera();
    } else {
      stopCamera();
      setCameraState("idle");
    }
    return () => {
      runIdRef.current += 1;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Release the AudioContext when the scanner unmounts (it's created lazily on
  // the first beep and otherwise accumulates across event visits).
  useEffect(() => {
    return () => {
      audioRef.current?.close().catch(() => {});
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const code = manualCode.trim();
    if (!code) return;
    setManualCode("");
    processCode(code, "manual");
  }

  function submitPick() {
    const v = volunteers.find((x) => x.id === manualPick);
    if (!v) return;
    processCode(v.code, "manual");
  }

  const fbClasses =
    feedback?.kind === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : feedback?.kind === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-red-200 bg-red-50 text-red-700";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Scan volunteer QR codes"
        className="relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Scan Volunteer QR</h2>
            <p className="text-xs text-slate-500">{getEventDisplayName(event)}</p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost -mr-2" aria-label="Close scanner">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2 px-5 pt-3">
          <ModeButton active={mode === "in"} tone="in" onClick={() => setMode("in")} label="Check In" />
          <ModeButton active={mode === "out"} tone="out" onClick={() => setMode("out")} label="Check Out" />
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {/* Camera viewport */}
          <div className="relative overflow-hidden rounded-xl bg-slate-900" style={{ aspectRatio: "4 / 3" }}>
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
            <canvas ref={canvasRef} className="hidden" />
            {/* reticle */}
            {cameraState === "on" && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div
                  className={`h-40 w-40 rounded-2xl border-4 ${
                    mode === "in" ? "border-emerald-400/80" : "border-amber-400/80"
                  } shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]`}
                />
              </div>
            )}
            {(cameraState === "starting" || cameraState === "error") && (
              <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white/90">
                {cameraState === "starting" ? (
                  <>
                    <svg className="mb-2 h-6 w-6 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="9" opacity="0.25" />
                      <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
                    </svg>
                    <span className="text-sm">Starting camera…</span>
                  </>
                ) : (
                  <>
                    <span className="text-sm">{cameraError}</span>
                    <button onClick={startCamera} className="mt-3 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold ring-1 ring-white/30 hover:bg-white/25">
                      Try camera again
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Live feedback */}
          <div className={`mt-3 rounded-lg border px-3 py-2 text-center text-sm font-medium ${feedback ? fbClasses : "border-slate-200 bg-slate-50 text-slate-500"}`}>
            {feedback
              ? feedback.text
              : cameraState === "on"
                ? `Point at a volunteer's QR to check ${mode === "in" ? "in" : "out"}.`
                : "Camera off — use manual check-in below."}
          </div>

          {/* Manual fallback */}
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Manual check-{mode === "in" ? "in" : "out"}
            </div>
            <form onSubmit={submitManual} className="flex gap-2">
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Enter code e.g. TCYA-0001"
                className="input"
              />
              <button type="submit" className="btn-secondary whitespace-nowrap" disabled={!manualCode.trim() || processing}>
                Go
              </button>
            </form>
            <div className="mt-2 flex gap-2">
              <select className="input" value={manualPick} onChange={(e) => setManualPick(e.target.value)}>
                <option value="">Or pick a volunteer…</option>
                {[...volunteers]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {v.code}
                    </option>
                  ))}
              </select>
              <button type="button" onClick={submitPick} className="btn-secondary whitespace-nowrap" disabled={!manualPick || processing}>
                Check {mode === "in" ? "in" : "out"}
              </button>
            </div>
          </div>

          {/* Recent scans */}
          {recent.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                This session ({recent.filter((r) => r.status === "ok").length})
              </div>
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {recent.map((r, i) => (
                  <li
                    key={i}
                    className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ${
                      r.status === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"
                    }`}
                  >
                    <span className="truncate">
                      {r.status === "ok" ? (
                        <>
                          <span className="font-medium">{r.name}</span>{" "}
                          <span className="text-xs opacity-70">
                            checked {r.mode === "in" ? "in" : "out"} {r.time && `· ${r.time}`}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs">{r.name}</span>
                      )}
                    </span>
                    <span className={`badge ${r.mode === "in" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                      {r.mode === "in" ? "IN" : "OUT"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 px-5 py-3 text-right">
          <button onClick={onClose} className="btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  tone,
  onClick,
  label,
}: {
  active: boolean;
  tone: "in" | "out";
  onClick: () => void;
  label: string;
}) {
  const activeCls =
    tone === "in" ? "bg-emerald-500 text-white shadow" : "bg-amber-500 text-white shadow";
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
        active ? activeCls : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {label}
    </button>
  );
}
