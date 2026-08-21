# Handoff — ELA TCYA Volunteer Service Hours

Single source of truth for the project's current state. Last updated: 2026-08-20.

## Round 10 (latest) — TC Academy badges + auto-calculated hours

### 1. A second badge: TC Academy

Six chapter-named students now carry a light-blue **TC Academy** badge beside
their name, on every page a name appears: the public roster, the admin roster,
the Volunteers tab, the strike watchlist and an event's attendance list (admin
AND officer). Four of the six are also Officers, so their rows carry both.

- `client/src/badges.ts` is the hard-coded list. Names match NORMALIZED (trim,
  collapse inner whitespace, case-fold), and an entry can carry `alsoSpelled`
  variants.
- **The roster spells one of them "Issac Cao"; the chapter wrote "Isaac".** Both
  spellings badge, so it is right today and stays right if the roster is fixed.
  This was caught by checking the six names against the live roster rather than
  trusting them — a mismatched name is a SILENT no-op.
- Because silence is the failure mode, `tcAcademyNamesMissingFrom` shows an
  amber note in the Volunteers panel naming any badge entry that matches nobody.
  Invisible in the healthy state.
- `VolunteerBadges` renders Officer + TC Academy as a FRAGMENT, so both become
  direct children of the caller's existing flex name row. Measured live: equal
  badge heights, identical 6px name→badge and badge→badge gaps, 0px vertical
  offset from the name.

### 2. Hours are calculated and filled in as the admin types

Editing an attendee's times now shows a read-only **"Hours (auto)"** field that
fills in the moment both times are set, plus a line saying "3 hrs will be
credited to <name> when you save" — and, when the event's cap bites, "6 hrs on
site, capped at this event's expected hours for ordinary volunteers".

- The attendance table also gained an **Hours** column, so credited hours are
  visible per person without opening the editor. It shows an em dash while a row
  is incomplete (checked in but not out is the normal mid-event state) and an
  amber "capped" tag when the cap applied — the same treatment the roster uses.
- `deriveHours` / `hoursBetweenIso` / `creditedHoursFor` in `utils.ts` mirror
  `server/src/hours.js` exactly (invariant 1e). DISPLAY only — the server still
  owns the number and re-derives on save. `utils.test.ts` pins the SAME cases as
  `server/test/hours.test.js` so a drift fails the bar.
- Saving times now also calls `onHoursChanged()`, so the roster totals update
  immediately instead of staying stale until the admin navigates back.

### 3. Table alignment pass

- Every table audited in the browser, comparing each column's computed header
  alignment against its cells'. Fixed: the roster's Events count (left-aligned
  under a left header while the two other numeric columns were right/centre) is
  now centred with `tabular-nums`, hours figures are `tabular-nums` so digits
  stack, and the trailing chevron header now matches its cells.
- Event page: the Check-in/Check-out headings no longer break mid-word
  ("CHECK-" / "OUT"), and the attendance table gets more of the row
  (`2.1fr` vs `1.6fr`) now that it carries a sixth column.
- **Every colSpan on the event page derives from one `COLUMN_COUNT(readOnly)`**,
  so adding a column can't leave the empty state or the open editor spanning the
  wrong width — the exact bug the new Hours column would otherwise have caused.
- **Public roster now fits a 375px phone** (was 462px in a 341px wrapper, i.e.
  121px of sideways scroll — pre-existing, and measured to confirm the new badge
  added 0px). Achieved by shortening the "Total Hours" heading to "Hours" on
  phones, hiding the almost-always-empty Strikes column below `sm` (as Grade,
  Events and Certificate already were), tightening the chevron column, and
  letting a long name wrap on phones only.

### Verified

Green bar with exit codes captured: server memory **107 pass**, live-Postgres
parity **188 pass**, client **91 pass** (was 60 — 31 new), build clean.
**Adversarially audited**: 7 mutations (unrounded hours, cap removed, officer
exemption removed, reversed times counted as complete, a badge name dropped, the
Issac/Isaac alias removed, whitespace normalization removed) — each caught.
Run live at 1280px and 375px as admin AND officer: badges render on every
surface, the editor auto-filled 3 hrs → 0.25 hrs for 22 min → "—" for reversed
times → 4 hrs capped from 6, and the saved value matched the promise exactly
(server credited 3 where the editor showed 3). Roster header total updated
13.5 → 16.5 on save without navigating.

## Round 9 — officers can record conduct strikes

The chapter's ask: the officer at the door is the person who actually sees the
conduct, so make the strike theirs to record instead of something they have to
report to an admin afterwards. Officers now hold exactly TWO capabilities —
scan in/out, and strike — and nothing else moved.

### The route

`PATCH /events/:id/attendance/strikes` under `requireScanner` (admin OR officer).
Body: `{ volunteerName, strikes }`. It is deliberately its OWN route rather than
a relaxation of the admin `PATCH /events/:id/attendance`:

- This handler **can only ever write `strikes`** — it never reads a time, a flag
  or a name off the body. An officer's reach therefore cannot widen the day
  someone adds a field to the general attendance patch. The suite proves it by
  POSTing `checkinAt` / `checkoutAt` / `staffCheckin` / `volunteerCheckout`
  alongside a strike and asserting every one of them was ignored.
- The general attendance PATCH stays **admin-only** and still 403s an officer,
  including a payload that pairs a legal strike with a forged `checkinAt`.
- Officers read the event back through `officerEvent`, so a strike response
  can't hand them the QR codes `GET /events` withheld.
- 404s tell "no such event" apart from "that volunteer isn't on this one" — an
  officer staring at the event while being told "Event not found" would read it
  as deleted.
- Admins use the SAME route (`setAttendanceStrikes` in `api.ts` is the only
  strike path in the client), so the officer branch is exercised on every
  strike rather than being a rarely-trodden one.

### Bug found and fixed while doing it

`parseStrikes` used bare `Number()`, so `strikes: null`, `false`, `""` or `[]`
all coerced to 0 and **silently cleared a recorded strike** with a 200, and
`true` invented one — directly contradicting the comment promising a malformed
value is rejected loudly. It now accepts only a real number or a numeric string.
Both strike routes share the helper; regression-tested on both stores.

### UI

`EventDetailPage` now keeps two separate flags: `readOnly` (officer — no event,
roster or time editing) and `canRecordStrikes` (admin OR officer). The Strike
column is a real `<button>` with `aria-pressed` for both roles; check-in and
check-out stay non-interactive `<span role="img">` status lights for officers.
The "clear N strikes?" confirm applies to officers too. Copy updated in four
places (sign-in modal blurb, Events page officer subtitle, the event note, the
attendance-list subtitle).

### Verified

Green bar with exit codes captured: server memory **107 pass**, **live-Postgres
parity 188 pass** (local `postgres:17` + Neon-HTTP proxy), client **60 pass**,
`tsc -b && vite build` clean. **Adversarially audited** — five mutations
(officer locked out of the route, route also writing `checkinAt`, `parseStrikes`
reverted to bare `Number()`, officer response left unprojected, general PATCH
opened to officers) each caught by the suite. Run live as an officer at 1280 px
and at 375 px mobile: strike recorded (`PATCH …/strikes → 200`, response carries
no `code`/`volunteerId`), persisted across reload, cleared by tap, multi-strike
confirm shown and honored on cancel, hours and times untouched, no console
errors, no page overflow at 150 % root text.

## Round 8 — a separate Officer login, plus a reorderable Events page

Three chapter-requested changes, one commit. Green bar: server memory **103
pass**, **live-Postgres parity 180 pass**, client **60 pass**, build clean —
every exit code captured. Verified live in the running app (admin AND officer,
1280 px and 390 px).

### 1. Two accounts instead of one

`server/src/accounts.js` now owns both sign-ins. **Admin `0314`** does everything
it did before. **Officer `1013`** can do exactly one privileged thing: open an
event an admin already created and check volunteers in / out by scanning their
QR code.

- `/login` returns `{token, role}`; the two tokens are HMACs with distinct
  derivation prefixes, so the passcodes are not interchangeable (proved in the
  suite). `/session` reports `{admin, officer, role}`.
- `requireScanner` (admin OR officer) guards ONLY `POST /events/:id/checkin` and
  `/checkout`. Everything else keeps `requireAdmin`, which answers an officer
  **403** — deliberately not 401, because the client clears its token on a 401
  and that would sign an officer out mid-event.
- Officers never receive QR codes, volunteer ids, emails or phone numbers:
  `officerEvent` / `officerAttendance` / `officerVolunteer` project every
  response they can reach. They DO see check-in/out times — they run the door.
- UI: green **Officer** badge, only Roster + Events tabs, a read-only Events page
  (no create / edit / reorder), a read-only event page whose only controls are
  Back, Sign Out and **Scan QR**, and a camera-only scanner — the typed-ID and
  pick-a-name fallbacks are admin tools, since they check someone in without
  their card present.
- **The passcodes now live in the repo, not in deploy config.** The chapter chose
  this so a redeploy is the only step to rotate them and nothing has to be set in
  Netlify; a stale `ADMIN_PASSWORD` in the site environment is deliberately
  ignored. They are 4-digit shared codes in a PUBLIC repo — a "who's holding the
  iPad" control, not a secret. To rotate: edit `accounts.js`, redeploy.

### 2. Events page — no dropdown where there is nothing to drop down

A section with a single date renders as a plain heading: no chevron, nothing to
click that does nothing. `isCollapsibleGroup` in `utils.ts` is the single rule,
shared by the page and its tests. Sections with 2+ dates collapse as before, and
"Collapse all" now only counts the sections that can actually collapse.

### 3. Admins can set the order of the event list, permanently

Drag a section by its handle, or use the up/down arrows (which is what works on a
phone and with a keyboard). The order is saved server-side in a new `event_order`
table and is the same for everyone, including officers and a fresh browser.

- `GET /event-order` (public read) / `PUT /event-order` (admin) — the PUT replaces
  the whole order, so renamed or deleted sections are pruned rather than piling up.
- `sortEventGroups` puts placed sections first in the saved order and leaves
  everything else in the automatic order BELOW it, so a brand-new event type can
  never be hidden by a stale order.
- Saving is optimistic and rolls back with an error banner if the request fails.
  "Reset order" clears it back to automatic. Reordering is hidden while a search
  is filtering the list (saving a filtered subset would drop the rest).
- `exportAll`/`importAll` round-trip the order by category, and `reset()` clears
  it along with the events. Both stores implement it identically.

## Round 7 — officers + hours cap, strikes, Events redesign, scan flash

Five chapter-requested features, shipped in ONE commit (Netlify bills per build).
Green bar: server memory **91 pass**, **live-Postgres parity 156 pass**, client
**45 pass**, build clean. Verified live in the running app at 390 / 640 / 768 /
1280 px.

### 1. Big animated check + chime on every scan

`components/admin/ScanFlash.tsx` takes over the whole scanner sheet for ~1s
after each scan: a pop-in green disc with a drawn checkmark, the volunteer's
NAME as the headline, and "Checked in · 3:45 PM" beneath. Tap anywhere to
fast-forward; scanning continues underneath the whole time. Amber for
"already checked in", red X for a failure. Badge is `clamp(120px, 40vmin,
240px)` so it is correctly proportioned on phone/tablet/desktop with no media
queries; honours `prefers-reduced-motion`; `role="status"` + `aria-live`. The
beep was replaced by a two-note rising chime (`playScanTone`).

### 2. Roster tab == Volunteers tab, permanently

Root cause found: `buildSummaries` seeded its map from the roster AND from
submission names, so any volunteer deleted from the roster whose hours stayed
behind reappeared as a Roster-only ghost row. Prod had **5** such people
(Erika Hsieh, Ethan de la Cruz, Jocelin Wang, Justin Lee, Xiqiao Ma —
39.25 hrs). Two fixes, belt and braces:

- `buildSummaries` is now strictly roster-DRIVEN (a submission with no roster
  entry is ignored), so the two tabs can never diverge again;
- a one-time migration **archived then deleted** those 5 people's leftover
  attendance + submissions (the chapter asked for them to be fully removed).
  The raw rows are recoverable verbatim from `archived_records`.

The shared suite now asserts `GET /roster` is exactly `GET /volunteers`.

### 3. Events page — one table per event type

Events are grouped into a section per event name, each listing its dates, with
columns **Date · Start · End · Expected Hrs · Checked In · Actions**. Groups
with something upcoming float to the top (soonest first), then by most recent;
same rule for dates inside a group. Each group header rolls up dates,
check-ins, hours credited and the next date; sections collapse, and a custom
"Others" event automatically gets its own section under its own name. A page
header rolls up Event Types / Total Dates / Upcoming / Hours Credited, with
search. **Every column is editable inline** (pencil → date/time/expected-hours
inputs → Save) and the same fields are editable on the event's own page
("Edit Details") and in the create-event form, in the same order.

### 4. Conduct strikes

- Event page: a **Strike** column per attendee — white when clean, red when
  struck, one tap to toggle (`attendance.strikes`, an integer). Never affects
  hours. The event's stat strip gained a Strikes total.
- Roster: a **Strikes** column per volunteer plus a per-event Strikes column in
  the expanded row. An event carrying a strike but no countable hours still
  appears there, so a strike can never be invisible.
- Volunteers tab: gained **Total Hours** and **# of Strikes** columns, and a
  collapsible **"N volunteers with 3+ strikes"** watchlist table above the
  roster (hidden entirely when nobody qualifies).

### 5. Officers + the per-event hours cap

- New `volunteers.role` (`volunteer` | `officer`), editable in the volunteer
  form, with a light-green **Officer** badge beside the name on the Roster, the
  Volunteers tab, the watchlist and event attendance lists.
- New `events.expected_hours` (nullable). An ordinary volunteer is credited
  `min(checkout − checkin, expected_hours)`; **officers are never capped**
  because their set-up/clean-up time is genuine service. No expected hours set
  ⇒ no cap for anyone.
- `submissions.raw_hours` keeps the uncapped span, so the roster can show a
  "capped" marker instead of looking like a rounding bug (admin-only).
- Changing an event's expected hours, name or date **re-derives every
  attendee's credited hours**; changing a volunteer's role or grade re-derives
  all of theirs. Both stores implement this via one shared
  `deriveSubmissionFields`.
- The 12 confirmed officers were promoted by a one-time migration.

### Data safety

Every existing event has `expected_hours = NULL`, so **adding the cap changed
zero already-recorded hours**. The only deletion is the 5 former members the
chapter asked to remove, and it archives before it deletes. Migrations are
marker-guarded in `app_migrations`: they apply once per database and a re-run
can never undo a later admin edit (proved by a Postgres-only test that demotes
an officer and cold-boots again).

### The parity gate is now runnable locally

`server/test/docker-compose.parity.yml` brings up a throwaway `postgres:17` +
a Neon HTTP proxy, so the MANDATORY live-Postgres parity suite runs with no
cloud database and zero chance of pointing at production:

```bash
cd server && docker compose -f test/docker-compose.parity.yml up -d
TEST_DATABASE_URL='postgres://postgres:postgres@db.localtest.me:5432/scratchdb' \
  TEST_NEON_HTTP_PROXY=1 npm test
```

Each parity test now truncates everything (including the migration markers) and
boots a FRESH store, so every test exercises the real cold-start path — DDL,
seed and data migrations included.

### Also in this round

- `SEED_VOLUNTEERS` regenerated from the live 65-name roster (it was still the
  48 go-live names and would have re-seeded the 5 removed members into a fresh
  database). Only ever used to seed an EMPTY table; prod is untouched.
- Excel exports carry the new fields: the roster sheet gained **Role**, the
  hours report's Summary sheet gained **Role** and **Strikes**.
- Fixed: leaving an event page now refreshes the derived hours (the roster used
  to show stale totals until the next tab switch).

## Round 6 — Avery 74461 badge sheet + brand-logo fix

Two chapter-requested changes. Frontend-only (no DB / API / schema change);
green bar passing, verified live in the running app.

### 1. Bulk ID-card PDF now matches Avery 74461 (clip-style name badges)

- The "QR ID Cards (PDF)" bulk export (`downloadQrIdCardsPdf`) previously used an
  arbitrary 2-col grid (0.4" margins, 0.3" gaps) that lined up with no physical
  stock. It now lays cards on **Avery 74461** exactly: **8 inserts / US-Letter
  sheet, 2 cols × 4 rows**, columns at **0.75"/4.25"**, rows at
  **1.0625"/3.28125"/5.5"/7.71875"** from the top, cells **3.5"×2.21875"**. These
  numbers were read straight off Avery's own template PDF (612×792pt, rectangles
  252×159.75pt), so a printed sheet drops into the clip-badge holders unadjusted.
- Each card **fills its whole cell edge-to-edge** — full 3.5" width AND full
  2.21875" height, zero inset — so the printed cards butt together with no gaps
  (the cells tile at a 2.21875" pitch), matching the sheet's attached perforated
  inserts. To fill without distortion the card was **resized to the badge's own
  proportions** (`CARD_H` 600→666, so 3.5"×2.21875", CARD_ASPECT ≈ 1.577) and
  `drawCard` re-tuned (band/logo/org/QR/name) to look balanced at the taller size.
  Still ONE renderer, so the modal preview, PNG, and single-card PDF (now a single
  3.5×2.21875 insert) all match. `AVERY_74461.cellHIn` = 2.21875" is the template's
  true row pitch (Avery markets it as 2.25"; the ~0.03" is nominal rounding).
- Refactor: `avery74461Placements(count)` is a **pure, unit-tested** layout
  function; `buildQrIdCardsPdf()` returns the jsPDF doc; `downloadQrIdCardsPdf()`
  is the thin IO wrapper (mirrors `buildRosterSheetData` for the Excel export).
- **Verified live:** drove the real `buildQrIdCardsPdf` in the running app with 8
  volunteers (incl. a long wrapping name) → the actual PDF's 8 cards register
  pixel-exactly inside the Avery template cells (overlay checked at 150 dpi).
  Geometry unit tests pin the coordinates; 34 client tests pass.

### 2. Brand logo corrected (header + passcode gate)

- The header and the passcode-gate chrome still showed the **ship emblem**
  (`/tzu-chi-logo.png`). Both now use the **lotus + cupped-hands + candle** logo
  (`/cert-logo.png`) — the same emblem the ID cards and certificate already use.
  `tzu-chi-logo.png` is now unreferenced (left in `public/` for now).
- **Verified live:** only `/cert-logo.png` is fetched (200), no request for
  `tzu-chi-logo.png`, no console errors; header + gate render the lotus emblem.

## Round 5 — GO LIVE: real roster + hours, new ID-card design

**Production now holds REAL data** (was dummy/seed before). Both tasks shipped +
verified live on https://tcyavolunteers.netlify.app.

### 1. Data go-live (imported from the chapter's Hours spreadsheet)

- **48 volunteers**, codes `TCYA-0001..0048` in ALPHABETICAL order. New students
  added later just increment (next `TCYA-0049`) and never renumber existing IDs;
  the roster still displays alphabetically (this is how the code sequence +
  name-sorted list already work).
- **13 reconstructed historical events** (Apr–Jul 2026) + the **1 pre-existing
  future event** ("Welcome Kick-off/Orientation", 2026-08-16) which was PRESERVED
  through the import.
- **195 attendance rows + 195 derived submissions**; grand total **745.25 hrs**.
  Hours were reconstructed as COMPLETE attendance rows (checkin = real sign-in,
  checkout = checkin + credited hours) so the app's derive-from-timestamps model
  produces exactly the sheet's numbers. Food Distribution = flat 5.00/event.
- **Verified live**: replayed the client's own `buildSummaries`/`isCountableSubmission`
  against the live public API → 745.25 exact; per-student + per-event totals all
  reconcile against the sheet's Student/Event Totals tabs. A pre-import backup of
  the old dummy state was taken (session scratch).
- `server/src/data/seed-volunteers.js` was regenerated to the real 48 names so a
  FRESH DB seeds the same roster (grades/hours live in the DB, not the seed).

### 2. New QR ID-card design (the chapter's own design)

- New card = light-blue header band with the **lotus + cupped-hands + candle logo
  (`/cert-logo.png`, NOT `/tzu-chi-logo.png` — the ship emblem)** + right-aligned
  "Tzu Chi Youth Association US" / "East LA 東洛慈少", big bold name on the left, QR
  upper-right, and a branded **ELA-TCYA-###** ID centered under the QR — matching
  the chapter's own sample card. **Long names wrap to two rows: first name on row 1,
  last name on row 2** (short names stay one line). Contact details are intentionally
  NOT on the card (data minimization); the QR still encodes only `{t,v,id,code,name}`.
- One canvas renderer (`client/src/cardRenderer.ts`) feeds the modal preview, the
  PNG download, clipboard copy, and the single + bulk PDFs — WYSIWYG.
- **Display ID `ELA-TCYA-001` is shown everywhere** (card, QR modal, admin roster,
  Excel export, event attendance list, edit-volunteer modal, scanner manual pick)
  via `formatDisplayId()`; the stored `code` + QR payload stay the canonical
  `TCYA-0001`, so scanning/identity are unchanged.
- Verified in the running app: cards render correctly; every name (longest fits at
  60px) clears the QR; display IDs show on the roster; no console errors.

### Post-launch adversarial review (bugs found + fixed)

A multi-agent adversarial bug hunt over the go-live diff confirmed the imported
data is invariant-consistent (submissions exactly equal what reconcile re-derives)
and found 3 real defects in the new card feature, all now fixed + verified:

- **Card name-wrap was dead code** — `fitOneLine` returned its `min` on both fit and
  non-fit, so the two-line wrap never ran and a long admin-added name would overflow
  the QR. Fixed (returns 0 on non-fit); long names now wrap ("Maria Guadalupe /
  Hernandez Rodriguez") or shrink, verified in-app.
- **`loadImage` cached rejected promises** — one transient logo-load failure poisoned
  every card render until reload. Now evicts on failure.
- **Manual check-in rejected the branded ID** — the card only shows `ELA-TCYA-###`;
  `parseScannedCode` now normalizes that back to `TCYA-####` (unit-tested), and the
  scanner placeholder was updated.

### Full live UX/UI/a11y audit (2026-08-02) — done + fixed

Full live clickthrough (prod read-only + local for mutations) of every screen,
button, modal, and state at desktop/tablet/mobile, plus a 30-agent code-level
audit (22 confirmed findings). All real issues fixed + verified live:

- **AdminTabs** no longer overflows horizontally (removed `-mx-4/-mx-6`); the page
  no longer scrolls sideways on any admin screen (0px overflow, verified prod).
- **Volunteers panel** shows "Loading volunteers…" instead of flashing
  "No volunteers yet" (looked wiped) before the first fetch resolves.
- **Duplicate-name flow**: one "Add anyway?" prompt, branded `ELA-TCYA-###`, and a
  plain "Not added…" message on decline (was a dangling raw-code question).
- Fixed stale copy: custom fields are NOT on the new card (roster export instead).
- **a11y**: shared `useFocusTrap` on all 5 modals (Tab containment + focus restore);
  `PasscodeGate` role=dialog; aria-labels on placeholder-only inputs; Toast
  aria-live; CreateEvent autofocus; password eye keyboard-reachable; low-contrast
  slate-400 sentences → slate-500.
- **VolunteerQRModal** scrolls on short/landscape viewports (close button reachable).
- **EventDetailPage** per-row pending (toggling one attendee no longer greys all);
  larger tap targets. **ScannerModal** recent-scan truncation + picker reset.
- **VolunteerTable** cause-aware empty state.

Interactive flows all verified working: passcode (wrong/right), roster expand +
search + filter + certificate download, add/edit/duplicate volunteer, QR card
copy/PNG/PDF/email, bulk PDF + Excel, create event (preset + Others custom), event
detail add/toggle/edit-times (hours derive) + scanner manual entry (branded ID).

### Durability posture (operator: the data is real now — protect it)

- The single-replace go-live import is DONE. Do NOT run another replace-all import,
  `/admin/reset`, `npm run reset`, or the parity suite against prod. Updates happen
  only via the admin UI (add/edit volunteers, scan/edit attendance → hours derive)
  or a careful assisted change.
- **Passcode posture (decided 2026-08-17, round 8):** admin `0314` and officer
  `1013` live in `server/src/accounts.js`, in a PUBLIC repo, and deploy config no
  longer supplies them. The chapter chose this so sign-in needs zero setup. The
  residual risk is real and accepted: anyone who reads the repo and finds the site
  can pass the `1994` gate and sign in as admin, which is full edit/wipe power
  over real data. Mitigations if that ever matters: make the repo private, or move
  the passcodes back behind `SESSION_SECRET`-style env config. Neon PITR below is
  the backstop that makes a wipe recoverable.
- **Enable Neon PITR / automated backups** on the primary branch as an
  app-independent safety net.

## Round 4 — data durability: never lose data again

**Root cause of "events don't persist":** NOT an app bug. The app stores events
durably in Neon (verified by reading Neon directly + confirming an event survived
minutes later across instances). The loss came from **destructive testing against
prod** — the parity suite + reset scripts were pointed at the production Neon DB to
"leave it pristine" after each session, wiping real events. That practice is now
forbidden and guarded.

Hardening (all landed, green bar passing):

- **Fail-closed store** (`create-store.js`): resolves the DB URL from
  `DATABASE_URL || NETLIFY_DATABASE_URL || DATABASE_URL_UNPOOLED ||
  NETLIFY_DATABASE_URL_UNPOOLED`; in a prod-like env with no URL it THROWS instead
  of silently using the ephemeral in-memory store. `api.mjs` catches → 503, never
  serves RAM. (Fixes the silent-in-memory landmine + the circular prod guard.)
- **`GET /api/health`** → `{ ok, backend, persistent, dbOk }` with a live `SELECT 1`
  probe. `persistent:false` = non-durable deploy.
- **Non-destructive import**: `importAll` (both stores) only wipes+replaces the
  categories present in the payload — a volunteers-only restore no longer nukes
  events/hours.
- **Prod-wipe guards**: parity suite throws if `TEST_DATABASE_URL` == `DATABASE_URL`
  or lacks a throwaway marker (override `CONFIRM_TRUNCATE=1`); `reset.js` needs
  `CONFIRM_RESET=1`; `/admin/reset` needs `{"confirm":"RESET"}` + logs counts.
- **Client "looks-wiped" fixes**: `refresh()` uses `Promise.allSettled` (one failed
  fetch no longer blanks events); `checkAdminSession` returns `"unknown"` on
  transient 5xx/network (no spurious logout); admin tab persists across reload.
- **Green:** server memory **76 pass** + create-store/hours unit tests, client
  **25 pass**, build clean, parity-guard refusal verified.

**DEFERRED (needs user):** run live-Postgres parity against a **throwaway**
`TEST_DATABASE_URL` (I will not wipe prod to run it). See "User actions" below.

### User actions (owns Netlify env + Neon)

1. **Confirm `DATABASE_URL` targets the durable Neon PRIMARY branch** (not an
   expiring/preview branch) and is scoped to ALL Netlify deploy contexts.
2. **Provision a throwaway Neon branch/DB** with `test`/`scratch` in its name; use
   its URL as `TEST_DATABASE_URL` for the parity gate. Never use the prod string.
3. **Decide on the passcode posture** — see "Passcode posture" above. The codes
   ship in the repo by design now; making the repo private is the cheap hardening.
4. **Enable Neon PITR / automated backups** on the primary as an app-independent
   safety net.

## Round 3 — from-scratch code-review, security + a11y + tests

Full multi-agent review of everything, findings applied, re-verified, deployed.

- **Security — public reads tightened:** `GET /submissions` is now admin-gated.
  Public callers get a projection WITHOUT minors' exact check-in/out clock times,
  free-text comments, or internal submit timestamps (mirrors `publicEvent()` on
  `/events`). Admins still get full rows for the Excel export + attendance detail.
- **Volunteer certificate reachable on mobile:** the cumulative "Download
  certificate" button now shows in the expanded roster row on phones (its desktop
  column is hidden below `sm`). Non-admins no longer see Sign In/Out/Comments
  columns (those fields are stripped server-side; `isAdmin` threads through
  `VolunteerTable`).
- **Import parity fix:** Postgres `importAll` now skips a duplicate event id
  entirely (including its attendance), matching the memory store — a dup id can no
  longer smuggle in new attendance rows.
- **Accessibility:** Events + roster rows are keyboard-activatable (Enter/Space,
  visible focus ring) and their handlers ignore keys bubbling from nested buttons;
  `role="dialog"`/`aria-modal`/`aria-labelledby` on the login + create-event modals.
- **Scanner (iOS):** the AudioContext is unlocked on the first tap anywhere in the
  scanner, so a check-in-only session (default mode, no mode-button tap) still
  beeps on iPhone/iPad.
- **Tests:** added `server/test/hours.test.js` (14 unit tests: 0.25h rounding +
  PST/PDT/EDT/UTC/midnight/invalid-tz for `localHHMM`, `isComplete` decoupling) and
  reconcile-edge + public-projection behavioral tests in the shared suite.
- **Green:** server memory **58 pass**, **live Neon parity 43 pass**, client build
  clean. Prod verified: public roster (90, name+grade only), admin login + full-PII
  `/volunteers`, events 200. Prod DB left pristine (90 roster, 0 events).

## Round 2 — hours from check-in/out, tab nav, mobile

Deployed + verified on prod. Changes on top of the QR feature below:

- **Service hours are now DERIVED from attendance check-in/out times**
  (`hours = checkout − checkin`, rounded 0.25, sign-in/out HH:MM in `CHAPTER_TZ`).
  `reconcileSubmission` (both stores) upserts/deletes the derived submission
  after every attendance mutation. The public "Log Volunteer Hours" form + button
  + `POST /submissions` are removed.
- **Bug fixed:** deleting an event / removing a volunteer deletes the derived
  hours, so no stuck "pending" badge. Volunteer **grade** is editable + reflected
  on the roster.
- **Admin tab nav:** sticky Roster · Volunteers · Events (no scrolling).
- **Mobile/iPad:** tables collapse columns on small screens, bottom-sheet modals,
  thumb-sized tabs. (Live mobile screenshotting was unavailable — the Chrome
  extension was disconnected — verify on-device.)
- Green: server 39, live Neon parity 39, client 25, build clean. Prod verified:
  hours=3 from 09:00→12:00, delete clears hours, form gone (404).

## What just landed (round 1)

A large feature + storage migration, built, audited, code-reviewed, and verified:

- **Neon Postgres backend.** Storage moved from a single JSON doc (file/Blobs) to
  Postgres behind a `Store` interface. `store-postgres.js` (real) +
  `store-memory.js` (reference + local-dev fallback) are kept in lock-step by a
  shared test suite. `create-store.js` picks the backend from `DATABASE_URL`.
  Schema/seed init lazily (advisory-locked) on first request.
- **Volunteer records + QR "ID cards."** Volunteers now have `code` (TCYA-0001…),
  email, phone, grade, and custom fields. Admin Volunteers panel: add/edit/delete,
  per-volunteer QR modal (copy PNG / download / ID-card PDF / email), bulk **QR ID
  Cards (PDF)** + **Roster (Excel)** exports.
- **Camera check-in/out.** Scan volunteer QR codes at an event to check in/out
  (records timestamps); jsQR + native BarcodeDetector fast-path; continuous scan
  with de-dupe, beep, manual fallback. Attendance table shows + lets you edit times.
- **Migration/back-compat.** `POST /api/admin/import` loads an old `{events,
  submissions, volunteers?}` backup into Neon. `GET /api/admin/export` backs up.
  `reset` clears events/attendance/submissions but keeps the roster (+ writes a
  pre-wipe backup file).

## Quality gates passed

- Server memory suite **40 pass**, **live Neon parity 40 pass**, client **24 pass**,
  client build clean.
- **Multi-agent audit** (30 findings) — all fixed.
- **/code-review max** (15 findings, incl. 2 self-introduced HIGH bugs) — all fixed.
  Notable: spoofable rate-limit key hardened; admin-login-on-stale-events timestamp
  wipe fixed (re-fetch on login + editor dirty-tracking).

## Current state / what's left

- **DEPLOYED to prod and verified end-to-end (2026-07-10):**
  https://tcyavolunteers.netlify.app on Neon. Verified live: public roster (90
  from Neon), auth gating (401), admin login, volunteer create + custom fields +
  code sequence, duplicate-name 409, event create, QR check-in/out with
  timestamps, manual time edit preserving the check-in time, public submission +
  self-added flip, PII/QR-code not leaked publicly, export. Prod left pristine
  (90 roster, 0 events/submissions).
- **Code:** complete and green. See `CLAUDE.md` for invariants + test layout.
- **⚠️ ACTION FOR OPERATOR:** `ADMIN_PASSWORD` is currently the weak default
  `1013`. Change it to a strong value in Netlify → Environment variables (and set
  `SESSION_SECRET`). The login throttle + fail-closed default help, but a strong
  password is the real control.
- **Known non-blocking gaps** (from the audit, accepted): the per-instance in-memory
  login throttle is best-effort on serverless — the real controls are the
  fail-closed default + a strong `ADMIN_PASSWORD`. No CI yet; the Postgres parity
  suite (`TEST_DATABASE_URL=… npm test` in `server/`) is a **mandatory manual
  pre-deploy gate** because default `npm test` is memory-only.

## Deploy checklist

1. Netlify env: `DATABASE_URL` (Neon pooled string); optionally `SESSION_SECRET`.
   Sign-in passcodes come from `server/src/accounts.js`, not the environment.
2. `cd server && TEST_DATABASE_URL=<throwaway> npm test` (parity gate).
3. Push to `main` → Netlify builds. First request creates schema + seeds roster.
4. Smoke-test: `/api/health`, `/api/roster`, admin login, create event, scan.
