// Generates a one-page volunteer hours certification letter as a PDF, using
// the same wording and layout as the chapter's existing Word template
// (`Certification Hours.docx`):
//
//   [centered green lotus logo]
//   [centered "Tzu Chi Youth Association—East LA Chapter"]
//
//   <download date, right aligned>
//
//   To whom this may concern:
//
//   This is to certify that <NAME> has completed a total of <HOURS> hours
//   of volunteer service hours from <DATE-RANGE>, as a member of the Tzu
//   Chi Youth Association, East LA Chapter.
//
//   <fixed paragraph about TCYA>
//
//   Sincerely,
//   Gratefully Yours,
//
//   <signature image>
//   Carol Lee
//   Program Director (volunteer work)
//   Tzu Chi Youth Association, East LA Chapter
//   Carol_Lee@tzuchi.us
//
// Two entry points:
//   - downloadVolunteerCertificate: cumulative across every counted event
//   - downloadEventCertificate:     one specific event submission

import type { jsPDF } from "jspdf";
import type { Submission } from "./types";
import { displayEventName, formatHours } from "./utils";

const LOGO_URL = "/cert-logo.png";
const SIGNATURE_URL = "/cert-signature.png";

// Cache fetched data URLs across calls so consecutive downloads don't
// re-fetch the same images.
const dataUrlCache = new Map<string, Promise<string>>();

function fetchAsDataUrl(url: string): Promise<string> {
  let cached = dataUrlCache.get(url);
  if (!cached) {
    cached = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load ${url}`);
        return r.blob();
      })
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          })
      );
    dataUrlCache.set(url, cached);
  }
  return cached;
}

function formatLetterDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatYmdLong(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return formatLetterDate(new Date(y, m - 1, d));
}

function safeFileName(name: string): string {
  // Strip filesystem-unsafe characters but keep spaces and apostrophes-as-dash.
  return name.replace(/[\\/:*?"<>|]/g, "").trim();
}

interface BuildArgs {
  volunteerName: string;
  hours: number;
  // Either a single date (single-event certificate) or a date range
  // (cumulative certificate). Already pre-formatted for the letter.
  dateRangeText: string;
}

async function buildCertificatePdf({
  volunteerName,
  hours,
  dateRangeText,
}: BuildArgs): Promise<jsPDF> {
  // Lazy-load jsPDF (and its heavy transitive deps) only when a certificate
  // is actually generated, keeping it out of the initial app bundle.
  const [{ jsPDF }, logoDataUrl, signatureDataUrl] = await Promise.all([
    import("jspdf"),
    fetchAsDataUrl(LOGO_URL),
    fetchAsDataUrl(SIGNATURE_URL),
  ]);

  const doc = new jsPDF({ unit: "in", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 1;
  const contentWidth = pageWidth - marginX * 2;

  // ---------- Header (logo + chapter name, centered) ----------
  const logoWidth = 1.4; // inches
  const logoHeight = 0.79; // matches docx aspect (~1.42 / 0.81)
  // The last two args (alias, compression) enable FLATE compression on the
  // embedded bitmap. jsPDF otherwise stores images as raw pixels, which made
  // the finished PDF ~16 MB for the logo alone.
  doc.addImage(
    logoDataUrl,
    "PNG",
    (pageWidth - logoWidth) / 2,
    0.5,
    logoWidth,
    logoHeight,
    "cert-logo",
    "FAST"
  );

  let y = 0.5 + logoHeight + 0.15;
  doc.setFont("times", "bold");
  doc.setFontSize(13);
  doc.text("Tzu Chi Youth Association—East LA Chapter", pageWidth / 2, y, {
    align: "center",
  });

  y += 0.6;

  // ---------- Date (right-aligned) ----------
  const today = formatLetterDate(new Date());
  doc.setFont("times", "normal");
  doc.setFontSize(12);
  doc.text(today, pageWidth - marginX, y, { align: "right" });

  y += 0.45;

  // ---------- Salutation ----------
  doc.text("To whom this may concern:", marginX, y);
  y += 0.35;

  // ---------- Certification sentence ----------
  // Build the certification line with the volunteer name in bold so it
  // visually reads as a filled-in form.
  const hoursStr = formatHours(hours);
  const beforeName = "This is to certify that ";
  const afterName =
    " has completed a total of " +
    hoursStr +
    " hours of volunteer service hours from " +
    dateRangeText +
    ", as a member of the Tzu Chi Youth Association, East LA Chapter.";

  // jsPDF doesn't have a built-in mixed-styling line wrapper, so split
  // the sentence into two segments and let `splitTextToSize` re-wrap each.
  const fullSentence = beforeName + volunteerName + afterName;
  const wrapped = doc.splitTextToSize(fullSentence, contentWidth);
  doc.text(wrapped, marginX, y);
  y += wrapped.length * 0.22;

  y += 0.2;

  // ---------- TCYA explanatory paragraph ----------
  const para =
    "Tzu Chi Youth Association (TCYA), a subsidiary of Tzu Chi USA, is a " +
    "service-learning program for youth in 7th to 12th grade. Led by a " +
    "group of dedicated Tzu Chi volunteers and student officers, the " +
    "program focuses on teaching theories such as environmental " +
    "protection first, then providing volunteer opportunities within " +
    "Tzu Chi programs. TCYA is committed to cultivating love and " +
    "compassion in our youth to make the world a better place.";
  const paraLines = doc.splitTextToSize(para, contentWidth);
  doc.text(paraLines, marginX, y);
  y += paraLines.length * 0.22;

  y += 0.35;

  // ---------- Closing ----------
  doc.text("Sincerely,", marginX, y);
  y += 0.22;
  doc.text("Gratefully Yours,", marginX, y);
  y += 0.18;

  // Signature
  const sigWidth = 1.6;
  const sigHeight = (113 / 466) * sigWidth; // preserve aspect from source PNG
  doc.addImage(
    signatureDataUrl,
    "PNG",
    marginX,
    y,
    sigWidth,
    sigHeight,
    "cert-signature",
    "FAST"
  );
  y += sigHeight + 0.1;

  doc.text("Carol Lee", marginX, y);
  y += 0.22;
  doc.text("Program Director (volunteer work)", marginX, y);
  y += 0.22;
  doc.text("Tzu Chi Youth Association, East LA Chapter", marginX, y);
  y += 0.22;
  doc.setTextColor(40, 80, 200);
  doc.textWithLink("Carol_Lee@tzuchi.us", marginX, y, {
    url: "mailto:Carol_Lee@tzuchi.us",
  });
  doc.setTextColor(0, 0, 0);

  return doc;
}

export async function downloadVolunteerCertificate(
  volunteerName: string,
  totalHours: number,
  submissions: Submission[]
): Promise<void> {
  // Compute the date range from the volunteer's earliest counted event to
  // their latest. If there's only one date or none, fall back accordingly.
  const dates = submissions.map((s) => s.eventDate).filter(Boolean).sort();
  let dateRangeText = "";
  if (dates.length === 0) {
    dateRangeText = formatLetterDate(new Date());
  } else if (dates.length === 1 || dates[0] === dates[dates.length - 1]) {
    dateRangeText = formatYmdLong(dates[0]);
  } else {
    dateRangeText = `${formatYmdLong(dates[0])} to ${formatYmdLong(
      dates[dates.length - 1]
    )}`;
  }

  const doc = await buildCertificatePdf({
    volunteerName,
    hours: totalHours,
    dateRangeText,
  });
  doc.save(`Certification Hours - ${safeFileName(volunteerName)}.pdf`);
}

export async function downloadEventCertificate(
  volunteerName: string,
  submission: Submission
): Promise<void> {
  const doc = await buildCertificatePdf({
    volunteerName,
    hours: submission.hours,
    dateRangeText: formatYmdLong(submission.eventDate),
  });
  const eventLabel = displayEventName(submission);
  doc.save(
    `Certification Hours - ${safeFileName(volunteerName)} - ${safeFileName(
      eventLabel
    )}.pdf`
  );
}
