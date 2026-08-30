import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { setDbForTesting, type AppDb } from "@/db/client";
import { approvals, contractors, conversations, properties, tenants, tickets } from "@/db/schema";
import { makeTestDb } from "../helpers/db";
import { resolveAuthorizedTaggedTicketId } from "@/lib/ticketAccess";

let db: AppDb;

beforeEach(() => {
  db = makeTestDb();
});

afterEach(() => {
  setDbForTesting(null);
});

function seedWorld() {
  const propertyId = Number(
    db.insert(properties).values({ address: "Musterstraße 1, 20095 Hamburg" }).run().lastInsertRowid,
  );
  const annaId = Number(
    db
      .insert(tenants)
      .values({ name: "Anna Mieterin", email: "anna@example.com", propertyId })
      .run().lastInsertRowid,
  );
  const bertId = Number(
    db
      .insert(tenants)
      .values({ name: "Bert Mieter", email: "bert@example.com", propertyId })
      .run().lastInsertRowid,
  );
  const annaConvId = Number(
    db
      .insert(conversations)
      .values({ counterpartType: "tenant", counterpartId: annaId, counterpartEmail: "anna@example.com" })
      .run().lastInsertRowid,
  );
  const annaTicketId = Number(
    db
      .insert(tickets)
      .values({
        tenantId: annaId,
        conversationId: annaConvId,
        type: "reparatur",
        title: "Vertretersuche",
        summary: "tagsüber nie zuhause, Schlüssel unter der Matte",
      })
      .run().lastInsertRowid,
  );
  const contractorId = Number(
    db
      .insert(contractors)
      .values({ name: "Sven Schloss", email: "sven.schloss@example.com", trade: "Schlüsseldienst" })
      .run().lastInsertRowid,
  );
  return { propertyId, annaId, bertId, annaConvId, annaTicketId, contractorId };
}

describe("resolveAuthorizedTaggedTicketId", () => {
  it("liefert null ohne Tag im Betreff", () => {
    expect(
      resolveAuthorizedTaggedTicketId({
        subject: "Guten Tag",
        role: "tenant",
        fromEmail: "anna@example.com",
        conversationId: 1,
      }),
    ).toBeNull();
  });

  it("liefert null, wenn das getaggte Ticket nicht existiert", () => {
    expect(
      resolveAuthorizedTaggedTicketId({
        subject: "Re: [HV-999]",
        role: "tenant",
        fromEmail: "anna@example.com",
        conversationId: 1,
      }),
    ).toBeNull();
  });

  it("Mieter: eigenes Ticket wird über den Tag aufgelöst", () => {
    const { annaTicketId, annaConvId } = seedWorld();
    expect(
      resolveAuthorizedTaggedTicketId({
        subject: `Re: [HV-${annaTicketId}]`,
        role: "tenant",
        fromEmail: "anna@example.com",
        conversationId: annaConvId,
      }),
    ).toBe(annaTicketId);
  });

  // Kernszenario aus dem Review: Bert (anderer Mieter) nennt Annas Ticket-Tag.
  it("Mieter: fremdes Ticket wird trotz korrektem Tag NICHT aufgelöst — kein Datenzugriff auf Annas Vorgang", () => {
    const { annaTicketId, bertId } = seedWorld();
    const bertConvId = Number(
      db
        .insert(conversations)
        .values({ counterpartType: "tenant", counterpartId: bertId, counterpartEmail: "bert@example.com" })
        .run().lastInsertRowid,
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = resolveAuthorizedTaggedTicketId({
      subject: `Re: [HV-${annaTicketId}]`,
      role: "tenant",
      fromEmail: "bert@example.com",
      conversationId: bertConvId,
    });

    expect(result).toBeNull();
    // Ein verworfener Tag wird protokolliert, damit wiederholtes Raten fremder
    // Vorgangsnummern im Log auffällt.
    expect(warnSpy).toHaveBeenCalled();
    const logged = warnSpy.mock.calls.map((c) => c.join(" ")).join(" ");
    expect(logged).toContain(`HV-${annaTicketId}`);
    expect(logged).toContain("bert@example.com");
    warnSpy.mockRestore();
  });

  it("Mieter: unbekannte Absenderadresse mit fremdem Tag wird abgelehnt", () => {
    const { annaTicketId } = seedWorld();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      resolveAuthorizedTaggedTicketId({
        subject: `Re: [HV-${annaTicketId}]`,
        role: "tenant",
        fromEmail: "unbekannt@example.com",
        conversationId: 1,
      }),
    ).toBeNull();
    warnSpy.mockRestore();
  });

  it("Handwerker: beauftragt über tickets.contractorId — Tag wird aufgelöst", () => {
    const { annaTicketId, contractorId } = seedWorld();
    db.update(tickets).set({ contractorId }).where(eq(tickets.id, annaTicketId)).run();
    expect(
      resolveAuthorizedTaggedTicketId({
        subject: `Re: [HV-${annaTicketId}]`,
        role: "contractor",
        fromEmail: "sven.schloss@example.com",
        conversationId: 1,
      }),
    ).toBe(annaTicketId);
  });

  it("Handwerker: genehmigte approvals-Zeile für dieses Ticket genügt auch ohne gesetztes tickets.contractorId", () => {
    const { annaTicketId, contractorId } = seedWorld();
    db.insert(approvals)
      .values({
        ticketId: annaTicketId,
        summary: "Schloss tauschen",
        contractorId,
        emailSubject: "Auftrag",
        emailBody: "Bitte Termin nennen.",
        status: "genehmigt",
      })
      .run();
    expect(
      resolveAuthorizedTaggedTicketId({
        subject: `Re: [HV-${annaTicketId}]`,
        role: "contractor",
        fromEmail: "sven.schloss@example.com",
        conversationId: 1,
      }),
    ).toBe(annaTicketId);
  });

  // Kernszenario aus dem Review: irgendein hinterlegter Handwerker nennt einen
  // fremden Ticket-Tag, ohne für den Vorgang beauftragt zu sein.
  it("Handwerker: nicht beauftragt (kein contractorId-Match, keine genehmigte approvals-Zeile) — Tag wird verworfen", () => {
    const { annaTicketId, contractorId } = seedWorld();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = resolveAuthorizedTaggedTicketId({
      subject: `Re: [HV-${annaTicketId}]`,
      role: "contractor",
      fromEmail: "sven.schloss@example.com",
      conversationId: 1,
    });

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    void contractorId;
    warnSpy.mockRestore();
  });

  it("Handwerker: eine NICHT genehmigte (offene) approvals-Zeile genügt nicht", () => {
    const { annaTicketId, contractorId } = seedWorld();
    db.insert(approvals)
      .values({
        ticketId: annaTicketId,
        summary: "Schloss tauschen",
        contractorId,
        emailSubject: "Auftrag",
        emailBody: "Bitte Termin nennen.",
        status: "offen",
      })
      .run();
    expect(
      resolveAuthorizedTaggedTicketId({
        subject: `Re: [HV-${annaTicketId}]`,
        role: "contractor",
        fromEmail: "sven.schloss@example.com",
        conversationId: 1,
      }),
    ).toBeNull();
  });

  it("Vermieter-Rolle: Tag berechtigt nie (landlord-Nachrichten hängen ihr Ticket explizit an, nicht über den Betreff)", () => {
    const { annaTicketId } = seedWorld();
    expect(
      resolveAuthorizedTaggedTicketId({
        subject: `Re: [HV-${annaTicketId}]`,
        role: "landlord",
        fromEmail: "vermieter@dashboard.intern",
        conversationId: 1,
      }),
    ).toBeNull();
  });
});
