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

  // Review-Befund Punkt 2: Eine genehmigte approvals-Zeile allein reicht NICHT
  // mehr — tickets.contractorId ist die einzige Quelle der Wahrheit für "aktuell
  // beauftragt". Ohne dieses Verhalten würde ein einmal genehmigter Handwerker
  // den Vorgang für immer behalten, selbst wenn der Vermieter später einen
  // anderen Handwerker beauftragt (siehe den folgenden Test).
  it("Handwerker: eine genehmigte approvals-Zeile allein genügt NICHT mehr, wenn tickets.contractorId nicht gesetzt ist", () => {
    const { annaTicketId, contractorId } = seedWorld();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
    ).toBeNull();
    warnSpy.mockRestore();
  });

  // Kernszenario aus dem Restbefund: Klaus wird für HV-n genehmigt (tickets.
  // contractorId → Klaus). Der Vermieter beauftragt danach Sven für denselben
  // Vorgang (zweite Genehmigung überschreibt tickets.contractorId → Sven).
  // Klaus' alte approvals-Zeile bleibt "genehmigt" — trotzdem darf sein
  // Betreff-Tag NICHT mehr aufgelöst werden, sonst bekäme er Monate später
  // per "Re: [HV-n]" weiterhin den kompletten Vorgang samt Mieter-Stammdaten
  // in seinen KI-Kontext und könnte sich sogar einen Termin bestätigen lassen.
  it("Handwerker: ein früher beauftragter Handwerker verliert den Zugriff, sobald ein ANDERER Handwerker für dasselbe Ticket beauftragt wird", () => {
    const { annaTicketId } = seedWorld();
    const klausId = Number(
      db
        .insert(contractors)
        .values({ name: "Klaus Rohr", email: "klaus.rohr@example.com", trade: "Sanitär" })
        .run().lastInsertRowid,
    );
    const svenId = Number(
      db
        .insert(contractors)
        .values({ name: "Sven Schloss", email: "sven.neu@example.com", trade: "Schlüsseldienst" })
        .run().lastInsertRowid,
    );
    // Klaus wird beauftragt (approveApproval-Ergebnis nachgebildet: Genehmigung
    // UND tickets.contractorId werden dort gemeinsam gesetzt).
    db.insert(approvals)
      .values({
        ticketId: annaTicketId,
        summary: "Schloss tauschen",
        contractorId: klausId,
        emailSubject: "Auftrag",
        emailBody: "Bitte Termin nennen.",
        status: "genehmigt",
      })
      .run();
    db.update(tickets).set({ contractorId: klausId }).where(eq(tickets.id, annaTicketId)).run();
    // Klaus ist zu diesem Zeitpunkt berechtigt.
    expect(
      resolveAuthorizedTaggedTicketId({
        subject: `Re: [HV-${annaTicketId}]`,
        role: "contractor",
        fromEmail: "klaus.rohr@example.com",
        conversationId: 1,
      }),
    ).toBe(annaTicketId);

    // Der Vermieter beauftragt danach Sven für denselben Vorgang — Klaus' alte
    // Zeile bleibt "genehmigt", aber tickets.contractorId zeigt jetzt auf Sven.
    db.insert(approvals)
      .values({
        ticketId: annaTicketId,
        summary: "Schloss tauschen (zweiter Versuch)",
        contractorId: svenId,
        emailSubject: "Auftrag (neu)",
        emailBody: "Bitte Termin nennen.",
        status: "genehmigt",
      })
      .run();
    db.update(tickets).set({ contractorId: svenId }).where(eq(tickets.id, annaTicketId)).run();

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const klausResult = resolveAuthorizedTaggedTicketId({
      subject: `Re: [HV-${annaTicketId}]`,
      role: "contractor",
      fromEmail: "klaus.rohr@example.com",
      conversationId: 1,
    });
    expect(klausResult).toBeNull();
    warnSpy.mockRestore();

    // Sven (der jetzt aktuell Beauftragte) ist hingegen berechtigt.
    expect(
      resolveAuthorizedTaggedTicketId({
        subject: `Re: [HV-${annaTicketId}]`,
        role: "contractor",
        fromEmail: "sven.neu@example.com",
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

  // Review-Befund Punkt 4: Steht dieselbe Adresse SOWOHL als Mieter ALS AUCH
  // als Handwerker in den Stammdaten (realistisch, z. B. ein Hausmeister, der
  // selbst im Haus wohnt), gewinnt bei der Rollenklassifikation beim Ingest
  // (worker/processor.ts) immer der Mieter — die gespeicherte Nachricht trägt
  // also role="tenant", obwohl die Person hier als Handwerkerin für ein
  // FREMDES Ticket antwortet. Ohne Prüfung BEIDER Zweige würde ihr Betreff-Tag
  // grundlos verworfen und ihre Terminantwort liefe ins Leere.
  it("Doppelrolle (Mieter UND Handwerker mit derselben Adresse): Betreff-Tag eines Vorgangs, für den die Person als Handwerker beauftragt ist, wird trotz Rolle 'tenant' aufgelöst", () => {
    const { propertyId, bertId } = seedWorld();
    // Carla wohnt selbst im Haus (Mieterin) UND ist als Hausmeisterin/
    // Handwerkerin hinterlegt — beide Stammdatensätze teilen sich dieselbe
    // E-Mail-Adresse.
    db.insert(tenants)
      .values({ name: "Carla Hausmeisterin", email: "carla@example.com", propertyId })
      .run();
    const carlaContractorId = Number(
      db
        .insert(contractors)
        .values({ name: "Carla Hausmeisterin", email: "carla@example.com", trade: "Hausmeisterei" })
        .run().lastInsertRowid,
    );
    // Bert (ein ANDERER Mieter) hat einen Vorgang, für den Carla als
    // Handwerkerin beauftragt ist.
    const bertConvId = Number(
      db
        .insert(conversations)
        .values({ counterpartType: "tenant", counterpartId: bertId, counterpartEmail: "bert@example.com" })
        .run().lastInsertRowid,
    );
    const bertTicketId = Number(
      db
        .insert(tickets)
        .values({
          tenantId: bertId,
          conversationId: bertConvId,
          type: "reparatur",
          title: "Fallrohr verstopft",
          contractorId: carlaContractorId,
        })
        .run().lastInsertRowid,
    );

    // worker/processor.ts würde diese Nachricht als role "tenant" einstufen
    // (Mieter-Lookup gewinnt) — trotzdem muss der Handwerker-Zweig greifen.
    const result = resolveAuthorizedTaggedTicketId({
      subject: `Re: [HV-${bertTicketId}]`,
      role: "tenant",
      fromEmail: "carla@example.com",
      conversationId: 1,
    });

    expect(result).toBe(bertTicketId);
  });

  // Kehrseite von Punkt 4: Die Doppelrolle darf NICHT zu einem Zugriff auf
  // fremde Vorgänge führen, für die die Person weder Mieterin noch beauftragte
  // Handwerkerin ist.
  it("Doppelrolle (Mieter UND Handwerker): kein Zugriff auf einen Vorgang, an dem die Person weder als Mieterin noch als beauftragte Handwerkerin beteiligt ist", () => {
    const { propertyId, annaTicketId } = seedWorld();
    db.insert(tenants)
      .values({ name: "Carla Hausmeisterin", email: "carla@example.com", propertyId })
      .run();
    db.insert(contractors)
      .values({ name: "Carla Hausmeisterin", email: "carla@example.com", trade: "Hausmeisterei" })
      .run();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = resolveAuthorizedTaggedTicketId({
      subject: `Re: [HV-${annaTicketId}]`, // Annas Ticket — Carla ist weder Mieterin noch Handwerkerin dieses Vorgangs
      role: "tenant",
      fromEmail: "carla@example.com",
      conversationId: 1,
    });

    expect(result).toBeNull();
    warnSpy.mockRestore();
  });
});
