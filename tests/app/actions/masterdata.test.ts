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

    const result = await createTenant(
      fd({
        name: "Max Mustermann",
        email: "Max.Mustermann@Example.COM",
        propertyId: String(propertyId),
        unitLabel: "2. OG links",
        phone: "040 123456",
      }),
    );

    expect(result.error).toBeNull();
    const row = db.select().from(tenants).all()[0];
    expect(row).toBeDefined();
    expect(row.name).toBe("Max Mustermann");
    expect(row.email).toBe("max.mustermann@example.com");
    expect(row.propertyId).toBe(propertyId);
    expect(row.unitLabel).toBe("2. OG links");
    expect(row.phone).toBe("040 123456");
  });

  it("liefert bei ungültiger E-Mail eine deutsche Fehlermeldung als Rückgabewert (kein Wurf) und ändert keine Daten", async () => {
    const propertyId = seedProperty();

    const result = await createTenant(
      fd({ name: "Max", email: "keine-mail", propertyId: String(propertyId) }),
    );

    expect(result.error).toContain("gültige E-Mail");
    expect(db.select().from(tenants).all()).toHaveLength(0);
  });

  it("liefert bei bereits vergebener E-Mail eine deutsche Fehlermeldung als Rückgabewert statt eines rohen SQLite-Fehlers oder Wurfs", async () => {
    const propertyId = seedProperty();
    db.insert(tenants)
      .values({ name: "Erika Mustermann", email: "erika@example.com", propertyId })
      .run();

    const result = await createTenant(
      fd({
        name: "Zweiter Max",
        email: "Erika@Example.com",
        propertyId: String(propertyId),
      }),
    );

    expect(result.error).toContain("bereits einem anderen Mieter zugeordnet");
    expect(db.select().from(tenants).all()).toHaveLength(1);
  });

  it("liefert bei nicht existierender propertyId eine deutsche Fehlermeldung als Rückgabewert statt eines rohen SQLite-Fehlers oder Wurfs", async () => {
    const missingPropertyId = 999999;

    const result = await createTenant(
      fd({
        name: "Max Mustermann",
        email: "max@example.com",
        propertyId: String(missingPropertyId),
      }),
    );

    expect(result.error).toContain("Objekt existiert nicht mehr");
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

  it("liefert beim Ändern auf eine bereits vergebene E-Mail dieselbe deutsche Fehlermeldung als Rückgabewert und ändert nichts", async () => {
    const propertyId = seedProperty();
    db.insert(tenants)
      .values({ name: "Erika Mustermann", email: "erika@example.com", propertyId })
      .run();
    const id = Number(
      db
        .insert(tenants)
        .values({ name: "Max", email: "max@example.com", propertyId })
        .run().lastInsertRowid,
    );

    const result = await updateTenant(
      id,
      fd({ name: "Max", email: "Erika@Example.com", propertyId: String(propertyId) }),
    );

    expect(result.error).toContain("bereits einem anderen Mieter zugeordnet");
    const row = db.select().from(tenants).where(eq(tenants.id, id)).get();
    expect(row?.email).toBe("max@example.com");
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

  it("liefert bei FK-Konflikt (Mieter hat Ticket) eine deutsche Fehlermeldung als Rückgabewert und löscht nichts", async () => {
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

    const result = await deleteTenant(tenantId);

    expect(result.error).toContain("kann nicht gelöscht werden");
    expect(db.select().from(tenants).all()).toHaveLength(1);
  });
});

describe("Objekte", () => {
  it("createProperty legt ein Objekt an", async () => {
    await createProperty(fd({ address: "Beispielweg 5, 10115 Berlin" }));

    const row = db.select().from(properties).all()[0];
    expect(row?.address).toBe("Beispielweg 5, 10115 Berlin");
  });

  it("createProperty liefert bei leerer Adresse eine deutsche Fehlermeldung als Rückgabewert und legt nichts an", async () => {
    const result = await createProperty(fd({ address: "   " }));

    expect(result.error).toContain("Adresse");
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

  it("deleteProperty liefert bei FK-Konflikt (Objekt hat Mieter) eine deutsche Fehlermeldung als Rückgabewert und löscht nichts", async () => {
    const propertyId = seedProperty();
    db.insert(tenants)
      .values({ name: "Max", email: "max@example.com", propertyId })
      .run();

    const result = await deleteProperty(propertyId);

    expect(result.error).toContain("kann nicht gelöscht werden");
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

  it("createContractor liefert bei bereits vergebener E-Mail eine deutsche Fehlermeldung als Rückgabewert statt eines rohen SQLite-Fehlers oder Wurfs", async () => {
    db.insert(contractors)
      .values({ name: "Klaus Rohr", email: "klaus.rohr@example.com", trade: "Sanitär" })
      .run();

    const result = await createContractor(
      fd({ name: "Anderer Klaus", email: "Klaus.Rohr@Example.com", trade: "Elektrik" }),
    );

    expect(result.error).toContain("bereits einem anderen Handwerker zugeordnet");
    expect(db.select().from(contractors).all()).toHaveLength(1);
  });

  it("deleteContractor liefert bei FK-Konflikt (Handwerker hat Ticket) eine deutsche Fehlermeldung als Rückgabewert und löscht nichts", async () => {
    const propertyId = seedProperty();
    const tenantId = Number(
      db
        .insert(tenants)
        .values({ name: "Max", email: "max@example.com", propertyId })
        .run().lastInsertRowid,
    );
    const contractorId = Number(
      db
        .insert(contractors)
        .values({ name: "Klaus Rohr", email: "klaus.rohr@example.com", trade: "Sanitär" })
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
        contractorId,
        type: "reparatur",
        title: "Heizung defekt",
      })
      .run();

    const result = await deleteContractor(contractorId);

    expect(result.error).toContain("kann nicht gelöscht werden");
    expect(db.select().from(contractors).all()).toHaveLength(1);
  });
});
