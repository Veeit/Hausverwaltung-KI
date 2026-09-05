import { describe, expect, it } from "vitest";
import {
  MAX_EMAIL_LENGTH,
  isPlausibleEmail,
  isUnitBucket,
  normalizeEmail,
  unitBucketLabel,
} from "@/lib/waitlist";

describe("normalizeEmail", () => {
  it("entfernt Rand-Leerzeichen und schreibt klein", () => {
    expect(normalizeEmail("  Max.Mustermann@Example.DE ")).toBe("max.mustermann@example.de");
  });

  it("bildet Schreibvarianten derselben Adresse auf denselben Wert ab", () => {
    // Ohne diese Normalisierung legt "Max@example.de" einen zweiten Eintrag
    // neben "max@example.de" an — die Unique-Spalte greift dann nicht.
    expect(normalizeEmail("Max@example.de")).toBe(normalizeEmail("max@EXAMPLE.de"));
  });
});

describe("isPlausibleEmail", () => {
  it.each([
    "max@example.de",
    "max.mustermann@sub.example.co.uk",
    "max+hausverwaltung@example.com",
  ])("akzeptiert %s", (adresse) => {
    expect(isPlausibleEmail(adresse)).toBe(true);
  });

  it.each([
    ["leer", ""],
    ["ohne @", "max.example.de"],
    ["ohne Punkt in der Domain", "max@example"],
    ["zwei @", "max@@example.de"],
    ["Leerzeichen innen", "max @example.de"],
    ["nichts vor dem @", "@example.de"],
    ["nichts nach dem Punkt", "max@example."],
  ])("weist %s ab", (_name, adresse) => {
    expect(isPlausibleEmail(adresse)).toBe(false);
  });

  it("weist überlange Adressen ab", () => {
    const zuLang = "a".repeat(MAX_EMAIL_LENGTH) + "@example.de";
    expect(isPlausibleEmail(zuLang)).toBe(false);
  });
});

describe("Größenklassen", () => {
  it("erkennt nur die vier vorgesehenen Werte", () => {
    expect(isUnitBucket("10-49")).toBe(true);
    // Alles andere darf nicht in die Datenbank gelangen — das Feld kommt aus
    // einem öffentlichen Formular und ist damit frei manipulierbar.
    expect(isUnitBucket("beliebiger-eigener-wert")).toBe(false);
    expect(isUnitBucket(null)).toBe(false);
  });

  it("beschriftet auch fehlende Angaben lesbar", () => {
    expect(unitBucketLabel("250+")).toBe("250 Einheiten oder mehr");
    expect(unitBucketLabel(null)).toBe("keine Angabe");
  });
});
