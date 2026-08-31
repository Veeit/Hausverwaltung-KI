import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setDbForTesting, type AppDb } from "@/db/client";
import { contractors, properties, tenants } from "@/db/schema";
import {
  RecipientNotAllowedError,
  assertAllowedRecipient,
  isAllowedRecipient,
} from "@/lib/recipients";
import { makeTestDb } from "../helpers/db";

let db: AppDb;

beforeEach(() => {
  db = makeTestDb();
  const propertyId = Number(
    db
      .insert(properties)
      .values({ address: "Musterstraße 1, 20095 Hamburg" })
      .run().lastInsertRowid,
  );
  db.insert(tenants)
    .values({
      name: "Max Mustermann",
      email: "max.mustermann@example.com",
      propertyId,
    })
    .run();
  db.insert(contractors)
    .values({
      name: "Klaus Rohr",
      email: "klaus.rohr@example.com",
      trade: "Sanitär",
    })
    .run();
});

afterEach(() => {
  setDbForTesting(null);
});

describe("isAllowedRecipient", () => {
  it("erlaubt eine hinterlegte Mieter-Adresse", () => {
    expect(isAllowedRecipient("max.mustermann@example.com")).toBe(true);
  });

  it("erlaubt eine hinterlegte Handwerker-Adresse", () => {
    expect(isAllowedRecipient("klaus.rohr@example.com")).toBe(true);
  });

  it("verbietet fremde Adressen", () => {
    expect(isAllowedRecipient("angreifer@example.com")).toBe(false);
    expect(isAllowedRecipient("")).toBe(false);
  });

  it("vergleicht case-insensitiv (DB speichert lowercase)", () => {
    expect(isAllowedRecipient("Max.Mustermann@Example.COM")).toBe(true);
    expect(isAllowedRecipient("KLAUS.ROHR@EXAMPLE.COM")).toBe(true);
  });

  // Review-Befund: Adressen mit umgebenden Leerzeichen (z.B. aus einem
  // kopierten Mail-Header) wurden vor dem Fix faelschlich abgelehnt.
  it("ignoriert umgebende Leerzeichen (kopierte Mail-Header)", () => {
    expect(isAllowedRecipient("  max.mustermann@example.com  ")).toBe(true);
    expect(isAllowedRecipient("\tklaus.rohr@example.com\n")).toBe(true);
  });
});

describe("assertAllowedRecipient", () => {
  it("wirft nicht bei erlaubter Adresse", () => {
    expect(() => assertAllowedRecipient("max.mustermann@example.com")).not.toThrow();
  });

  it("wirft RecipientNotAllowedError bei fremder Adresse", () => {
    expect(() => assertAllowedRecipient("angreifer@example.com")).toThrow(
      RecipientNotAllowedError,
    );
  });
});
