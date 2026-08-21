import { describe, it, expect } from "vitest";
import {
  TC_ACADEMY_MEMBERS,
  isTcAcademyMember,
  tcAcademyNamesMissingFrom,
} from "./badges";

// The six people the chapter named, in the roster's own spelling. Pinning them
// here means an accidental edit to badges.ts fails a test instead of silently
// removing somebody's badge — the failure mode this feature is most prone to,
// since a name matching nobody renders nothing at all.
const CHAPTER_LIST = [
  "Tian Zan",
  "Jaden Liu (Gr.10)",
  "Jaden Liu (Gr.11)",
  "Andrew Luo",
  "Issac Cao", // the roster's spelling; the chapter writes "Isaac"
  "Jaeden Wang",
];

describe("TC Academy badge membership", () => {
  it("badges exactly the six chapter-named students", () => {
    for (const name of CHAPTER_LIST) {
      expect(isTcAcademyMember(name), `${name} should be TC Academy`).toBe(true);
    }
  });

  it("badges nobody else", () => {
    for (const name of [
      "Aaron Tse",
      "Amber Wang", // an officer, but not TC Academy
      "Ruby Luo", // shares a surname with a member
      "Kristy Cao", // shares a surname with a member
      "Evan Liu", // shares a surname with two members
      "Jaden Liu", // the un-suffixed name matches NEITHER Gr.10 nor Gr.11
    ]) {
      expect(isTcAcademyMember(name), `${name} should NOT be TC Academy`).toBe(
        false
      );
    }
  });

  it("keeps the two Jaden Lius distinct", () => {
    expect(isTcAcademyMember("Jaden Liu (Gr.10)")).toBe(true);
    expect(isTcAcademyMember("Jaden Liu (Gr.11)")).toBe(true);
    expect(isTcAcademyMember("Jaden Liu (Gr.12)")).toBe(false);
  });

  it("accepts both spellings of Issac/Isaac Cao", () => {
    // The roster says "Issac"; the chapter wrote "Isaac". Both must badge, so
    // the feature is correct now AND survives the roster being corrected.
    expect(isTcAcademyMember("Issac Cao")).toBe(true);
    expect(isTcAcademyMember("Isaac Cao")).toBe(true);
  });

  it("is tolerant of stray whitespace and case, which a hand-typed list attracts", () => {
    expect(isTcAcademyMember("  Andrew Luo  ")).toBe(true);
    expect(isTcAcademyMember("andrew luo")).toBe(true);
    expect(isTcAcademyMember("ANDREW  LUO")).toBe(true); // doubled inner space
  });

  it("treats missing / empty names as not badged rather than throwing", () => {
    expect(isTcAcademyMember(null)).toBe(false);
    expect(isTcAcademyMember(undefined)).toBe(false);
    expect(isTcAcademyMember("")).toBe(false);
    expect(isTcAcademyMember("   ")).toBe(false);
  });
});

describe("tcAcademyNamesMissingFrom — the typo safety net", () => {
  it("reports nothing when every badge name is on the roster", () => {
    expect(tcAcademyNamesMissingFrom(CHAPTER_LIST)).toEqual([]);
  });

  it("does not warn about the Isaac/Issac pair when either spelling matches", () => {
    // Only one spelling can ever be on the roster; a warning here would be
    // permanent and untrue, which is exactly what trains people to ignore it.
    const withRosterSpelling = tcAcademyNamesMissingFrom(CHAPTER_LIST);
    expect(withRosterSpelling).toEqual([]);

    const withChapterSpelling = tcAcademyNamesMissingFrom(
      CHAPTER_LIST.map((n) => (n === "Issac Cao" ? "Isaac Cao" : n))
    );
    expect(withChapterSpelling).toEqual([]);
  });

  it("names the people whose badge would silently never appear", () => {
    const roster = CHAPTER_LIST.filter(
      (n) => n !== "Tian Zan" && n !== "Jaeden Wang"
    );
    expect(tcAcademyNamesMissingFrom(roster).sort()).toEqual([
      "Jaeden Wang",
      "Tian Zan",
    ]);
  });

  it("reports the Cao entry when NEITHER spelling is on the roster", () => {
    const roster = CHAPTER_LIST.filter((n) => n !== "Issac Cao");
    expect(tcAcademyNamesMissingFrom(roster)).toEqual(["Issac Cao"]);
  });

  it("reports every entry against an empty roster, without duplicating the alias", () => {
    // Six people, not seven — the alias must not double-count.
    expect(tcAcademyNamesMissingFrom([])).toHaveLength(6);
    // …even though the match list itself carries the extra spelling.
    expect(TC_ACADEMY_MEMBERS).toHaveLength(7);
  });
});
