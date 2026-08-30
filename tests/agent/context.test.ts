import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTranscript, buildUserContent, loadTriggerInfo } from "@/agent/context";
import { setDbForTesting, type AppDb } from "@/db/client";
import {
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
