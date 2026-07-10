import { describe, it, expect } from "vitest";
import {
  buildQrPayload,
  parseScannedCode,
  safeFileName,
  dataUrlToBlob,
  QR_TYPE,
} from "./qr";
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

describe("buildQrPayload", () => {
  it("always includes the type marker, id, code, and name", () => {
    const obj = JSON.parse(buildQrPayload(vol()));
    expect(obj.t).toBe(QR_TYPE);
    expect(obj.v).toBe(1);
    expect(obj.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(obj.code).toBe("TCYA-0001");
    expect(obj.name).toBe("Aaron Tse");
  });

  it("NEVER embeds PII (email, phone, grade, custom fields) — a generic scanner must not read it", () => {
    const payloadStr = buildQrPayload(
      vol({
        email: "secret@x.com",
        phone: "555-1234",
        grade: "10th",
        customFields: { Guardian: "Jane Doe", Allergy: "Peanuts" },
      })
    );
    const obj = JSON.parse(payloadStr);
    expect(obj.email).toBeUndefined();
    expect(obj.phone).toBeUndefined();
    expect(obj.grade).toBeUndefined();
    expect(obj.fields).toBeUndefined();
    // The raw QR string must contain none of the sensitive values.
    expect(payloadStr.includes("secret@x.com")).toBe(false);
    expect(payloadStr.includes("555-1234")).toBe(false);
    expect(payloadStr.includes("Jane Doe")).toBe(false);
    expect(payloadStr.includes("Peanuts")).toBe(false);
    // Identity we DO keep:
    expect(Object.keys(obj).sort()).toEqual(["code", "id", "name", "t", "v"]);
  });
});

describe("parseScannedCode", () => {
  it("round-trips a built payload back to its code", () => {
    const parsed = parseScannedCode(buildQrPayload(vol({ code: "TCYA-0042", name: "Amber Wang" })));
    expect(parsed).toEqual({ code: "TCYA-0042", name: "Amber Wang" });
  });

  it("accepts a bare code string (case-insensitive)", () => {
    expect(parseScannedCode("TCYA-0007")).toEqual({ code: "TCYA-0007" });
    expect(parseScannedCode("  tcya-0007  ")).toEqual({ code: "TCYA-0007" });
  });

  it("rejects foreign QR payloads and garbage", () => {
    expect(parseScannedCode('{"t":"OTHER-APP","code":"X"}')).toBeNull();
    expect(parseScannedCode("https://example.com")).toBeNull();
    expect(parseScannedCode("not json {")).toBeNull();
    expect(parseScannedCode("")).toBeNull();
    expect(parseScannedCode("HELLO-0001")).toBeNull();
  });
});

describe("safeFileName", () => {
  it("strips filesystem-unsafe characters", () => {
    expect(safeFileName('A/B:C*?"<>|D')).toBe("ABCD");
    expect(safeFileName("  Aaron Tse  ")).toBe("Aaron Tse");
  });
});

describe("dataUrlToBlob", () => {
  it("decodes a PNG data URL into a Blob of the right type", () => {
    // 1x1 transparent PNG
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42m" +
      "NkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const blob = dataUrlToBlob(dataUrl);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
  });
});
