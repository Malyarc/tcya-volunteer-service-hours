// QR "ID card" helpers: build the payload we encode into a volunteer's QR,
// parse a scanned payload back to a code, and render QR images. The heavy
// `qrcode` library is dynamically imported so it never lands in the initial
// bundle a public visitor loads.

import type { Volunteer } from "./types";

// Marker so our scanner can tell a TCYA volunteer QR apart from any other QR.
export const QR_TYPE = "TCYA-VOL";
export const CODE_RE = /^TCYA-\d{4,}$/i;

export interface QrPayload {
  t: typeof QR_TYPE;
  v: 1;
  id: string;
  code: string;
  name: string;
}

// The string encoded into a volunteer's QR. DATA MINIMIZATION: we encode only
// the identity needed to check the volunteer in (the server resolves everything
// from `code`) plus the name for a friendly scan confirmation. We deliberately
// do NOT embed email / phone / custom fields — a QR is machine-readable by any
// generic phone camera, so putting a minor's contact info in it would expose it
// to anyone who scans the card. That info stays as human-readable text on the
// printed card and in the admin-only roster export.
export function buildQrPayload(v: Volunteer): string {
  const payload: QrPayload = {
    t: QR_TYPE,
    v: 1,
    id: v.id,
    code: v.code,
    name: v.name,
  };
  return JSON.stringify(payload);
}

export interface ParsedScan {
  code: string;
  name?: string;
}

// Turn scanned QR text into a code. Accepts either our JSON payload or a bare
// "TCYA-0001" code (in case a QR was generated with only the code). Returns
// null for anything that isn't a TCYA volunteer code.
export function parseScannedCode(text: string): ParsedScan | null {
  if (!text) return null;
  const trimmed = text.trim();
  // JSON payload
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj && obj.t === QR_TYPE && typeof obj.code === "string") {
        return { code: obj.code, name: typeof obj.name === "string" ? obj.name : undefined };
      }
    } catch {
      // fall through
    }
    return null;
  }
  // Bare code
  if (CODE_RE.test(trimmed)) return { code: trimmed.toUpperCase() };
  return null;
}

// Render a QR as a PNG data URL (used for on-screen display, clipboard copy,
// downloads, and embedding in PDFs). High error correction + generous margin
// so it scans reliably off a phone screen.
export async function qrPngDataUrl(
  text: string,
  size = 512
): Promise<string> {
  const QRCode = await import("qrcode");
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: size,
    color: { dark: "#0f172a", light: "#ffffff" },
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(head)?.[1] || "image/png";
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Filesystem-safe file name fragment (mirrors certificate.ts).
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "").trim();
}
