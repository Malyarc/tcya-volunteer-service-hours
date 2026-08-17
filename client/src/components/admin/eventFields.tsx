// The event schedule fields — Date, Start Time, End Time, Expected Volunteer
// Hours — in that fixed order.
//
// Defined once and reused by the create-event form, the Events page's inline
// row editor and the event's own page, so the order, labels, validation and
// help text are guaranteed to match everywhere an admin meets them.

// An event's expectedHours (number | null) as an <input type="number"> value.
export function expectedHoursToInput(v: number | null | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}

// The inverse. Blank means "no cap"; anything unparseable is reported so the
// caller can refuse to save rather than silently clearing an existing cap.
export function parseExpectedHoursInput(
  raw: string
): { ok: true; value: number | null } | { ok: false; error: string } {
  const s = raw.trim();
  if (s === "") return { ok: true, value: null };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 24) {
    return { ok: false, error: "Expected hours must be between 0 and 24." };
  }
  return { ok: true, value: Math.round(n * 4) / 4 };
}

export interface EventScheduleValues {
  date: string;
  startTime: string;
  endTime: string;
  expectedHours: string;
}

export function EventScheduleFields({
  values,
  onChange,
  idPrefix,
  disabled = false,
}: {
  values: EventScheduleValues;
  onChange: (patch: Partial<EventScheduleValues>) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="col-span-2 sm:col-span-1">
        <label className="label" htmlFor={`${idPrefix}-date`}>
          Date
        </label>
        <input
          id={`${idPrefix}-date`}
          type="date"
          className="input"
          value={values.date}
          disabled={disabled}
          onChange={(e) => onChange({ date: e.target.value })}
        />
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-start`}>
          Start Time
        </label>
        <input
          id={`${idPrefix}-start`}
          type="time"
          className="input"
          value={values.startTime}
          disabled={disabled}
          onChange={(e) => onChange({ startTime: e.target.value })}
        />
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-end`}>
          End Time
        </label>
        <input
          id={`${idPrefix}-end`}
          type="time"
          className="input"
          value={values.endTime}
          disabled={disabled}
          onChange={(e) => onChange({ endTime: e.target.value })}
        />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <label className="label" htmlFor={`${idPrefix}-expected`}>
          Expected Hours
        </label>
        <input
          id={`${idPrefix}-expected`}
          type="number"
          inputMode="decimal"
          min="0"
          max="24"
          step="0.25"
          placeholder="No cap"
          className="input"
          value={values.expectedHours}
          disabled={disabled}
          onChange={(e) => onChange({ expectedHours: e.target.value })}
        />
      </div>
    </div>
  );
}

// The one-line explanation of what Expected Hours actually does. Shown wherever
// the field is editable so nobody has to guess whether it is a schedule note or
// a rule (it is a rule).
export function ExpectedHoursHint() {
  return (
    <p className="mt-2 text-xs text-slate-500">
      <span className="font-semibold text-slate-600">Expected Hours</span> caps
      what an ordinary volunteer can be credited for this event, no matter how
      early they check in. Leave it blank for no cap.{" "}
      <span className="font-semibold text-emerald-700">Officers are never capped</span>{" "}
      — their set-up and clean-up time counts in full.
    </p>
  );
}
