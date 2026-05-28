import { useEffect, useRef, useState } from "react";

const PASSCODE = "1994";
const LENGTH = PASSCODE.length;

interface Props {
  onUnlock: () => void;
}

export function PasscodeGate({ onUnlock }: Props) {
  const [digits, setDigits] = useState<string[]>(() => Array(LENGTH).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  function attempt(values: string[]) {
    const code = values.join("");
    if (code.length < LENGTH) return;
    if (code === PASSCODE) {
      onUnlock();
    } else {
      setError("Incorrect passcode. Please try again.");
      setShaking(true);
      window.setTimeout(() => setShaking(false), 450);
      window.setTimeout(() => {
        setDigits(Array(LENGTH).fill(""));
        inputsRef.current[0]?.focus();
      }, 450);
    }
  }

  function handleChange(index: number, raw: string) {
    const onlyDigits = raw.replace(/\D/g, "");
    if (!onlyDigits) {
      // Allow clearing a single box by hitting backspace or delete.
      const next = [...digits];
      next[index] = "";
      setDigits(next);
      return;
    }
    setError(null);

    // Paste support: if the user pasted more than one digit into a box,
    // distribute the digits across the remaining boxes.
    if (onlyDigits.length > 1) {
      const next = [...digits];
      let cursor = index;
      for (const ch of onlyDigits.split("").slice(0, LENGTH - index)) {
        next[cursor] = ch;
        cursor += 1;
      }
      setDigits(next);
      const focusIdx = Math.min(cursor, LENGTH - 1);
      inputsRef.current[focusIdx]?.focus();
      attempt(next);
      return;
    }

    const next = [...digits];
    next[index] = onlyDigits;
    setDigits(next);
    if (index < LENGTH - 1) {
      inputsRef.current[index + 1]?.focus();
    }
    attempt(next);
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      if (digits[index]) {
        // Clear the current digit first; the next backspace will jump back.
        const next = [...digits];
        next[index] = "";
        setDigits(next);
        e.preventDefault();
      } else if (index > 0) {
        inputsRef.current[index - 1]?.focus();
        const next = [...digits];
        next[index - 1] = "";
        setDigits(next);
        e.preventDefault();
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      inputsRef.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < LENGTH - 1) {
      inputsRef.current[index + 1]?.focus();
    } else if (e.key === "Enter") {
      attempt(digits);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      {/* Soft tint over the blurred app underneath. */}
      <div className="absolute inset-0 bg-brand-900/30" aria-hidden />

      <div
        className={`relative w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5 transition-transform ${
          shaking ? "animate-[shake_0.45s_ease-in-out]" : ""
        }`}
      >
        <div className="bg-gradient-to-br from-brand-700 to-brand-800 px-6 pt-6 pb-5 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white p-1.5 shadow-md shadow-brand-950/30 ring-1 ring-white/60">
              <img
                src="/tzu-chi-logo.png"
                alt=""
                className="h-full w-auto object-contain"
              />
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent-200">
                ELA TCYA
              </div>
              <h1 className="text-lg font-bold leading-tight">
                Volunteer Service Hours
              </h1>
            </div>
          </div>
        </div>

        <div className="px-6 py-6">
          <h2 className="text-base font-semibold text-slate-900">
            Enter passcode
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Please enter the 4-digit passcode to continue.
          </p>

          <div className="mt-5 flex justify-center gap-2.5">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputsRef.current[i] = el;
                }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={6}
                value={d}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                onFocus={(e) => e.currentTarget.select()}
                className={`h-14 w-12 rounded-xl border bg-white text-center text-2xl font-semibold text-slate-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-200 ${
                  error
                    ? "border-red-300 ring-2 ring-red-100"
                    : "border-slate-200"
                }`}
                aria-label={`Passcode digit ${i + 1}`}
              />
            ))}
          </div>

          {error && (
            <div className="mt-4 text-center text-sm font-medium text-red-600">
              {error}
            </div>
          )}

          <p className="mt-5 text-center text-xs text-slate-400">
            Stays unlocked until you close this tab.
          </p>
        </div>
      </div>
    </div>
  );
}
