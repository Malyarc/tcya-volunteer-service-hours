import { useEffect, useState } from "react";
import type { Volunteer } from "../../types";
import {
  buildQrPayload,
  qrPngDataUrl,
  dataUrlToBlob,
} from "../../qr";
import { downloadVolunteerQrPng, downloadIdCardPdf } from "../../volunteerExports";

interface Props {
  volunteer: Volunteer | null;
  onClose: () => void;
}

// A volunteer's QR "ID card": the scannable code plus their details, with
// one-click ways for staff to copy / download / email it to the volunteer.
export function VolunteerQRModal({ volunteer, onClose }: Props) {
  const [qrUrl, setQrUrl] = useState<string>("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!volunteer) return;
    let cancelled = false;
    setQrUrl("");
    setStatus(null);
    qrPngDataUrl(buildQrPayload(volunteer), 512)
      .then((url) => {
        if (!cancelled) setQrUrl(url);
      })
      .catch(() => {
        if (!cancelled) setStatus("Could not render the QR code.");
      });
    return () => {
      cancelled = true;
    };
  }, [volunteer]);

  useEffect(() => {
    if (!volunteer) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [volunteer, onClose]);

  if (!volunteer) return null;
  const v = volunteer;

  async function copyImage() {
    setStatus(null);
    try {
      const dataUrl = qrUrl || (await qrPngDataUrl(buildQrPayload(v), 512));
      const blob = dataUrlToBlob(dataUrl);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const CI: any = (window as any).ClipboardItem;
      if (CI && navigator.clipboard && "write" in navigator.clipboard) {
        await navigator.clipboard.write([new CI({ [blob.type]: blob })]);
        setStatus("QR image copied — paste it into an email or text.");
      } else {
        await navigator.clipboard.writeText(buildQrPayload(v));
        setStatus("Image copy unsupported here; copied the QR data text instead.");
      }
    } catch {
      setStatus("Copy failed. Use Download instead.");
    }
  }

  async function withBusy(fn: () => Promise<void>, done: string) {
    setBusy(true);
    setStatus(null);
    try {
      await fn();
      setStatus(done);
    } catch {
      setStatus("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function emailQr() {
    // Download the image so staff can attach it, then open a pre-filled draft.
    withBusy(() => downloadVolunteerQrPng(v), "QR image downloaded — attach it to the email draft.");
    const subject = encodeURIComponent("Your TCYA Volunteer Check-in QR Code");
    const body = encodeURIComponent(
      `Hi ${v.name},\n\n` +
        `Attached is your personal TCYA volunteer QR code (ID: ${v.code}). ` +
        `Please save it to your phone — staff will scan it to check you in and out at events.\n\n` +
        `Thank you for volunteering!\nTzu Chi Youth Association — East LA`
    );
    const to = v.email ? encodeURIComponent(v.email) : "";
    window.open(`mailto:${to}?subject=${subject}&body=${body}`, "_blank");
  }

  const customEntries = Object.entries(v.customFields || {});

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`QR ID card for ${v.name}`}
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Volunteer QR ID Card
            </h2>
            <p className="text-sm text-slate-500">
              Copy, download, or email this to {v.name.split(" ")[0]}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost -mr-2"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5">
          {/* ID card */}
          <div className="mx-auto max-w-sm overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
            <div className="bg-gradient-to-br from-brand-700 to-brand-600 px-4 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-white">
              Tzu Chi Youth Association — East LA
            </div>
            <div className="flex items-center gap-4 px-4 py-4">
              <div className="flex h-32 w-32 flex-none items-center justify-center rounded-lg border border-slate-200 bg-white">
                {qrUrl ? (
                  <img src={qrUrl} alt={`QR code for ${v.name}`} className="h-32 w-32" />
                ) : (
                  <span className="text-xs text-slate-400">Rendering…</span>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-base font-bold text-slate-900">
                  {v.name}
                </div>
                <div className="text-sm font-semibold text-brand-700">{v.code}</div>
                {v.grade && (
                  <div className="text-xs text-slate-500">Grade {v.grade}</div>
                )}
                {v.phone && (
                  <div className="mt-1 truncate text-xs text-slate-600">{v.phone}</div>
                )}
                {v.email && (
                  <div className="truncate text-xs text-slate-600">{v.email}</div>
                )}
                {customEntries.map(([k, val]) => (
                  <div key={k} className="truncate text-xs text-slate-500">
                    <span className="font-medium">{k}:</span> {val}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {status && (
            <div className="mt-4 rounded-lg border border-brand-100 bg-brand-50/70 px-3 py-2 text-center text-xs text-brand-800">
              {status}
            </div>
          )}

          {/* Actions */}
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ActionButton onClick={copyImage} disabled={busy} label="Copy image" icon="copy" />
            <ActionButton
              onClick={() => withBusy(() => downloadVolunteerQrPng(v), "QR PNG downloaded.")}
              disabled={busy}
              label="Download PNG"
              icon="download"
            />
            <ActionButton
              onClick={() => withBusy(() => downloadIdCardPdf(v), "ID card PDF downloaded.")}
              disabled={busy}
              label="ID card PDF"
              icon="card"
            />
            <ActionButton
              onClick={emailQr}
              disabled={busy || !v.email}
              label="Email"
              icon="mail"
              title={v.email ? `Email ${v.email}` : "No email on file — add one to email this"}
            />
          </div>
          <p className="mt-3 text-center text-[11px] text-slate-400">
            The QR encodes only {v.name.split(" ")[0]}'s name and unique ID ({v.code}) —
            staff scan it to check in / out. Contact details are printed on the card,
            never inside the code.
          </p>
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  label,
  icon,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  icon: "copy" | "download" | "card" | "mail";
  title?: string;
}) {
  const paths: Record<string, JSX.Element> = {
    copy: (
      <>
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </>
    ),
    download: (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </>
    ),
    card: (
      <>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </>
    ),
    mail: (
      <>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 6-10 7L2 6" />
      </>
    ),
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex flex-col items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-2.5 text-xs font-medium text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        {paths[icon]}
      </svg>
      {label}
    </button>
  );
}
