import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { setDbForTesting, type AppDb } from "@/db/client";
import { contractors, conversations, properties, tenants, tickets } from "@/db/schema";
import { sha256Hex } from "@/lib/auth";
import { makeTestDb } from "../../helpers/db";
import { setAuthCookieValue } from "../../helpers/nextMocks";
import {
  createContractor,
  createProperty,
  createTenant,
  deleteContractor,
  deleteProperty,
  deleteTenant,
  updateContractor,
  updateProperty,
  updateTenant,
} from "@/app/actions/masterdata";

// MUSTER für alle Action-Tests (Tasks 12–16): Die drei Next.js-Mocks stehen
// in JEDER Action-Testdatei explizit, weil vi.mock gehoisted wird (siehe
// Kommentar in tests/helpers/nextMocks.ts). Die Factories werden per
// dynamischem Import geladen, damit die Hoisting-Regel nicht verletzt wird.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async () => {
  const { redirectStub } = await import("../../helpers/nextMocks");
  return { redirect: vi.fn(redirectStub) };
});
vi.mock("next/headers", async () => {
  const { cookiesStub } = await import("../../helpers/nextMocks");
  return { cookies: vi.fn(async () => cookiesStub()) };
});

let db: AppDb;

beforeAll(async () => {
  // Pflicht-Env für getEnv-abhängige Codepfade; DASHBOARD_PASSWORD MUSS vor
  // der Hash-Berechnung gesetzt sein, damit requireAuth() das Cookie akzeptiert.
  process.env.ANTHROPIC_API_KEY = "test";
  process.env.MAIL_USER = "test";
  process.env.MAIL_PASSWORD = "test";
  process.env.MAIL_ALIAS = "hausverwaltung@example.com";
  process.env.DASHBOARD_PASSWORD = "test-passwort";
  setAuthCookieValue(await sha256Hex("test-passwort"));
});

beforeEach(() => {
  db = makeTestDb();
});

afterEach(() => {
  setDbForTesting(null);
});

function fd(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }
  return formData;
}

function seedProperty(): number {
  const result = db
    .insert(properties)
    .values({ address: "Musterstraße 1, 20095 Hamburg" })
    .run();
  return Number(result.lastInsertRowid);
}

describe("createTenant", () => {
  it("legt einen Mieter an und speichert die E-Mail lowercase", async () => {
    const propertyId = seedProperty();

    await createTenant(
      fd({
        name: "Max Mustermann",
        email: "Max.Mustermann@Example.COM",
        propertyId: String(propertyId),
        unitLabel: "2. OG links",
        phone: "040 123456",
      }),
    );

    const row = db.select().from(tenants).all()[0];
    expect(row).toBeDefined();
    expect(row.name).toBe("Max Mustermann");
    expect(row.email).toBe("max.mustermann@example.com");
    expect(row.propertyId).toBe(propertyId);
    expect(row.unitLabel).toBe("2. OG links");
    expect(row.phone).toBe("040 123456");
  });

  it("wirft bei ungültiger E-Mail eine deutsche Fehlermeldung", async () => {
    const propertyId = seedProperty();

    await expect(
      createTenant(
        fd({ name: "Max", email: "keine-mail", propertyId: String(propertyId) }),
      ),
    ).rejects.toThrow("gültige E-Mail");
    expect(db.select().from(tenants).all()).toHaveLength(0);
  });
});

describe("updateTenant", () => {
  it("aktualisiert Name und E-Mail (lowercase)", async () => {
    const propertyId = seedProperty();
    const id = Number(
      db
        .insert(tenants)
        .values({ name: "Max", email: "max@example.com", propertyId })
        .run().lastInsertRowid,
    );

    await updateTenant(
      id,
      fd({
        name: "Maximilian Mustermann",
        email: "NEU@Example.com",
        propertyId: String(propertyId),
      }),
    );

    const row = db.select().from(tenants).where(eq(tenants.id, id)).get();
    expect(row?.name).toBe("Maximilian Mustermann");
    expect(row?.email).toBe("neu@example.com");
  });
});

describe("deleteTenant", () => {
  it("löscht einen Mieter ohne abhängige Daten", async () => {
    const propertyId = seedProperty();
    const id = Number(
      db
        .insert(tenants)
        .values({ name: "Max", email: "max@example.com", propertyId })
        .run().lastInsertRowid,
    );

    await deleteTenant(id);

    expect(db.select().from(tenants).all()).toHaveLength(0);
  });

  it("wirft bei FK-Konflikt (Mieter hat Ticket) eine deutsche Fehlermeldung", async () => {
    const propertyId = seedProperty();
    const tenantId = Number(
      db
        .insert(tenants)
        .values({ name: "Max", email: "max@example.com", propertyId })
        .run().lastInsertRowid,
    );
    const conversationId = Number(
      db
        .insert(conversations)
        .values({
          counterpartType: "tenant",
          counterpartId: tenantId,
          counterpartEmail: "max@example.com",
        })
        .run().lastInsertRowid,
    );
    db.insert(tickets)
      .values({
        tenantId,
        conversationId,
        type: "reparatur",
        title: "Türschloss klemmt",
      })
      .run();

    await expect(deleteTenant(tenantId)).rejects.toThrow("kann nicht gelöscht werden");
    expect(db.select().from(tenants).all()).toHaveLength(1);
  });
});

describe("Objekte", () => {
  it("createProperty legt ein Objekt an", async () => {
    await createProperty(fd({ address: "Beispielweg 5, 10115 Berlin" }));

    const row = db.select().from(properties).all()[0];
    expect(row?.address).toBe("Beispielweg 5, 10115 Berlin");
  });

  it("createProperty wirft bei leerer Adresse eine deutsche Fehlermeldung", async () => {
    await expect(createProperty(fd({ address: "   " }))).rejects.toThrow("Adresse");
    expect(db.select().from(properties).all()).toHaveLength(0);
  });

  it("updateProperty ändert die Adresse", async () => {
    const id = seedProperty();

    await updateProperty(id, fd({ address: "Neue Straße 2, 22083 Hamburg" }));

    const row = db.select().from(properties).where(eq(properties.id, id)).get();
    expect(row?.address).toBe("Neue Straße 2, 22083 Hamburg");
  });

  it("deleteProperty löscht ein Objekt ohne Mieter", async () => {
    const id = seedProperty();

    await deleteProperty(id);

    expect(db.select().from(properties).all()).toHaveLength(0);
  });

  it("deleteProperty wirft bei FK-Konflikt (Objekt hat Mieter) eine deutsche Fehlermeldung", async () => {
    const propertyId = seedProperty();
    db.insert(tenants)
      .values({ name: "Max", email: "max@example.com", propertyId })
      .run();

    await expect(deleteProperty(propertyId)).rejects.toThrow("kann nicht gelöscht werden");
    expect(db.select().from(properties).all()).toHaveLength(1);
  });
});

describe("Handwerker", () => {
  it("createContractor legt einen Handwerker mit lowercase-E-Mail an", async () => {
    await createContractor(
      fd({ name: "Klaus Rohr", email: "Klaus.Rohr@Example.com", trade: "Sanitär" }),
    );

    const row = db.select().from(contractors).all()[0];
    expect(row?.email).toBe("klaus.rohr@example.com");
    expect(row?.trade).toBe("Sanitär");
  });

  it("updateContractor aktualisiert Gewerk und E-Mail (lowercase)", async () => {
    const id = Number(
      db
        .insert(contractors)
        .values({ name: "Klaus Rohr", email: "klaus.rohr@example.com", trade: "Sanitär" })
        .run().lastInsertRowid,
    );

    await updateContractor(
      id,
      fd({ name: "Klaus Rohr", email: "Klaus@Neu.de", trade: "Heizung & Sanitär" }),
    );

    const row = db.select().from(contractors).where(eq(contractors.id, id)).get();
    expect(row?.email).toBe("klaus@neu.de");
    expect(row?.trade).toBe("Heizung & Sanitär");
  });

  it("deleteContractor löscht einen Handwerker ohne abhängige Daten", async () => {
    const id = Number(
      db
        .insert(contractors)
        .values({ name: "Klaus Rohr", email: "klaus.rohr@example.com", trade: "Sanitär" })
        .run().lastInsertRowid,
    );

    await deleteContractor(id);

    expect(db.select().from(contractors).all()).toHaveLength(0);
  });
});
