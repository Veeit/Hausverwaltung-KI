import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { setDbForTesting, type AppDb } from "@/db/client";
import { conversations, properties, tenants, tickets } from "@/db/schema";
import {
  TICKET_STATUSES,
  TICKET_TRANSITIONS,
  InvalidTransitionError,
  canTransition,
  createTicket,
  transitionTicket,
  type TicketStatus,
} from "@/lib/tickets";
import { makeTestDb } from "../helpers/db";

let db: AppDb;

beforeEach(() => {
  db = makeTestDb();
});

afterEach(() => {
  setDbForTesting(null);
});

function seedTenantAndConversation(): { tenantId: number; conversationId: number } {
  const propertyId = Number(
    db
      .insert(properties)
      .values({ address: "Musterstraße 1, 20095 Hamburg" })
      .run().lastInsertRowid,
  );
  const tenantId = Number(
    db
      .insert(tenants)
      .values({
        name: "Max Mustermann",
        email: "max.mustermann@example.com",
        propertyId,
      })
      .run().lastInsertRowid,
  );
  const conversationId = Number(
    db
      .insert(conversations)
      .values({
        counterpartType: "tenant",
        counterpartId: tenantId,
        counterpartEmail: "max.mustermann@example.com",
      })
      .run().lastInsertRowid,
  );
  return { tenantId, conversationId };
}

describe("canTransition", () => {
  it.each([
    ["neu", "infosammlung"],
    ["neu", "wartet_auf_genehmigung"],
    ["neu", "erledigt"],
    ["infosammlung", "wartet_auf_genehmigung"],
    ["infosammlung", "eskaliert"],
    ["wartet_auf_genehmigung", "genehmigt"],
    ["wartet_auf_genehmigung", "abgelehnt"],
    ["genehmigt", "handwerker_angefragt"],
    ["handwerker_angefragt", "terminiert"],
    ["terminiert", "erledigt"],
    ["eskaliert", "terminiert"],
    ["abgelehnt", "infosammlung"],
  ] as Array<[TicketStatus, TicketStatus]>)("erlaubt %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ["neu", "genehmigt"],
    ["neu", "terminiert"],
    ["infosammlung", "handwerker_angefragt"],
    ["wartet_auf_genehmigung", "handwerker_angefragt"],
    ["genehmigt", "erledigt"],
    ["terminiert", "neu"],
    ["abgelehnt", "genehmigt"],
  ] as Array<[TicketStatus, TicketStatus]>)("verbietet %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("erledigt ist terminal: kein Übergang in irgendeinen Status erlaubt", () => {
    for (const to of TICKET_STATUSES) {
      expect(canTransition("erledigt", to)).toBe(false);
    }
    expect(TICKET_TRANSITIONS.erledigt).toEqual([]);
  });

  it("wirft bei unbekanntem Ausgangsstatus eine aussagekräftige Fehlermeldung statt eines TypeError", () => {
    const unbekannt = "archiviert" as TicketStatus;
    expect(() => canTransition(unbekannt, "erledigt")).toThrow(/archiviert/);
    expect(() => canTransition(unbekannt, "erledigt")).not.toThrow(TypeError);
  });
});

describe("InvalidTransitionError", () => {
  it("trägt den Namen 'InvalidTransitionError' statt des generischen 'Error'", () => {
    const err = new InvalidTransitionError("Testfehler");
    expect(err.name).toBe("InvalidTransitionError");
  });
});

describe("createTicket", () => {
  it("legt ein Ticket mit Defaults an: status 'neu', collectedInfo '{}'", () => {
    const { tenantId, conversationId } = seedTenantAndConversation();

    const id = createTicket({
      tenantId,
      conversationId,
      type: "reparatur",
      title: "Türschloss defekt",
    });

    const row = db.select().from(tickets).where(eq(tickets.id, id)).get();
    expect(row).toBeDefined();
    expect(row?.status).toBe("neu");
    expect(row?.collectedInfo).toBe("{}");
    expect(row?.type).toBe("reparatur");
    expect(row?.title).toBe("Türschloss defekt");
    expect(row?.summary).toBeNull();
    expect(row?.urgency).toBeNull();
    expect(row?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("übernimmt die optionalen Felder summary und urgency", () => {
    const { tenantId, conversationId } = seedTenantAndConversation();

    const id = createTicket({
      tenantId,
      conversationId,
      type: "reparatur",
      title: "Türschloss defekt",
      summary: "Schloss klemmt seit gestern",
      urgency: "hoch",
    });

    const row = db.select().from(tickets).where(eq(tickets.id, id)).get();
    expect(row?.summary).toBe("Schloss klemmt seit gestern");
    expect(row?.urgency).toBe("hoch");
  });
});

describe("transitionTicket", () => {
  it("führt einen gültigen Übergang aus und aktualisiert updatedAt", () => {
    const { tenantId, conversationId } = seedTenantAndConversation();
    const id = createTicket({
      tenantId,
      conversationId,
      type: "reparatur",
      title: "Türschloss defekt",
    });
    // updatedAt künstlich in die Vergangenheit setzen, damit die Änderung
    // auch bei gleicher Millisekunde messbar ist:
    db.update(tickets)
      .set({ updatedAt: "2020-01-01T00:00:00.000Z" })
      .where(eq(tickets.id, id))
      .run();

    transitionTicket(id, "infosammlung");

    const row = db.select().from(tickets).where(eq(tickets.id, id)).get();
    expect(row?.status).toBe("infosammlung");
    expect(row?.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
    expect(row?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("wirft InvalidTransitionError bei ungültigem Übergang und lässt das Ticket unverändert", () => {
    const { tenantId, conversationId } = seedTenantAndConversation();
    const id = createTicket({
      tenantId,
      conversationId,
      type: "reparatur",
      title: "Türschloss defekt",
    });

    expect(() => transitionTicket(id, "genehmigt")).toThrow(InvalidTransitionError);
    expect(() => transitionTicket(id, "genehmigt")).toThrow(
      "Ungültiger Statuswechsel: neu → genehmigt",
    );

    const row = db.select().from(tickets).where(eq(tickets.id, id)).get();
    expect(row?.status).toBe("neu");
  });

  it("force überschreibt die Übergangsprüfung", () => {
    const { tenantId, conversationId } = seedTenantAndConversation();
    const id = createTicket({
      tenantId,
      conversationId,
      type: "reparatur",
      title: "Türschloss defekt",
    });
    transitionTicket(id, "erledigt"); // neu → erledigt ist gültig

    // erledigt → infosammlung ist normal verboten (erledigt ist terminal):
    expect(() => transitionTicket(id, "infosammlung")).toThrow(InvalidTransitionError);

    transitionTicket(id, "infosammlung", { force: true });

    const row = db.select().from(tickets).where(eq(tickets.id, id)).get();
    expect(row?.status).toBe("infosammlung");
  });

  it("wirft Error, wenn das Ticket nicht existiert", () => {
    expect(() => transitionTicket(999, "erledigt")).toThrow("Ticket 999 nicht gefunden");
  });

  it("wirft eine aussagekräftige Fehlermeldung statt eines TypeError, wenn das Ticket in der Datenbank einen unbekannten Ausgangsstatus hat", () => {
    const { tenantId, conversationId } = seedTenantAndConversation();
    const id = createTicket({
      tenantId,
      conversationId,
      type: "reparatur",
      title: "Türschloss defekt",
    });
    // Simuliert Altbestand/direkten DB-Zugriff mit einem Status, den die
    // Statusmaschine nicht kennt.
    db.update(tickets).set({ status: "archiviert" }).where(eq(tickets.id, id)).run();

    expect(() => transitionTicket(id, "erledigt")).toThrow(/archiviert/);
    expect(() => transitionTicket(id, "erledigt")).not.toThrow(TypeError);
  });
});
