// Bulk QR / roster deliverables for staff:
//   - downloadQrIdCardsPdf: a printable sheet of the new QR "ID cards".
//   - exportVolunteersExcel: the roster data (contact info + QR payload text)
//     as a spreadsheet for records.
//   - downloadIdCardPng / downloadIdCardPdf: single-volunteer variants.
//
// Every card image comes from the ONE renderer in cardRenderer.ts, so the
// printed cards are pixel-identical to the on-screen preview. The heavy jspdf /
// xlsx libraries are dynamically imported on demand.

import type { jsPDF } from "jspdf";
import type { Volunteer } from "./types";
import {
  buildQrPayload,
  safeFileName,
  dataUrlToBlob,
  formatDisplayId,
} from "./qr";
import { renderCardPng, CARD_ASPECT } from "./cardRenderer";
import { todayYmd } from "./utils";

// ---------- Excel roster ----------

// Pure builder (no IO) so the column layout is unit-testable. Every custom
// field key becomes its own column; the QR payload text is appended last. The
// visible ID is the branded display form ("ELA-TCYA-001"); the canonical code
// still lives inside the QR payload JSON.
export function buildRosterSheetData(volunteers: Volunteer[]): {
  rows: Record<string, string>[];
  customKeys: string[];
} {
  const customKeys = Array.from(
    new Set(volunteers.flatMap((v) => Object.keys(v.customFields || {})))
  ).sort();
  const rows = volunteers.map((v) => {
    const row: Record<string, string> = {
      ID: formatDisplayId(v.code),
      Name: v.name,
      Grade: v.grade || "",
      Email: v.email || "",
      Phone: v.phone || "",
    };
    for (const k of customKeys) row[k] = v.customFields?.[k] ?? "";
    row["QR Payload"] = buildQrPayload(v);
    return row;
  });
  return { rows, customKeys };
}

export async function exportVolunteersExcel(volunteers: Volunteer[]) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  const { rows, customKeys } = buildRosterSheetData(volunteers);

  const sheet = XLSX.utils.json_to_sheet(
    rows.length
      ? rows
      : [{ ID: "", Name: "", Grade: "", Email: "", Phone: "", "QR Payload": "" }]
  );
  sheet["!cols"] = [
    { wch: 14 },
    { wch: 26 },
    { wch: 8 },
    { wch: 26 },
    { wch: 16 },
    ...customKeys.map(() => ({ wch: 16 })),
    { wch: 60 },
  ];
  XLSX.utils.book_append_sheet(wb, sheet, "Volunteers");
  XLSX.writeFile(wb, `volunteer-roster-${todayYmd()}.xlsx`);
}

// ---------- Single-volunteer card (PNG / PDF) ----------

// The full ID-card image as a PNG data URL (used by the modal preview, copy,
// and download). Re-exported so callers don't need to know about the renderer.
export function cardPngDataUrl(v: Volunteer): Promise<string> {
  return renderCardPng(v);
}

export async function downloadIdCardPng(v: Volunteer) {
  const dataUrl = await renderCardPng(v);
  const blob = dataUrlToBlob(dataUrl);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `id-card-${safeFileName(v.name)}-${formatDisplayId(v.code)}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadIdCardPdf(v: Volunteer) {
  const { jsPDF } = await import("jspdf");
  const png = await renderCardPng(v);
  // Standard 3.5in × 2in card.
  const doc = new jsPDF({ unit: "in", format: [3.5, 2] });
  doc.addImage(png, "PNG", 0, 0, 3.5, 2, undefined, "FAST");
  doc.save(`id-card-${safeFileName(v.name)}.pdf`);
}

// ---------- Bulk printable sheet of cards (Avery 74461 clip-style badges) ----------

// Avery 74461 "Name Badges with Clips" — 8 perforated inserts per US-Letter sheet,
// laid out 2 columns × 4 rows. Each insert is 3.5" × 2.21875"; the columns start
// 0.75" and 4.25" from the left and the rows 1.0625" / 3.28125" / 5.5" / 7.71875"
// from the top. The cells tile edge-to-edge with symmetric 0.75" side margins and
// ~1.06" top/bottom margins. These numbers are read straight off Avery's own
// template PDF (612×792pt letter, rectangles at 252×159.75pt), so a printed sheet
// drops into the physical badge holders with no manual nudging.
export const AVERY_74461 = {
  pageW: 8.5,
  pageH: 11,
  cols: 2,
  colLeftsIn: [0.75, 4.25],
  rowTopsIn: [1.0625, 3.28125, 5.5, 7.71875],
  cellWIn: 3.5,
  cellHIn: 2.21875,
} as const;

export interface CardPlacement {
  page: number; // 0-based sheet index
  x: number; // inches from the left of the page
  y: number; // inches from the top of the page
  w: number; // inches
  h: number; // inches
}

// Pure layout: where each of `count` cards lands on the Avery 74461 sheet(s).
// The card art is 3.5"×2" (CARD_ASPECT), so it fills each cell's full 3.5" width
// and is centered vertically in the slightly taller cell — the design sits inside
// the badge-holder window and the ~0.11" top/bottom slack tucks under the frame.
// Kept pure (no canvas/jsPDF) so the geometry is unit-testable against the
// template coordinates above.
export function avery74461Placements(count: number): CardPlacement[] {
  const { cols, colLeftsIn, rowTopsIn, cellWIn, cellHIn } = AVERY_74461;
  const perPage = cols * rowTopsIn.length;
  const w = cellWIn;
  const h = w / CARD_ASPECT;
  const yInset = Math.max(0, (cellHIn - h) / 2);

  const out: CardPlacement[] = [];
  for (let i = 0; i < count; i += 1) {
    const onPage = i % perPage;
    out.push({
      page: Math.floor(i / perPage),
      x: colLeftsIn[onPage % cols],
      y: rowTopsIn[Math.floor(onPage / cols)] + yInset,
      w,
      h,
    });
  }
  return out;
}

// Build the multi-page Avery sheet as a jsPDF doc (no IO). Exposed so the same
// bytes can be previewed/verified without triggering a browser download.
export async function buildQrIdCardsPdf(volunteers: Volunteer[]): Promise<jsPDF> {
  const { jsPDF } = await import("jspdf");
  // Render every card up-front (QR + canvas) so the PDF loop is pure layout.
  const pngs = await Promise.all(volunteers.map((v) => renderCardPng(v)));
  const places = avery74461Placements(pngs.length);

  const doc = new jsPDF({ unit: "in", format: "letter" });
  let curPage = 0;
  pngs.forEach((png, i) => {
    const p = places[i];
    if (p.page > curPage) {
      doc.addPage();
      curPage = p.page;
    }
    doc.addImage(png, "PNG", p.x, p.y, p.w, p.h, undefined, "FAST");
  });
  return doc;
}

export async function downloadQrIdCardsPdf(volunteers: Volunteer[]) {
  const doc = await buildQrIdCardsPdf(volunteers);
  doc.save(`volunteer-qr-id-cards-${todayYmd()}.pdf`);
}
