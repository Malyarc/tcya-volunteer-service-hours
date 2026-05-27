import * as XLSX from "xlsx";
import type { VolunteerSummary } from "../utils";
import { displayEventName, formatHours } from "../utils";

interface Props {
  summaries: VolunteerSummary[];
}

export function ExportButton({ summaries }: Props) {
  function handleExport() {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary - one row per volunteer with cumulative hours.
    const summaryRows = summaries.map((s) => ({
      "Volunteer Name": s.name,
      Grade: s.latestGrade,
      "Total Submissions": s.submissions.length,
      "Total Hours": s.totalHours,
    }));
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    summarySheet["!cols"] = [
      { wch: 28 },
      { wch: 8 },
      { wch: 18 },
      { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

    // Sheet 2: All submissions, flat for filtering/sorting in Excel.
    const detailRows = summaries.flatMap((s) =>
      s.submissions.map((sub) => ({
        "Volunteer Name": s.name,
        Grade: sub.grade,
        Date: sub.eventDate,
        Event: displayEventName(sub),
        "Sign In": sub.arrivalTime,
        "Sign Out": sub.endTime,
        Hours: sub.hours,
        Comments: sub.comments,
        "Submitted At": sub.submittedAt,
      }))
    );
    const detailSheet = XLSX.utils.json_to_sheet(
      detailRows.length
        ? detailRows
        : [
            {
              "Volunteer Name": "",
              Grade: "",
              Date: "",
              Event: "",
              "Sign In": "",
              "Sign Out": "",
              Hours: "",
              Comments: "",
              "Submitted At": "",
            },
          ]
    );
    detailSheet["!cols"] = [
      { wch: 28 },
      { wch: 8 },
      { wch: 12 },
      { wch: 50 },
      { wch: 10 },
      { wch: 10 },
      { wch: 8 },
      { wch: 40 },
      { wch: 22 },
    ];
    XLSX.utils.book_append_sheet(wb, detailSheet, "Confirmed Submissions");

    // Sheet 3: Per-volunteer breakdown that mirrors the home page layout.
    const byVolunteerRows: Array<Record<string, string | number>> = [];
    for (const s of summaries) {
      byVolunteerRows.push({
        "Volunteer Name": s.name,
        Grade: s.latestGrade,
        Date: "",
        Event: "— Cumulative Total —",
        "Sign In": "",
        "Sign Out": "",
        Hours: s.totalHours,
        Comments: "",
      });
      for (const sub of s.submissions) {
        byVolunteerRows.push({
          "Volunteer Name": "",
          Grade: sub.grade,
          Date: sub.eventDate,
          Event: displayEventName(sub),
          "Sign In": sub.arrivalTime,
          "Sign Out": sub.endTime,
          Hours: sub.hours,
          Comments: sub.comments,
        });
      }
      byVolunteerRows.push({
        "Volunteer Name": "",
        Grade: "",
        Date: "",
        Event: "",
        "Sign In": "",
        "Sign Out": "",
        Hours: "",
        Comments: "",
      });
    }
    const byVolunteerSheet = XLSX.utils.json_to_sheet(byVolunteerRows);
    byVolunteerSheet["!cols"] = [
      { wch: 28 },
      { wch: 8 },
      { wch: 12 },
      { wch: 50 },
      { wch: 10 },
      { wch: 10 },
      { wch: 8 },
      { wch: 40 },
    ];
    XLSX.utils.book_append_sheet(wb, byVolunteerSheet, "By Volunteer");

    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `volunteer-hours-${stamp}.xlsx`);
  }

  const totalHours = summaries.reduce((a, s) => a + s.totalHours, 0);

  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <button
        type="button"
        onClick={handleExport}
        className="btn-primary px-6 py-3 text-base shadow-md"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Download Excel Report
      </button>
      <p className="text-xs text-slate-500">
        Summary, confirmed submissions, and per-volunteer breakdown — only
        entries where both staff check-in and volunteer check-out are green
        ({formatHours(totalHours)} cumulative hours).
      </p>
    </div>
  );
}
