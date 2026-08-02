// Bulk QR / roster deliverables for staff:
//   - downloadQrIdCardsPdf: a printable sheet of the new QR "ID cards".
//   - exportVolunteersExcel: the roster data (contact info + QR payload text)
//     as a spreadsheet for records.
//   - downloadIdCardPng / downloadIdCardPdf: single-volunteer variants.
//
// Every card image comes from the ONE renderer in cardRenderer.ts, so the
// printed cards are pixel-identical to the on-screen preview. The heavy jspdf /
// xlsx libraries are dynamically imported on demand.

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

// ---------- Bulk printable sheet of cards ----------

export async function downloadQrIdCardsPdf(volunteers: Volunteer[]) {
  const { jsPDF } = await import("jspdf");
  // Render every card up-front (QR + canvas) so the PDF loop is pure layout.
  const cards = await Promise.all(
    volunteers.map(async (v) => ({ v, png: await renderCardPng(v) }))
  );

  const doc = new jsPDF({ unit: "in", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const margin = 0.4;
  const cols = 2;
  const gapX = 0.3;
  const rowGap = 0.3;
  const cardW = (pageW - margin * 2 - gapX * (cols - 1)) / cols;
  const cardH = cardW / CARD_ASPECT;
  const perCol = Math.max(
    1,
    Math.floor((pageH - margin * 2 + rowGap) / (cardH + rowGap))
  );
  const perPage = cols * perCol;

  cards.forEach(({ png }, i) => {
    const onPage = i % perPage;
    if (i > 0 && onPage === 0) doc.addPage();
    const col = onPage % cols;
    const row = Math.floor(onPage / cols);
    const x = margin + col * (cardW + gapX);
    const y = margin + row * (cardH + rowGap);
    doc.addImage(png, "PNG", x, y, cardW, cardH, undefined, "FAST");
  });

  doc.save(`volunteer-qr-id-cards-${todayYmd()}.pdf`);
}
