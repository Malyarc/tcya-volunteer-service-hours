// Bulk QR / roster deliverables for staff:
//   - downloadQrIdCardsPdf: a printable sheet of QR "ID cards" (the images to
//     hand out) — the best medium for QR codes.
//   - exportVolunteersExcel: the roster data (contact info + QR payload text)
//     as a spreadsheet for records.
//   - downloadVolunteerQrPng / downloadIdCardPdf: single-volunteer variants.
//
// Both heavy libraries (jspdf, xlsx) are dynamically imported on demand.

import type { Volunteer } from "./types";
import { buildQrPayload, qrPngDataUrl, safeFileName, dataUrlToBlob } from "./qr";
import { todayYmd } from "./utils";

const ORG = "Tzu Chi Youth Association — East LA";

// ---------- Excel roster ----------

// Pure builder (no IO) so the column layout is unit-testable. Every custom
// field key becomes its own column; the QR payload text is appended last.
export function buildRosterSheetData(volunteers: Volunteer[]): {
  rows: Record<string, string>[];
  customKeys: string[];
} {
  const customKeys = Array.from(
    new Set(volunteers.flatMap((v) => Object.keys(v.customFields || {})))
  ).sort();
  const rows = volunteers.map((v) => {
    const row: Record<string, string> = {
      Code: v.code,
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
      : [{ Code: "", Name: "", Grade: "", Email: "", Phone: "", "QR Payload": "" }]
  );
  sheet["!cols"] = [
    { wch: 12 },
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

// ---------- PDF ID cards ----------

interface CardData {
  v: Volunteer;
  qr: string; // PNG data URL
}

async function buildCards(volunteers: Volunteer[]): Promise<CardData[]> {
  return Promise.all(
    volunteers.map(async (v) => ({ v, qr: await qrPngDataUrl(buildQrPayload(v), 320) }))
  );
}

function drawCard(doc: any, c: CardData, x: number, y: number, w: number, h: number) {
  const pad = 0.16;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.01);
  doc.roundedRect(x, y, w, h, 0.08, 0.08);

  // QR on the right
  const qrSize = h - pad * 2;
  const qrX = x + w - pad - qrSize;
  const qrY = y + pad;
  doc.addImage(c.qr, "PNG", qrX, qrY, qrSize, qrSize, undefined, "FAST");

  // Text block on the left
  const tx = x + pad;
  let ty = y + pad + 0.14;
  const textW = qrX - tx - 0.1;

  doc.setTextColor(120, 120, 120);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.text(ORG, tx, ty);
  ty += 0.22;

  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  const nameLines = doc.splitTextToSize(c.v.name, textW);
  doc.text(nameLines.slice(0, 2), tx, ty);
  ty += 0.2 * Math.min(nameLines.length, 2) + 0.02;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(37, 99, 235);
  doc.text(c.v.code, tx, ty);
  ty += 0.2;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const lines: string[] = [];
  if (c.v.grade) lines.push(`Grade: ${c.v.grade}`);
  if (c.v.phone) lines.push(c.v.phone);
  if (c.v.email) lines.push(c.v.email);
  // Custom fields print as visible text here (they are intentionally NOT in the
  // QR — see qr.ts). Keep the card readable by capping how many show.
  for (const [k, val] of Object.entries(c.v.customFields || {}).slice(0, 2)) {
    if (val) lines.push(`${k}: ${val}`);
  }
  for (const line of lines.slice(0, 5)) {
    const wrapped = doc.splitTextToSize(line, textW);
    doc.text(wrapped.slice(0, 1), tx, ty);
    ty += 0.16;
  }
}

export async function downloadQrIdCardsPdf(volunteers: Volunteer[]) {
  const { jsPDF } = await import("jspdf");
  const cards = await buildCards(volunteers);
  const doc = new jsPDF({ unit: "in", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const margin = 0.4;
  const cols = 2;
  const gap = 0.25;
  const cardW = (pageW - margin * 2 - gap * (cols - 1)) / cols;
  const cardH = 1.9;
  const rowGap = 0.22;
  const perCol = Math.floor((pageH - margin * 2 + rowGap) / (cardH + rowGap));
  const perPage = cols * perCol;

  cards.forEach((c, i) => {
    const onPage = i % perPage;
    if (i > 0 && onPage === 0) doc.addPage();
    const col = onPage % cols;
    const row = Math.floor(onPage / cols);
    const x = margin + col * (cardW + gap);
    const y = margin + row * (cardH + rowGap);
    drawCard(doc, c, x, y, cardW, cardH);
  });

  doc.save(`volunteer-qr-id-cards-${todayYmd()}.pdf`);
}

export async function downloadIdCardPdf(v: Volunteer) {
  const { jsPDF } = await import("jspdf");
  const qr = await qrPngDataUrl(buildQrPayload(v), 512);
  const doc = new jsPDF({ unit: "in", format: [3.5, 2.2] });
  drawCard(doc, { v, qr }, 0.05, 0.05, 3.4, 2.1);
  doc.save(`qr-id-card-${safeFileName(v.name)}.pdf`);
}

// ---------- Single QR PNG download ----------

export async function downloadVolunteerQrPng(v: Volunteer) {
  const dataUrl = await qrPngDataUrl(buildQrPayload(v), 640);
  const blob = dataUrlToBlob(dataUrl);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `qr-${safeFileName(v.name)}-${v.code}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
