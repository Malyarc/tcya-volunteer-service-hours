import { useMemo, useState } from "react";
import type { Volunteer } from "../../types";
import { deleteVolunteer } from "../../api";
import {
  downloadQrIdCardsPdf,
  exportVolunteersExcel,
} from "../../volunteerExports";
import { VolunteerFormModal } from "./VolunteerFormModal";
import { VolunteerQRModal } from "./VolunteerQRModal";
import { Avatar } from "../Avatar";

interface Props {
  volunteers: Volunteer[];
  // Called after any create/update/delete so the parent can re-fetch the
  // authoritative roster + volunteer list (keeps renames/cascades consistent).
  onChanged: () => void;
  onToast: (msg: string) => void;
}

export function VolunteersPanel({ volunteers, onChanged, onToast }: Props) {
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Volunteer | null>(null);
  const [qrVolunteer, setQrVolunteer] = useState<Volunteer | null>(null);
  const [busyBulk, setBusyBulk] = useState<null | "pdf" | "xlsx">(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return volunteers;
    return volunteers.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.code.toLowerCase().includes(q) ||
        (v.email || "").toLowerCase().includes(q) ||
        (v.phone || "").toLowerCase().includes(q)
    );
  }, [volunteers, query]);

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(v: Volunteer) {
    setEditing(v);
    setFormOpen(true);
  }

  async function handleDelete(v: Volunteer) {
    if (
      !window.confirm(
        `Remove ${v.name} (${v.code}) from the roster? Their past event history is kept, but they'll no longer appear in the volunteer list or be scannable.`
      )
    )
      return;
    try {
      await deleteVolunteer(v.id);
      onChanged();
      onToast(`Removed ${v.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove volunteer.");
    }
  }

  async function runBulk(kind: "pdf" | "xlsx") {
    if (volunteers.length === 0) return;
    setBusyBulk(kind);
    setError(null);
    try {
      if (kind === "pdf") await downloadQrIdCardsPdf(volunteers);
      else await exportVolunteersExcel(volunteers);
      onToast(kind === "pdf" ? "QR ID cards PDF downloaded." : "Roster exported.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Export failed. Please try again."
      );
    } finally {
      setBusyBulk(null);
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Volunteers</h2>
            <span className="badge bg-accent-100 text-accent-700">Admin</span>
          </div>
          <p className="text-sm text-slate-500">
            Manage volunteer ID cards & QR codes. {volunteers.length} total.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => runBulk("pdf")}
            className="btn-secondary"
            disabled={busyBulk !== null || volunteers.length === 0}
            title="A printable sheet of QR ID cards"
          >
            {busyBulk === "pdf" ? "Building…" : "QR ID Cards (PDF)"}
          </button>
          <button
            onClick={() => runBulk("xlsx")}
            className="btn-secondary"
            disabled={busyBulk !== null || volunteers.length === 0}
            title="Roster data + QR payloads as a spreadsheet"
          >
            {busyBulk === "xlsx" ? "Exporting…" : "Export Roster (Excel)"}
          </button>
          <button onClick={openAdd} className="btn-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Volunteer
          </button>
        </div>
      </div>

      <div className="px-5 pb-1 pt-3">
        <div className="relative sm:max-w-xs">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search name, code, email, phone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input pl-9"
          />
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50/70">
            <tr>
              <Th>Volunteer</Th>
              <Th>Code</Th>
              <Th className="hidden md:table-cell">Grade</Th>
              <Th className="hidden md:table-cell">Contact</Th>
              <Th className="text-right">QR / Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-500">
                  {volunteers.length === 0
                    ? "No volunteers yet — click Add Volunteer to create one."
                    : "No volunteers match your search."}
                </td>
              </tr>
            )}
            {filtered.map((v) => {
              const fieldCount = Object.keys(v.customFields || {}).length;
              return (
                <tr key={v.id} className="hover:bg-brand-50/30">
                  <td className="whitespace-nowrap px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={v.name} />
                      <div className="font-medium text-slate-900">{v.name}</div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-brand-700">
                    {v.code}
                  </td>
                  <td className="hidden md:table-cell whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {v.grade || "—"}
                  </td>
                  <td className="hidden md:table-cell px-4 py-3 text-sm text-slate-600">
                    <div className="max-w-[220px]">
                      {v.email && <div className="truncate">{v.email}</div>}
                      {v.phone && <div className="truncate text-slate-500">{v.phone}</div>}
                      {!v.email && !v.phone && <span className="text-slate-400">—</span>}
                      {fieldCount > 0 && (
                        <span className="mt-0.5 inline-block badge bg-slate-100 text-slate-500">
                          +{fieldCount} field{fieldCount > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => setQrVolunteer(v)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-2.5 py-1.5 text-xs font-medium text-brand-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50"
                        title="View / copy / send QR ID card"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                          <rect x="3" y="3" width="7" height="7" rx="1" />
                          <rect x="14" y="3" width="7" height="7" rx="1" />
                          <rect x="3" y="14" width="7" height="7" rx="1" />
                          <path d="M14 14h3v3M21 14v.01M14 21h.01M17 21h4v-4" />
                        </svg>
                        QR
                      </button>
                      <IconBtn onClick={() => openEdit(v)} label={`Edit ${v.name}`} title="Edit">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </IconBtn>
                      <IconBtn onClick={() => handleDelete(v)} label={`Delete ${v.name}`} title="Delete" danger>
                        <path d="M18 6 6 18M6 6l12 12" />
                      </IconBtn>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <VolunteerFormModal
        open={formOpen}
        volunteer={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(v, created) => {
          setFormOpen(false);
          onChanged();
          if (created) {
            onToast(`Added ${v.name} (${v.code}).`);
            setQrVolunteer(v); // jump straight to their QR so staff can send it
          } else {
            onToast(`Updated ${v.name}.`);
          }
        }}
      />
      <VolunteerQRModal volunteer={qrVolunteer} onClose={() => setQrVolunteer(null)} />
    </section>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 ${className}`}>
      {children}
    </th>
  );
}

function IconBtn({
  onClick,
  label,
  title,
  danger,
  children,
}: {
  onClick: () => void;
  label: string;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={title}
      className={`rounded-md p-1.5 text-slate-400 transition ${
        danger ? "hover:bg-red-50 hover:text-red-600" : "hover:bg-slate-100 hover:text-slate-700"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        {children}
      </svg>
    </button>
  );
}

