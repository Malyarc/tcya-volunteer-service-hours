import { describe, it, expect } from "vitest";
import {
  buildRosterSheetData,
  avery74461Placements,
  AVERY_74461,
} from "./volunteerExports";
import type { Volunteer } from "./types";

function vol(over: Partial<Volunteer> = {}): Volunteer {
  return {
    id: over.id ?? "11111111-1111-1111-1111-111111111111",
    code: over.code ?? "TCYA-0001",
    name: over.name ?? "Aaron Tse",
    email: over.email ?? "",
    phone: over.phone ?? "",
    grade: over.grade ?? "",
    customFields: over.customFields ?? {},
    active: over.active ?? true,
    createdAt: over.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: over.updatedAt ?? "2026-01-01T00:00:00.000Z",
  };
}

describe("buildRosterSheetData", () => {
  it("emits the standard columns plus a QR payload per volunteer", () => {
    const { rows } = buildRosterSheetData([
      vol({ code: "TCYA-0001", name: "Aaron Tse", email: "a@x.com", phone: "555", grade: "10th" }),
    ]);
    expect(rows).toHaveLength(1);
    // Visible ID is the branded display form; canonical code lives in QR Payload.
    expect(rows[0].ID).toBe("ELA-TCYA-001");
    expect(rows[0].Code).toBeUndefined();
    expect(rows[0].Name).toBe("Aaron Tse");
    expect(rows[0].Email).toBe("a@x.com");
    expect(rows[0].Phone).toBe("555");
    expect(rows[0].Grade).toBe("10th");
    // QR payload is the identity-only JSON (no PII).
    const payload = JSON.parse(rows[0]["QR Payload"]);
    expect(payload.code).toBe("TCYA-0001");
    expect(payload.email).toBeUndefined();
  });

  it("unions custom-field keys into their own columns across volunteers", () => {
    const { rows, customKeys } = buildRosterSheetData([
      vol({ code: "TCYA-0001", customFields: { Shirt: "M" } }),
      vol({ code: "TCYA-0002", name: "Amber", customFields: { Guardian: "Jane" } }),
    ]);
    expect(customKeys).toEqual(["Guardian", "Shirt"]);
    // Each row has both keys; missing values are blank, not undefined.
    expect(rows[0].Shirt).toBe("M");
    expect(rows[0].Guardian).toBe("");
    expect(rows[1].Guardian).toBe("Jane");
    expect(rows[1].Shirt).toBe("");
  });

  it("handles an empty roster without throwing", () => {
    expect(buildRosterSheetData([])).toEqual({ rows: [], customKeys: [] });
  });
});

describe("avery74461Placements — fills each Avery 74461 cell edge-to-edge", () => {
  // Ground truth read off Avery's template PDF: 8 cells (2 cols × 4 rows),
  // columns at 0.75"/4.25", rows at 1.0625"/3.28125"/5.5"/7.71875" from the top,
  // each cell 3.5"×2.21875", tiling at a 2.21875" pitch. Each card FILLS its whole
  // cell (no inset), so the printed cards butt together with no gaps.
  const { cellWIn, cellHIn, pageW, pageH } = AVERY_74461;

  it("places 8 cards on one sheet, each filling its whole cell", () => {
    const p = avery74461Placements(8);
    expect(p).toHaveLength(8);
    expect(p.every((c) => c.page === 0)).toBe(true);
    // Every card fills the full 3.5" × 2.21875" cell (no padding/inset).
    expect(p.every((c) => c.w === cellWIn && c.h === cellHIn)).toBe(true);

    // Reading order is row-major: [col0,row0], [col1,row0], [col0,row1], ...
    // and each card sits at its cell's top-left corner (no inset).
    expect(p[0].x).toBeCloseTo(0.75, 6);
    expect(p[0].y).toBeCloseTo(1.0625, 6);
    expect(p[1].x).toBeCloseTo(4.25, 6);
    expect(p[1].y).toBeCloseTo(1.0625, 6);
    expect(p[2].x).toBeCloseTo(0.75, 6);
    expect(p[2].y).toBeCloseTo(3.28125, 6);
    expect(p[7].x).toBeCloseTo(4.25, 6);
    expect(p[7].y).toBeCloseTo(7.71875, 6);
  });

  it("tiles with NO gaps — cards butt together both ways", () => {
    const p = avery74461Placements(8);
    // Horizontal: right edge of col 0 == left edge of col 1.
    expect(p[0].x + p[0].w).toBeCloseTo(p[1].x, 6); // 0.75+3.5 = 4.25
    // Vertical: bottom edge of each row == top edge of the next (2.21875" pitch).
    expect(p[0].y + p[0].h).toBeCloseTo(p[2].y, 6); // 1.0625+2.21875 = 3.28125
    expect(p[2].y + p[2].h).toBeCloseTo(p[4].y, 6); // 3.28125+2.21875 = 5.5
    expect(p[4].y + p[4].h).toBeCloseTo(p[6].y, 6); // 5.5+2.21875 = 7.71875
  });

  it("keeps every card on the 8.5×11 sheet", () => {
    for (const c of avery74461Placements(8)) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(pageW + 1e-9);
      expect(c.y + c.h).toBeLessThanOrEqual(pageH + 1e-9);
    }
  });

  it("has symmetric side margins", () => {
    const p = avery74461Placements(2);
    const rightMargin = pageW - (p[1].x + p[1].w);
    expect(rightMargin).toBeCloseTo(p[0].x, 6); // both 0.75"
  });

  it("overflows onto a second sheet after 8 cards", () => {
    const p = avery74461Placements(9);
    expect(p[8].page).toBe(1);
    expect(p[8].x).toBeCloseTo(0.75, 6);
    expect(p[8].y).toBeCloseTo(1.0625, 6);
  });

  it("returns nothing for an empty roster", () => {
    expect(avery74461Placements(0)).toEqual([]);
  });
});
