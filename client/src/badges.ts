// Recognition badges shown next to a volunteer's name.
//
// A badge is a LABEL, never a permission and never an input to a calculation:
// nothing here may change credited hours, the roster, or what anyone can do.
// (The Officer badge is different — that one renders `volunteers.role`, which
// really does lift the hours cap. See server/src/roles.js.)
//
// TC Academy membership is a fixed, chapter-maintained list rather than a
// stored field: the chapter asked for it hard-coded, it changes about once a
// year, and keeping it here means no migration, no admin UI, and no database
// column that can drift out of sync with what the chapter actually believes.
//
// TO EDIT THE LIST: add or remove an entry below, spelled exactly as the roster
// spells it, and redeploy. A name matching nobody is silently ignored — which
// is why `tcAcademyNamesMissingFrom` exists: it surfaces a typo to admins in
// the Volunteers panel instead of leaving a badge that quietly never appears.

// One person in the chapter's Tzu Chi Academy (核桃人文學校) program.
// `alsoSpelled` holds alternate spellings of the SAME person — the badge shows
// for any of them, and the missing-name check treats the entry as found when
// any one matches. That is what lets the list carry both the roster's spelling
// and the chapter's without either producing a permanent false warning.
interface TcAcademyEntry {
  name: string;
  alsoSpelled?: readonly string[];
}

const TC_ACADEMY_ENTRIES: readonly TcAcademyEntry[] = [
  { name: "Tian Zan" },
  { name: "Jaden Liu (Gr.10)" },
  { name: "Jaden Liu (Gr.11)" },
  { name: "Andrew Luo" },
  // The roster spells this student "Issac Cao"; the chapter writes "Isaac".
  // Both match, so the badge is right today and stays right if the roster is
  // corrected later.
  { name: "Issac Cao", alsoSpelled: ["Isaac Cao"] },
  { name: "Jaeden Wang" },
];

// Every spelling that earns the badge, primary and alternate alike.
export const TC_ACADEMY_MEMBERS: readonly string[] = TC_ACADEMY_ENTRIES.flatMap(
  (e) => [e.name, ...(e.alsoSpelled ?? [])]
);

// Names are matched on a normalized form — trimmed, inner whitespace collapsed,
// case-folded — so a stray double space or trailing space on either side can't
// silently drop somebody's badge.
function normalizeName(name: string): string {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const TC_ACADEMY_SET = new Set(TC_ACADEMY_MEMBERS.map(normalizeName));

export function isTcAcademyMember(name: string | null | undefined): boolean {
  if (!name) return false;
  return TC_ACADEMY_SET.has(normalizeName(name));
}

// Which TC Academy people match nobody on the given roster — the primary
// spelling of each entry where neither it nor any alternate was found. Empty is
// the healthy state, and the Volunteers panel shows nothing at all in that case.
export function tcAcademyNamesMissingFrom(
  rosterNames: readonly string[]
): string[] {
  const roster = new Set(rosterNames.map(normalizeName));
  return TC_ACADEMY_ENTRIES.filter(
    (e) =>
      !roster.has(normalizeName(e.name)) &&
      !(e.alsoSpelled ?? []).some((alt) => roster.has(normalizeName(alt)))
  ).map((e) => e.name);
}
