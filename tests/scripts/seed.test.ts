import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDbForTesting, type AppDb } from "@/db/client";
import { contractors, properties, tenants } from "@/db/schema";
import { runSeed } from "../../scripts/seed";
import { makeTestDb } from "../helpers/db";

let db: AppDb;

beforeEach(() => {
  db = makeTestDb();
});

afterEach(() => {
  setDbForTesting(null);
});

describe("scripts/seed.ts", () => {
  it("legt Stammdaten an: 1 Objekt, 2 Mieter, 3 Handwerker", () => {
    runSeed();

    const props = db.select().from(properties).all();
    expect(props).toHaveLength(1);
    expect(props[0]!.address).toBe("Musterstraße 1, 20095 Hamburg");

    const tenantRows = db.select().from(tenants).all();
    expect(tenantRows).toHaveLength(2);
    expect(tenantRows.every((t) => t.propertyId === props[0]!.id)).toBe(true);
    const max = tenantRows.find((t) => t.email === "max.mustermann@example.com");
    expect(max?.name).toBe("Max Mustermann");
    expect(max?.unitLabel).toBe("2. OG links");
    const erika = tenantRows.find((t) => t.email === "erika.beispiel@example.com");
    expect(erika?.name).toBe("Erika Beispiel");
    expect(erika?.unitLabel).toBe("EG rechts");

    const contractorRows = db.select().from(contractors).all();
    expect(contractorRows).toHaveLength(3);
    const klaus = contractorRows.find((c) => c.email === "klaus.rohr@example.com");
    expect(klaus?.name).toBe("Klaus Rohr");
    expect(klaus?.trade).toBe("Sanitär");
    const elke = contractorRows.find((c) => c.email === "elke.blitz@example.com");
    expect(elke?.name).toBe("Elke Blitz");
    expect(elke?.trade).toBe("Elektrik");
    const sven = contractorRows.find((c) => c.email === "sven.schloss@example.com");
    expect(sven?.name).toBe("Sven Schloss");
    expect(sven?.trade).toBe("Schlüsseldienst");
  });

  it("ist idempotent: zweiter Lauf erzeugt keine Duplikate", () => {
    runSeed();
    runSeed();

    expect(db.select().from(properties).all()).toHaveLength(1);
    expect(db.select().from(tenants).all()).toHaveLength(2);
    expect(db.select().from(contractors).all()).toHaveLength(3);
  });
});
