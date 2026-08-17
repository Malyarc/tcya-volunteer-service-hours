import { useEffect, useRef, useState } from "react";
import type { Volunteer, VolunteerRole } from "../../types";
import { GRADES } from "../../data/events";
import { createVolunteer, updateVolunteer } from "../../api";
import { formatDisplayId } from "../../qr";
import { useFocusTrap } from "../../useFocusTrap";

interface Props {
  open: boolean;
  volunteer: Volunteer | null; // null => create
  onClose: () => void;
  onSaved: (v: Volunteer, created: boolean) => void;
}

interface FieldRow {
  key: string;
  value: string;
}

export function VolunteerFormModal({ open, volunteer, onClose, onSaved }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [grade, setGrade] = useState("");
  const [role, setRole] = useState<VolunteerRole>("volunteer");
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    setName(volunteer?.name ?? "");
    setEmail(volunteer?.email ?? "");
    setPhone(volunteer?.phone ?? "");
    setGrade(volunteer?.grade ?? "");
    setRole(volunteer?.role === "officer" ? "officer" : "volunteer");
    setFields(
      volunteer
        ? Object.entries(volunteer.customFields || {}).map(([key, value]) => ({
            key,
            value,
          }))
        : []
    );
    setError(null);
  }, [open, volunteer]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function updateField(i: number, patch: Partial<FieldRow>) {
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function addField() {
    setFields((prev) => [...prev, { key: "", value: "" }]);
  }
  function removeField(i: number) {
    setFields((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Please enter a name.");

    // Build customFields, skipping rows with a blank key; last write wins on
    // duplicate keys.
    const customFields: Record<string, string> = {};
    for (const f of fields) {
      const k = f.key.trim();
      if (k) customFields[k] = f.value;
    }

    const payload = {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      grade: grade.trim(),
      role,
      customFields,
    };

    try {
      setSubmitting(true);
      if (volunteer) {
        const saved = await updateVolunteer(volunteer.id, payload);
        onSaved(saved, false);
        return;
      }
      try {
        const saved = await createVolunteer(payload);
        onSaved(saved, true);
      } catch (err) {
        // Duplicate name — offer to add anyway (names key attendance/hours).
        if ((err as { code?: string })?.code === "duplicate_name") {
          // The server message carries the raw code + its own "Add anyway?"; we
          // build our own single, branded prompt instead of echoing it.
          const existingCode = /TCYA-\d{4,}/i.exec((err as Error).message || "")?.[0];
          const idLabel = existingCode ? ` (${formatDisplayId(existingCode)})` : "";
          const proceed = window.confirm(
            `A volunteer named "${payload.name}"${idLabel} already exists.\n\n` +
              `Adding a second volunteer with the same name can mix up their attendance and hours. Add anyway?`
          );
          if (proceed) {
            const saved = await createVolunteer(payload, true);
            onSaved(saved, true);
          } else {
            // Declined — show a plain statement, not the raw dangling question.
            setError(`Not added — a volunteer named "${payload.name}" already exists.`);
          }
        } else {
          throw err;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save volunteer.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={volunteer ? "Edit volunteer" : "Add volunteer"}
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {volunteer ? "Edit Volunteer" : "Add Volunteer"}
            </h2>
            <p className="text-sm text-slate-500">
              {volunteer
                ? `Editing ${volunteer.name} · ${formatDisplayId(volunteer.code)}`
                : "A unique QR code is generated automatically."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost -mr-2" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="max-h-[75vh] overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="v-name">Full Name</label>
              <input id="v-name" type="text" className="input" value={name}
                onChange={(e) => setName(e.target.value)} placeholder="e.g. Aaron Tse" autoFocus />
            </div>
            <div>
              <label className="label" htmlFor="v-email">Email</label>
              <input id="v-email" type="email" className="input" value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
            </div>
            <div>
              <label className="label" htmlFor="v-phone">Phone</label>
              <input id="v-phone" type="tel" className="input" value={phone}
                onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" />
            </div>
            <div>
              <label className="label" htmlFor="v-grade">Grade</label>
              <select id="v-grade" className="input" value={grade} onChange={(e) => setGrade(e.target.value)}>
                <option value="">—</option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>{g} grade</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="v-role">Role</label>
              <select
                id="v-role"
                className="input"
                value={role}
                onChange={(e) => setRole(e.target.value === "officer" ? "officer" : "volunteer")}
              >
                <option value="volunteer">Volunteer</option>
                <option value="officer">Officer</option>
              </select>
              <p className="mt-1.5 text-xs text-slate-500">
                Officers get an <span className="font-semibold text-emerald-700">Officer</span>{" "}
                badge and their hours are <strong>not</strong> capped at an event's
                expected hours — their set-up and clean-up time counts in full.
                Changing this re-calculates their existing hours.
              </p>
            </div>
          </div>

          {/* Custom fields */}
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <label className="label mb-0">Custom Fields (optional)</label>
              <button type="button" onClick={addField}
                className="text-xs font-semibold text-brand-700 hover:text-brand-900">
                + Add field
              </button>
            </div>
            <p className="mb-2 text-xs text-slate-500">
              Anything extra to keep on file — T-shirt size, guardian, allergies…
              Saved with the volunteer and included in the roster export (never on
              the ID card or inside the scannable QR code).
            </p>
            {fields.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-500">
                No custom fields yet.
              </div>
            ) : (
              <div className="space-y-2">
                {fields.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      className="input flex-1"
                      aria-label="Custom field name"
                      placeholder="Field name"
                      value={f.key}
                      onChange={(e) => updateField(i, { key: e.target.value })}
                    />
                    <input
                      type="text"
                      className="input flex-1"
                      aria-label="Custom field value"
                      placeholder="Value"
                      value={f.value}
                      onChange={(e) => updateField(i, { value: e.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() => removeField(i)}
                      className="rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Remove field"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary" disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? "Saving…" : volunteer ? "Save Changes" : "Add Volunteer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
