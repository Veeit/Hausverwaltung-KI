import { describe, expect, it } from "vitest";
import { formatDate, roleLabel } from "@/lib/format";

describe("roleLabel", () => {
  it("kennt alle bekannten Rollen", () => {
    expect(roleLabel("tenant")).toBe("Mieter");
    expect(roleLabel("contractor")).toBe("Handwerker");
    expect(roleLabel("landlord")).toBe("Vermieter");
    expect(roleLabel("ai")).toBe("KI-Assistent");
    expect(roleLabel("unknown")).toBe("Unbekannt");
  });

  it("fällt bei unbekannten Rollen auf 'Unbekannt' zurück", () => {
    expect(roleLabel("irgendwas")).toBe("Unbekannt");
  });
});

describe("formatDate", () => {
  it("formatiert einen ISO-Zeitstempel im deutschen Kurzformat (Datum + Uhrzeit)", () => {
    const formatted = formatDate("2026-01-15T09:30:00.000Z");
    // Europe/Berlin ist im Januar in der Normalzeit (UTC+1) — 09:30 UTC wird 10:30.
    expect(formatted).toContain("15.01.26");
    expect(formatted).toContain("10:30");
  });
});
