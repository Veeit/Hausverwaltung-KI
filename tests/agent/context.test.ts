import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTranscript, buildUserContent, loadTriggerInfo } from "@/agent/context";
import { setDbForTesting, type AppDb } from "@/db/client";
import {
  approvals,
  attachments,
  contractors,
  conversations,
  messages,
  properties,
  tenants,
  tickets,
} from "@/db/schema";
import { makeTestDb } from "../helpers/db";

// Minimal gültiges 1x1-PNG (Inhalt ist für den Test egal — es zählt der Byte-Roundtrip)
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let db: AppDb;

beforeEach(() => {
  db = makeTestDb();
});

afterEach(() => {
  setDbForTesting(null);
});

function seedTenantWorld(): { propertyId: number; tenantId: number; conversationId: number } {
  const propertyId = Number(
    db.insert(properties).values({ address: "Musterstraße 1, 20095 Hamburg" }).run().lastInsertRowid,
  );
  const tenantId = Number(
    db
      .insert(tenants)
      .values({
        name: "Max Mustermann",
        email: "max@example.com",
        propertyId,
        unitLabel: "2. OG links",
      })
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
  return { propertyId, tenantId, conversationId };
}

function insertMessage(input: {
  conversationId: number;
  role: string;
  body: string;
  fromEmail?: string;
  subject?: string | null;
  ticketId?: number | null;
  direction?: string;
}): number {
  return Number(
    db
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        ticketId: input.ticketId ?? null,
        direction: input.direction ?? "inbound",
        role: input.role,
        fromEmail: input.fromEmail ?? "max@example.com",
        toEmail: "hausverwaltung@example.com",
        subject: input.subject ?? null,
        body: input.body,
      })
      .run().lastInsertRowid,
  );
}

describe("buildTranscript", () => {
  it("formatiert Nachrichten chronologisch mit Rollenlabel und Absender", () => {
    const { conversationId } = seedTenantWorld();
    insertMessage({ conversationId, role: "tenant", body: "Hallo, mein Schloss klemmt." });
    insertMessage({
      conversationId,
      role: "ai",
      direction: "outbound",
      fromEmail: "hausverwaltung@example.com",
      body: "Guten Tag, seit wann klemmt es?",
    });

    const transcript = buildTranscript(conversationId);

    expect(transcript).toContain("— Mieter (max@example.com):\nHallo, mein Schloss klemmt.");
    expect(transcript).toContain(
      "— KI-Assistent (hausverwaltung@example.com):\nGuten Tag, seit wann klemmt es?",
    );
    expect(transcript.startsWith("### ")).toBe(true);
    // Chronologisch: Mieter-Nachricht kommt vor der KI-Antwort
    expect(transcript.indexOf("Hallo, mein Schloss klemmt.")).toBeLessThan(
      transcript.indexOf("Guten Tag, seit wann klemmt es?"),
    );
  });

  it("lässt excludeMessageId aus", () => {
    const { conversationId } = seedTenantWorld();
    insertMessage({ conversationId, role: "tenant", body: "Erste Nachricht." });
    const second = insertMessage({ conversationId, role: "tenant", body: "Zweite Nachricht." });

    const transcript = buildTranscript(conversationId, second);

    expect(transcript).toContain("Erste Nachricht.");
    expect(transcript).not.toContain("Zweite Nachricht.");
  });

  it("begrenzt auf die letzten limit Nachrichten", () => {
    const { conversationId } = seedTenantWorld();
    insertMessage({ conversationId, role: "tenant", body: "eins" });
    insertMessage({ conversationId, role: "tenant", body: "zwei" });
    insertMessage({ conversationId, role: "tenant", body: "drei" });

    const transcript = buildTranscript(conversationId, undefined, 2);

    expect(transcript).not.toContain("eins");
    expect(transcript).toContain("zwei");
    expect(transcript).toContain("drei");
  });

  it("kennt alle Rollenlabels", () => {
    const { conversationId } = seedTenantWorld();
    insertMessage({
      conversationId,
      role: "landlord",
      fromEmail: "vermieter@dashboard.intern",
      body: "Bitte beauftragen.",
    });
    insertMessage({
      conversationId,
      role: "contractor",
      fromEmail: "sven.schloss@example.com",
      body: "Dienstag passt.",
    });
    insertMessage({
      conversationId,
      role: "unknown",
      fromEmail: "fremd@example.com",
      body: "Wer sind Sie?",
    });

    const transcript = buildTranscript(conversationId);

    expect(transcript).toContain("— Vermieter (vermieter@dashboard.intern):");
    expect(transcript).toContain("— Handwerker (sven.schloss@example.com):");
    expect(transcript).toContain("— Unbekannt (fremd@example.com):");
  });
});

describe("loadTriggerInfo", () => {
  it("tenant_message: Mieter mit Objektadresse, kein Ticket", () => {
    const { tenantId, conversationId } = seedTenantWorld();
    const msgId = insertMessage({
      conversationId,
      role: "tenant",
      subject: "Türschloss",
      body: "Mein Türschloss klemmt.",
    });

    const trigger = loadTriggerInfo(msgId);

    expect(trigger.kind).toBe("tenant_message");
    expect(trigger.message.id).toBe(msgId);
    expect(trigger.tenant?.id).toBe(tenantId);
    expect(trigger.tenant?.name).toBe("Max Mustermann");
    expect(trigger.tenant?.propertyAddress).toBe("Musterstraße 1, 20095 Hamburg");
    expect(trigger.ticket).toBeNull();
    expect(trigger.contractor).toBeNull();
  });

  it("tenant_message: Fallback auf jüngstes nicht-erledigtes Ticket der Conversation", () => {
    const { tenantId, conversationId } = seedTenantWorld();
    const openTicketId = Number(
      db
        .insert(tickets)
        .values({
          tenantId,
          conversationId,
          type: "reparatur",
          status: "infosammlung",
          title: "Türschloss defekt",
        })
        .run().lastInsertRowid,
    );
    // Jüngeres, aber erledigtes Ticket darf NICHT gewählt werden
    db.insert(tickets)
      .values({
        tenantId,
        conversationId,
        type: "frage",
        status: "erledigt",
        title: "Alte Frage",
      })
      .run();
    const msgId = insertMessage({
      conversationId,
      role: "tenant",
      subject: "Nachtrag ohne Tag",
      body: "Die Tür geht gar nicht mehr auf.",
    });

    const trigger = loadTriggerInfo(msgId);

    expect(trigger.ticket?.id).toBe(openTicketId);
  });

  it("contractor_message: Ticket via Betreff-Tag, Mieter über das Ticket", () => {
    const { tenantId, conversationId } = seedTenantWorld();
    const contractorId = Number(
      db
        .insert(contractors)
        .values({ name: "Sven Schloss", email: "sven.schloss@example.com", trade: "Schlüsseldienst" })
        .run().lastInsertRowid,
    );
    const contractorConvId = Number(
      db
        .insert(conversations)
        .values({
          counterpartType: "contractor",
          counterpartId: contractorId,
          counterpartEmail: "sven.schloss@example.com",
        })
        .run().lastInsertRowid,
    );
    const ticketId = Number(
      db
        .insert(tickets)
        .values({
          tenantId,
          conversationId,
          type: "reparatur",
          status: "handwerker_angefragt",
          title: "Türschloss defekt",
          // contractorId gesetzt: dieser Handwerker ist für das Ticket
          // beauftragt (realistisches Ergebnis von approveApproval). Ohne
          // diesen Beleg der Beauftragung verwirft resolveAuthorizedTaggedTicketId
          // den Betreff-Tag jetzt (Critical-Befund aus dem Abschluss-Review) —
          // siehe den Negativ-Test direkt im Anschluss.
          contractorId,
        })
        .run().lastInsertRowid,
    );
    const msgId = insertMessage({
      conversationId: contractorConvId,
      role: "contractor",
      fromEmail: "sven.schloss@example.com",
      subject: `Re: Reparaturanfrage [HV-${ticketId}]`,
      body: "Ich kann Dienstag 10 Uhr.",
    });

    const trigger = loadTriggerInfo(msgId);

    expect(trigger.kind).toBe("contractor_message");
    expect(trigger.ticket?.id).toBe(ticketId);
    expect(trigger.contractor?.id).toBe(contractorId);
    expect(trigger.tenant?.name).toBe("Max Mustermann");
    expect(trigger.tenant?.propertyAddress).toBe("Musterstraße 1, 20095 Hamburg");
  });

  // Critical-Befund aus dem Abschluss-Review: Ein Handwerker, der NICHT für
  // dieses Ticket beauftragt ist, nennt trotzdem dessen Betreff-Tag (z.B.
  // erraten oder aus einer alten Mail). Ohne Berechtigungsprüfung würde er den
  // kompletten Ticket-Datensatz (inkl. Mieter-Name, -Adresse, gesammelter
  // Infos) in den KI-Kontext bekommen und könnte ihn über update_ticket
  // verändern.
  it("contractor_message: fremdes Ticket wird trotz korrektem Betreff-Tag NICHT zugeordnet (Handwerker nicht beauftragt)", () => {
    const { tenantId, conversationId } = seedTenantWorld();
    const contractorId = Number(
      db
        .insert(contractors)
        .values({ name: "Sven Schloss", email: "sven.schloss@example.com", trade: "Schlüsseldienst" })
        .run().lastInsertRowid,
    );
    const contractorConvId = Number(
      db
        .insert(conversations)
        .values({
          counterpartType: "contractor",
          counterpartId: contractorId,
          counterpartEmail: "sven.schloss@example.com",
        })
        .run().lastInsertRowid,
    );
    // Ticket gehört einem anderen Mieter/Handwerker — kein contractorId-Match,
    // keine genehmigte approvals-Zeile für diesen Handwerker.
    const foreignTicketId = Number(
      db
        .insert(tickets)
        .values({
          tenantId,
          conversationId,
          type: "reparatur",
          status: "neu",
          title: "Heizung defekt",
          summary: "Vertrauliche Details zum Mieter",
        })
        .run().lastInsertRowid,
    );
    const msgId = insertMessage({
      conversationId: contractorConvId,
      role: "contractor",
      fromEmail: "sven.schloss@example.com",
      subject: `Re: Anfrage [HV-${foreignTicketId}]`,
      body: "Ich kann Dienstag 10 Uhr.",
    });

    const trigger = loadTriggerInfo(msgId);

    expect(trigger.kind).toBe("contractor_message");
    expect(trigger.ticket).toBeNull();
    // Kein Mieter-Bezug über das fremde Ticket — sensible Mieterdaten
    // (Name, Objektadresse, summary) dürfen NICHT in den Kontext gelangen.
    expect(trigger.tenant).toBeNull();
    expect(trigger.contractor?.id).toBe(contractorId);
  });

  // Important-Befund aus dem Abschluss-Review: Ein Handwerker schreibt eine
  // FRISCHE Mail statt auf die Ticket-Mail zu antworten (kein Betreff-Tag).
  // Der bisherige Rückfall "jüngstes offenes Ticket der Conversation" existierte
  // nur für Mieter — für Handwerker gab es weder Ticket noch Mieter im Kontext.
  it("contractor_message: ohne Betreff-Tag wird das jüngste offene Ticket gefunden, für das dieser Handwerker über tickets.contractorId beauftragt ist", () => {
    const { tenantId, conversationId } = seedTenantWorld();
    const contractorId = Number(
      db
        .insert(contractors)
        .values({ name: "Sven Schloss", email: "sven.schloss@example.com", trade: "Schlüsseldienst" })
        .run().lastInsertRowid,
    );
    const contractorConvId = Number(
      db
        .insert(conversations)
        .values({
          counterpartType: "contractor",
          counterpartId: contractorId,
          counterpartEmail: "sven.schloss@example.com",
        })
        .run().lastInsertRowid,
    );
    const ticketId = Number(
      db
        .insert(tickets)
        .values({
          tenantId,
          conversationId,
          type: "reparatur",
          status: "handwerker_angefragt",
          title: "Türschloss defekt",
          contractorId,
        })
        .run().lastInsertRowid,
    );
    const msgId = insertMessage({
      conversationId: contractorConvId,
      role: "contractor",
      fromEmail: "sven.schloss@example.com",
      subject: "Terminvorschlag Musterstraße", // KEIN [HV-…]-Tag
      body: "Zu der Sache in der Musterstraße: Dienstag 9 Uhr passt.",
    });

    const trigger = loadTriggerInfo(msgId);

    expect(trigger.kind).toBe("contractor_message");
    expect(trigger.ticket?.id).toBe(ticketId);
    expect(trigger.tenant?.name).toBe("Max Mustermann");
  });

  // Review-Befund Punkt 2: Eine genehmigte approvals-Zeile allein genügt NICHT
  // mehr als Rückfall-Kriterium — tickets.contractorId ist die einzige Quelle
  // der Wahrheit für "aktuell beauftragt" (siehe src/lib/ticketAccess.ts).
  // Ohne gesetztes tickets.contractorId (im echten Ablauf setzt approveApproval
  // beides gemeinsam) darf der Rückfall dieses Ticket NICHT finden.
  it("contractor_message: ohne Betreff-Tag genügt eine genehmigte approvals-Zeile ALLEIN nicht mehr (tickets.contractorId ist nicht gesetzt)", () => {
    const { tenantId, conversationId } = seedTenantWorld();
    const contractorId = Number(
      db
        .insert(contractors)
        .values({ name: "Sven Schloss", email: "sven.schloss@example.com", trade: "Schlüsseldienst" })
        .run().lastInsertRowid,
    );
    const contractorConvId = Number(
      db
        .insert(conversations)
        .values({
          counterpartType: "contractor",
          counterpartId: contractorId,
          counterpartEmail: "sven.schloss@example.com",
        })
        .run().lastInsertRowid,
    );
    const ticketId = Number(
      db
        .insert(tickets)
        .values({ tenantId, conversationId, type: "reparatur", status: "genehmigt", title: "Heizung defekt" })
        .run().lastInsertRowid,
    );
    db.insert(approvals)
      .values({
        ticketId,
        summary: "Heizung defekt",
        contractorId,
        emailSubject: "Auftrag",
        emailBody: "Bitte Termin nennen.",
        status: "genehmigt",
      })
      .run();
    const msgId = insertMessage({
      conversationId: contractorConvId,
      role: "contractor",
      fromEmail: "sven.schloss@example.com",
      subject: "Rückmeldung",
      body: "Ich kann Mittwoch vorbei.",
    });

    expect(loadTriggerInfo(msgId).ticket).toBeNull();
  });

  // Review-Befund Punkt 3: Ist ein Handwerker aktuell für MEHR ALS EIN
  // offenes Ticket beauftragt und schreibt ohne Betreff-Tag, darf der
  // Rückfall NICHT einfach "das jüngste" raten (orderBy(desc(id)).limit(1))
  // — sonst ginge eine Terminbestätigung an den falschen Mieter. In diesem
  // Fall ist keine sichere Zuordnung möglich: kein Ticket statt eines
  // geratenen.
  it("contractor_message: ohne Betreff-Tag bleibt das Ticket null, wenn der Handwerker für MEHR ALS EIN offenes Ticket aktuell beauftragt ist (keine sichere Zuordnung möglich)", () => {
    const { tenantId, conversationId } = seedTenantWorld();
    const contractorId = Number(
      db
        .insert(contractors)
        .values({ name: "Sven Schloss", email: "sven.schloss@example.com", trade: "Schlüsseldienst" })
        .run().lastInsertRowid,
    );
    const contractorConvId = Number(
      db
        .insert(conversations)
        .values({
          counterpartType: "contractor",
          counterpartId: contractorId,
          counterpartEmail: "sven.schloss@example.com",
        })
        .run().lastInsertRowid,
    );
    // Zweiter Mieter mit eigenem, ebenfalls offenem Ticket, für das derselbe
    // Handwerker beauftragt ist.
    const { tenantId: secondTenantId, conversationId: secondConversationId } = (() => {
      const propertyId = Number(
        db.insert(properties).values({ address: "Nebenstraße 2, 20095 Hamburg" }).run().lastInsertRowid,
      );
      const secondTenantId = Number(
        db
          .insert(tenants)
          .values({ name: "Bert Mieter", email: "bert@example.com", propertyId })
          .run().lastInsertRowid,
      );
      const secondConversationId = Number(
        db
          .insert(conversations)
          .values({ counterpartType: "tenant", counterpartId: secondTenantId, counterpartEmail: "bert@example.com" })
          .run().lastInsertRowid,
      );
      return { tenantId: secondTenantId, conversationId: secondConversationId };
    })();
    db.insert(tickets)
      .values({
        tenantId,
        conversationId,
        type: "reparatur",
        status: "handwerker_angefragt",
        title: "Türschloss defekt (Annas Vorgang)",
        contractorId,
      })
      .run();
    db.insert(tickets)
      .values({
        tenantId: secondTenantId,
        conversationId: secondConversationId,
        type: "reparatur",
        status: "handwerker_angefragt",
        title: "Fallrohr verstopft (Berts Vorgang)",
        contractorId,
      })
      .run();
    const msgId = insertMessage({
      conversationId: contractorConvId,
      role: "contractor",
      fromEmail: "sven.schloss@example.com",
      subject: "Terminvorschlag", // KEIN [HV-…]-Tag
      body: "Dienstag 9 Uhr passt mir.",
    });

    const trigger = loadTriggerInfo(msgId);

    expect(trigger.ticket).toBeNull();
    expect(trigger.tenant).toBeNull();
  });

  // Sichert Punkt 1 (Berechtigungsprüfung) auch für den Rückfall ab: Ein
  // Handwerker ohne Tag darf NIE das offene Ticket eines anderen Mieters
  // finden, nur weil es zufällig das jüngste in der DB ist.
  it("contractor_message: der Rückfall findet KEIN Ticket, für das dieser Handwerker nicht beauftragt ist", () => {
    const { tenantId, conversationId } = seedTenantWorld();
    const contractorId = Number(
      db
        .insert(contractors)
        .values({ name: "Sven Schloss", email: "sven.schloss@example.com", trade: "Schlüsseldienst" })
        .run().lastInsertRowid,
    );
    const contractorConvId = Number(
      db
        .insert(conversations)
        .values({
          counterpartType: "contractor",
          counterpartId: contractorId,
          counterpartEmail: "sven.schloss@example.com",
        })
        .run().lastInsertRowid,
    );
    // Fremdes, offenes Ticket eines anderen Handwerkers/ohne Beauftragung.
    db.insert(tickets)
      .values({ tenantId, conversationId, type: "reparatur", status: "neu", title: "Fremder Auftrag" })
      .run();
    const msgId = insertMessage({
      conversationId: contractorConvId,
      role: "contractor",
      fromEmail: "sven.schloss@example.com",
      subject: "Frage",
      body: "Worum geht es bei mir?",
    });

    const trigger = loadTriggerInfo(msgId);

    expect(trigger.ticket).toBeNull();
    expect(trigger.tenant).toBeNull();
  });

  it("contractor_message: der Rückfall ignoriert bereits erledigte Tickets dieses Handwerkers", () => {
    const { tenantId, conversationId } = seedTenantWorld();
    const contractorId = Number(
      db
        .insert(contractors)
        .values({ name: "Sven Schloss", email: "sven.schloss@example.com", trade: "Schlüsseldienst" })
        .run().lastInsertRowid,
    );
    const contractorConvId = Number(
      db
        .insert(conversations)
        .values({
          counterpartType: "contractor",
          counterpartId: contractorId,
          counterpartEmail: "sven.schloss@example.com",
        })
        .run().lastInsertRowid,
    );
    db.insert(tickets)
      .values({
        tenantId,
        conversationId,
        type: "reparatur",
        status: "erledigt",
        title: "Bereits erledigt",
        contractorId,
      })
      .run();
    const msgId = insertMessage({
      conversationId: contractorConvId,
      role: "contractor",
      fromEmail: "sven.schloss@example.com",
      subject: "Frage",
      body: "Gibt es noch etwas offen?",
    });

    expect(loadTriggerInfo(msgId).ticket).toBeNull();
  });

  // Kernszenario aus dem Review: Mieterin Anna hat Ticket HV-n mit sensiblen
  // Angaben; Mieter Bert schreibt mit Annas Tag im Betreff. Ohne
  // Berechtigungsprüfung würde Bert Annas kompletten Ticket-Datensatz
  // (inkl. summary/collectedInfo) in den KI-Kontext bekommen und könnte ihn
  // über update_ticket verändern (z.B. auf "erledigt" setzen).
  it("tenant_message: fremdes Ticket eines anderen Mieters wird trotz korrektem Betreff-Tag NICHT zugeordnet", () => {
    const { propertyId, tenantId: annaTenantId, conversationId: annaConversationId } = seedTenantWorld();
    const annaTicketId = Number(
      db
        .insert(tickets)
        .values({
          tenantId: annaTenantId,
          conversationId: annaConversationId,
          type: "reparatur",
          status: "infosammlung",
          title: "Vertretersuche",
          summary: "tagsüber nie zuhause, Schlüssel unter der Matte",
        })
        .run().lastInsertRowid,
    );
    const bertId = Number(
      db
        .insert(tenants)
        .values({ name: "Bert Mieter", email: "bert@example.com", propertyId })
        .run().lastInsertRowid,
    );
    const bertConvId = Number(
      db
        .insert(conversations)
        .values({ counterpartType: "tenant", counterpartId: bertId, counterpartEmail: "bert@example.com" })
        .run().lastInsertRowid,
    );
    const msgId = insertMessage({
      conversationId: bertConvId,
      role: "tenant",
      fromEmail: "bert@example.com",
      subject: `Re: [HV-${annaTicketId}]`,
      body: "Hallo, was ist mit meinem Anliegen?",
    });

    const trigger = loadTriggerInfo(msgId);

    expect(trigger.kind).toBe("tenant_message");
    expect(trigger.ticket).toBeNull();
    // Bert bekommt seinen EIGENEN Mieter-Kontext, nicht Annas Ticket-Daten.
    expect(trigger.tenant?.email).toBe("bert@example.com");
  });

  it("landlord_answer: kind + Mieter über ticketId", () => {
    const { tenantId, conversationId } = seedTenantWorld();
    const ticketId = Number(
      db
        .insert(tickets)
        .values({
          tenantId,
          conversationId,
          type: "reparatur",
          status: "eskaliert",
          title: "Türschloss defekt",
        })
        .run().lastInsertRowid,
    );
    const msgId = insertMessage({
      conversationId,
      role: "landlord",
      fromEmail: "vermieter@dashboard.intern",
      ticketId,
      body: "Antwort des Vermieters: bitte Standardvorgehen.",
    });

    const trigger = loadTriggerInfo(msgId);

    expect(trigger.kind).toBe("landlord_answer");
    expect(trigger.ticket?.id).toBe(ticketId);
    expect(trigger.tenant?.id).toBe(tenantId);
  });
});

describe("buildUserContent", () => {
  it("baut Text-Block mit Verlauf und neuer Nachricht", () => {
    const { conversationId } = seedTenantWorld();
    insertMessage({ conversationId, role: "tenant", body: "Mein Türschloss klemmt." });
    const msgId = insertMessage({
      conversationId,
      role: "tenant",
      subject: "Nachtrag Türschloss",
      body: "Die Tür geht jetzt gar nicht mehr auf.",
    });

    const content = buildUserContent(loadTriggerInfo(msgId));

    expect(content).toHaveLength(1);
    const block = content[0];
    if (block.type !== "text") throw new Error("erster Block muss Text sein");
    expect(block.text).toContain("## Bisheriger Verlauf");
    expect(block.text).toContain("Mein Türschloss klemmt.");
    expect(block.text).toContain("## NEUE NACHRICHT (Mieter");
    expect(block.text).toContain("Betreff: Nachtrag Türschloss");
    // Trigger-Body erscheint genau einmal (nicht zusätzlich im Verlauf)
    expect(block.text.split("Die Tür geht jetzt gar nicht mehr auf.")).toHaveLength(2);
  });

  it("hängt Bild-Anhänge als base64-Image-Block an, ignoriert Nicht-Bilder", () => {
    const { conversationId } = seedTenantWorld();
    const dir = mkdtempSync(join(tmpdir(), "hv-attachments-"));
    const png = Buffer.from(PNG_1X1_BASE64, "base64");
    const pngPath = join(dir, "px.png");
    writeFileSync(pngPath, png);
    const msgId = insertMessage({
      conversationId,
      role: "tenant",
      subject: "Foto",
      body: "Anbei ein Foto vom Schloss.",
    });
    db.insert(attachments)
      .values({ messageId: msgId, filename: "px.png", mimeType: "image/png", filePath: pngPath, size: png.length })
      .run();
    // Nicht-Bild: Datei muss nie gelesen werden, Pfad darf also fiktiv sein
    db.insert(attachments)
      .values({
        messageId: msgId,
        filename: "doku.pdf",
        mimeType: "application/pdf",
        filePath: join(dir, "gibt-es-nicht.pdf"),
        size: 3,
      })
      .run();

    const content = buildUserContent(loadTriggerInfo(msgId));

    expect(content).toHaveLength(2);
    const img = content[1];
    if (img.type !== "image") throw new Error("zweiter Block muss ein Bild sein");
    if (img.source.type !== "base64") throw new Error("Bildquelle muss base64 sein");
    expect(img.source.media_type).toBe("image/png");
    expect(img.source.data).toBe(png.toString("base64"));
  });

  it("überspringt Bild-Anhänge mit von Claude nicht unterstütztem MIME-Typ (z.B. HEIC, SVG)", () => {
    // Claude unterstützt nur image/jpeg, image/png, image/gif und image/webp. Ein
    // iPhone-Foto im HEIC-Format oder ein SVG beginnt zwar auch mit "image/", würde
    // die API aber mit HTTP 400 scheitern lassen. Solche Anhänge müssen wie
    // Nicht-Bilder übersprungen werden — die Datei darf dabei nie gelesen werden,
    // der Pfad ist deshalb bewusst fiktiv.
    const { conversationId } = seedTenantWorld();
    const msgId = insertMessage({
      conversationId,
      role: "tenant",
      subject: "Foto",
      body: "Anbei ein Foto vom Schloss.",
    });
    db.insert(attachments)
      .values({
        messageId: msgId,
        filename: "foto.heic",
        mimeType: "image/heic",
        filePath: "/nicht/vorhanden/foto.heic",
        size: 3,
      })
      .run();
    db.insert(attachments)
      .values({
        messageId: msgId,
        filename: "schema.svg",
        mimeType: "image/svg+xml",
        filePath: "/nicht/vorhanden/schema.svg",
        size: 3,
      })
      .run();

    const content = buildUserContent(loadTriggerInfo(msgId));

    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
  });
});
