// Renders a volunteer's QR "ID card" to a PNG on a <canvas>. ONE renderer feeds
// every surface — the on-screen preview, the PNG download, clipboard copy, and
// the single/bulk PDFs — so what you preview is exactly what prints.
//
// Layout matches the chapter's own card design:
//   ┌───────────────────────────────────────────┐
//   │  [lotus]        Tzu Chi Youth Association US │  ← light-blue header band
//   │                       East LA 東洛慈少        │
//   ├───────────────────────────────────────────┤
//   │                                   [ QR ]     │
//   │   Amber Wang                                 │  ← big name (left) + QR (right)
//   │                                ELA-TCYA-001  │  ← branded display ID under QR
//   └───────────────────────────────────────────┘

import type { Volunteer } from "./types";
import { buildQrPayload, qrPngDataUrl, formatDisplayId } from "./qr";

// Logical card canvas: 3.5in × 2in at 300dpi (standard ID-card proportions).
export const CARD_W = 1050;
export const CARD_H = 600;
export const CARD_ASPECT = CARD_W / CARD_H;

const FONT_STACK =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const COLORS = {
  band: "#cfe0f4", // soft "blue sky" 藍天 header
  bandLine: "#b4cbe8",
  border: "#dbe3ec",
  org: "#1f2b45",
  orgBold: "#0f2f55",
  name: "#0b1220",
  id: "#334155",
  qrQuiet: "#ffffff",
};

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

// Fit `text` onto one line within maxWidth by shrinking font from `max` to `min`.
// Returns the chosen px size (min if it never fits).
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
  return min;
}

// Split a name into up to two balanced lines on word boundaries.
function splitTwoLines(name: string): [string] | [string, string] {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return [name];
  // find the split that most evenly balances character counts
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ").length;
    const b = words.slice(i).join(" ").length;
    const diff = Math.abs(a - b);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
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
  const bandH = 196;

  // background + header band
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = COLORS.band;
  ctx.fillRect(0, 0, CARD_W, bandH);
  ctx.fillStyle = COLORS.bandLine;
  ctx.fillRect(0, bandH, CARD_W, 2);

  // logo (left, vertically centered in band)
  drawContain(ctx, logo, 34, 24, 250, bandH - 48, "left");

  // org text (right-aligned)
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLORS.org;
  ctx.font = `500 40px ${FONT_STACK}`;
  ctx.fillText("Tzu Chi Youth Association US", CARD_W - 40, 86);
  ctx.fillStyle = COLORS.orgBold;
  ctx.font = `800 48px ${FONT_STACK}`;
  ctx.fillText("East LA 東洛慈少", CARD_W - 40, 150);

  // QR (bottom-right) on a white quiet zone
  const qrSize = 248;
  const qrX = CARD_W - 44 - qrSize;
  const qrY = bandH + 30;
  ctx.fillStyle = COLORS.qrQuiet;
  ctx.fillRect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 16);
  ctx.drawImage(qr, qrX, qrY, qrSize, qrSize);

  // display ID centered under the QR
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.id;
  ctx.font = `600 30px ${FONT_STACK}`;
  ctx.fillText(displayId, qrX + qrSize / 2, qrY + qrSize + 36);

  // name (left), vertically centered in the white body, fit to width
  const leftPad = 52;
  const nameMaxW = qrX - 24 - leftPad;
  const bodyMidY = bandH + (CARD_H - bandH) / 2;
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.name;

  const oneLineFs = fitOneLine(ctx, name, nameMaxW, 800, 96, 44);
  if (oneLineFs >= 44) {
    ctx.font = `800 ${oneLineFs}px ${FONT_STACK}`;
    ctx.textBaseline = "middle";
    ctx.fillText(name, leftPad, bodyMidY + 4);
  } else {
    // wrap to two balanced lines
    const lines = splitTwoLines(name);
    if (lines.length === 1) {
      ctx.font = `800 44px ${FONT_STACK}`;
      ctx.textBaseline = "middle";
      ctx.fillText(lines[0], leftPad, bodyMidY + 4);
    } else {
      let fs = 72;
      for (; fs >= 30; fs -= 1) {
        ctx.font = `800 ${fs}px ${FONT_STACK}`;
        if (
          ctx.measureText(lines[0]).width <= nameMaxW &&
          ctx.measureText(lines[1]).width <= nameMaxW
        )
          break;
      }
      ctx.font = `800 ${fs}px ${FONT_STACK}`;
      ctx.textBaseline = "alphabetic";
      const lineH = fs * 1.16;
      ctx.fillText(lines[0], leftPad, bodyMidY - lineH / 2 + fs * 0.36);
      ctx.fillText(lines[1], leftPad, bodyMidY + lineH / 2 + fs * 0.36);
    }
  }

  // subtle outer border (drawn last so it sits on top)
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, CARD_W - 2, CARD_H - 2);
}

const LOGO_SRC = "/tzu-chi-logo.png";

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
