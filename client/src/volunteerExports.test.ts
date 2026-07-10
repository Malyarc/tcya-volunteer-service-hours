import { describe, it, expect } from "vitest";
import { buildRosterSheetData } from "./volunteerExports";
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
    expect(rows[0].Code).toBe("TCYA-0001");
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
