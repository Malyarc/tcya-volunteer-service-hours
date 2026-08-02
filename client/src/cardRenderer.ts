// Renders a volunteer's QR "ID card" to a PNG on a <canvas>. ONE renderer feeds
// every surface — the on-screen preview, the PNG download, clipboard copy, and
// the single/bulk PDFs — so what you preview is exactly what prints.
//
// Layout reproduces the chapter's own sample card:
//   ┌───────────────────────────────────────────────┐
//   │  [lotus+candle]     Tzu Chi Youth Association US │  ← light-blue header band
//   │                          East LA 東洛慈少         │
//   │                                                  │
//   │                                    ▉▉ QR ▉▉      │  ← QR (right)
//   │   Amber Wang                       ▉▉▉▉▉▉▉▉      │  ← big name (left)
//   │                                   ELA-TCYA-001    │  ← branded ID under the QR
//   └───────────────────────────────────────────────┘
// Long names wrap to two rows: first name on row 1, last name on row 2.

import type { Volunteer } from "./types";
import { buildQrPayload, qrPngDataUrl, formatDisplayId } from "./qr";

// Logical card canvas: 3.5in × 2in at 300dpi (standard ID-card proportions).
export const CARD_W = 1050;
export const CARD_H = 600;
export const CARD_ASPECT = CARD_W / CARD_H;

const FONT_STACK =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const COLORS = {
  band: "#c9ddf5", // soft "blue sky" 藍天 header
  border: "#e3e8ee",
  org: "#1f2733", // near-black org text
  name: "#0a0a0b",
  id: "#2a2f3a",
};

// The lotus + cupped-hands + candle logo (same asset as the certificate).
const LOGO_SRC = "/cert-logo.png";

const imageCache = new Map<string, Promise<HTMLImageElement>>();
export function loadImage(src: string): Promise<HTMLImageElement> {
  let p = imageCache.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
      img.src = src;
    });
    // Never cache a FAILED load: evict on rejection so a later render retries.
    // Otherwise one transient blip (or a 404 mid-deploy for the non-hashed
    // public logo) would poison every card render for the whole session.
    p.catch(() => {
      if (imageCache.get(src) === p) imageCache.delete(src);
    });
    imageCache.set(src, p);
  }
  return p;
}

// Draw an image scaled to fit (contain) inside a box, centered, preserving aspect.
function drawContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  align: "left" | "center" = "left"
) {
  const ar = img.width / img.height;
  let w = bw;
  let h = w / ar;
  if (h > bh) {
    h = bh;
    w = h * ar;
  }
  const x = align === "left" ? bx : bx + (bw - w) / 2;
  const y = by + (bh - h) / 2;
  ctx.drawImage(img, x, y, w, h);
}

// Largest px size in [min, max] at which `text` fits on one line within
// maxWidth. Returns 0 if it doesn't fit even at `min` (caller should wrap).
function fitOneLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  weight: number,
  max: number,
  min: number
): number {
  for (let fs = max; fs >= min; fs -= 1) {
    ctx.font = `${weight} ${fs}px ${FONT_STACK}`;
    if (ctx.measureText(text).width <= maxWidth) return fs;
  }
  return 0;
}

// Split a name into [firstName, lastName]: first whitespace-token is the first
// name, everything after is the last name. null when there's no space to split.
function splitFirstLast(name: string): [string, string] | null {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return [parts[0], parts.slice(1).join(" ")];
}

export interface CardParts {
  logo: HTMLImageElement;
  qr: HTMLImageElement;
  name: string;
  displayId: string;
}

// Pure drawing routine (logical CARD_W×CARD_H coordinates). Exposed so the PDF
// path can also draw straight onto a scaled canvas.
export function drawCard(ctx: CanvasRenderingContext2D, parts: CardParts) {
  const { logo, qr, name, displayId } = parts;
  const bandH = 206;

  // background + header band
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = COLORS.band;
  ctx.fillRect(0, 0, CARD_W, bandH);

  // logo (left, vertically centered in the band)
  drawContain(ctx, logo, 46, 16, 256, bandH - 34, "left");

  // org text (right-aligned): regular line 1, bold line 2
  const orgRight = CARD_W - 52;
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLORS.org;
  ctx.font = `500 44px ${FONT_STACK}`;
  ctx.fillText("Tzu Chi Youth Association US", orgRight, 82);
  ctx.font = `700 50px ${FONT_STACK}`;
  ctx.fillText("East LA 東洛慈少", orgRight, 152);

  // QR (right) — vertically centered in the body, ID centered beneath it
  const qrSize = 224;
  const qrRightMargin = 74;
  const qrX = CARD_W - qrRightMargin - qrSize;
  const idGap = 40;
  const bodyTop = bandH;
  const bodyH = CARD_H - bandH;
  const qrY = bodyTop + (bodyH - (qrSize + idGap)) / 2;
  ctx.drawImage(qr, qrX, qrY, qrSize, qrSize);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLORS.id;
  ctx.font = `600 30px ${FONT_STACK}`;
  ctx.fillText(displayId, qrX + qrSize / 2, qrY + qrSize + 34);

  // name (left) — one big line if it fits; otherwise first name on row 1 and
  // last name on row 2. Vertically centered in the white body.
  const nameLeft = 60;
  const nameMaxW = qrX - 44 - nameLeft;
  const bodyMidY = bodyTop + bodyH / 2;
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.name;

  const oneLine = fitOneLine(ctx, name, nameMaxW, 800, 116, 78);
  const firstLast = splitFirstLast(name);
  if (oneLine) {
    ctx.font = `800 ${oneLine}px ${FONT_STACK}`;
    ctx.textBaseline = "middle";
    ctx.fillText(name, nameLeft, bodyMidY + 6);
  } else if (firstLast) {
    // Two rows: first name, then last name — each as large as fits.
    let fs = 104;
    for (; fs >= 40; fs -= 2) {
      ctx.font = `800 ${fs}px ${FONT_STACK}`;
      if (
        ctx.measureText(firstLast[0]).width <= nameMaxW &&
        ctx.measureText(firstLast[1]).width <= nameMaxW
      )
        break;
    }
    ctx.font = `800 ${fs}px ${FONT_STACK}`;
    ctx.textBaseline = "alphabetic";
    const lineH = fs * 1.12;
    ctx.fillText(firstLast[0], nameLeft, bodyMidY - lineH / 2 + fs * 0.35);
    ctx.fillText(firstLast[1], nameLeft, bodyMidY + lineH / 2 + fs * 0.35);
  } else {
    // Single unsplittable token too long for one line — shrink to fit.
    const fs = fitOneLine(ctx, name, nameMaxW, 800, 78, 34) || 34;
    ctx.font = `800 ${fs}px ${FONT_STACK}`;
    ctx.textBaseline = "middle";
    ctx.fillText(name, nameLeft, bodyMidY + 6);
  }

  // subtle outer border (drawn last so it sits on top)
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, CARD_W - 2, CARD_H - 2);
}

// Render a volunteer's card to a PNG data URL. `scale` super-samples for crisp
// print output (2 => 600dpi on a 3.5×2in card).
export async function renderCardPng(v: Volunteer, scale = 2): Promise<string> {
  const [logo, qrImg] = await Promise.all([
    loadImage(LOGO_SRC),
    qrPngDataUrl(buildQrPayload(v), 620).then(loadImage),
  ]);
  // Best-effort: wait for web fonts so the canvas uses Inter (falls back fine).
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (document as any).fonts?.ready;
  } catch {
    /* ignore */
  }
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W * scale;
  canvas.height = CARD_H * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.scale(scale, scale);
  drawCard(ctx, {
    logo,
    qr: qrImg,
    name: v.name,
    displayId: formatDisplayId(v.code),
  });
  return canvas.toDataURL("image/png");
}
