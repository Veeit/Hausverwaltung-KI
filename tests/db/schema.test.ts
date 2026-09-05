import { afterEach, describe, expect, it } from "vitest";
import { setDbForTesting } from "@/db/client";
import {
  approvals,
  attachments,
  contractors,
  conversations,
  documents,
  escalations,
  messages,
  properties,
  settings,
  tenants,
  tickets,
  waitlist,
} from "@/db/schema";
import { makeTestDb } from "../helpers/db";

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

afterEach(() => {
  setDbForTesting(null);
});

describe("DB-Fundament: Drizzle-Schema und DDL stimmen spaltengenau überein", () => {
  it("Roundtrip (Insert + Select) über alle Tabellen entlang der FK-Ketten", () => {
    const db = makeTestDb();

    const property = db
      .insert(properties)
      .values({ address: "Musterstraße 1, 20095 Hamburg" })
      .returning()
      .get();
    expect(property.id).toBe(1);
    expect(property.address).toBe("Musterstraße 1, 20095 Hamburg");
    expect(property.createdAt).toMatch(ISO_RE);

    const tenant = db
      .insert(tenants)
      .values({
        name: "Max Mustermann",
        email: "max.mustermann@example.com",
        propertyId: property.id,
        unitLabel: "2. OG links",
        phone: "+49 40 123456",
      })
      .returning()
      .get();
    expect(tenant.propertyId).toBe(property.id);
    expect(tenant.unitLabel).toBe("2. OG links");
    expect(tenant.phone).toBe("+49 40 123456");
    expect(tenant.createdAt).toMatch(ISO_RE);

    const contractor = db
      .insert(contractors)
      .values({
        name: "Sven Schloss",
        email: "sven.schloss@example.com",
        trade: "Schlüsseldienst",
        notes: "Notdienst rund um die Uhr",
      })
      .returning()
      .get();
    expect(contractor.trade).toBe("Schlüsseldienst");
    expect(contractor.notes).toBe("Notdienst rund um die Uhr");
    expect(contractor.createdAt).toMatch(ISO_RE);

    const conversation = db
      .insert(conversations)
      .values({
        counterpartType: "tenant",
        counterpartId: tenant.id,
        counterpartEmail: "max.mustermann@example.com",
        subject: "Türschloss defekt",
      })
      .returning()
      .get();
    expect(conversation.counterpartType).toBe("tenant");
    expect(conversation.counterpartId).toBe(tenant.id);
    expect(conversation.lastMessageAt).toBeNull();
    expect(conversation.createdAt).toMatch(ISO_RE);

    const ticket = db
      .insert(tickets)
      .values({
        tenantId: tenant.id,
        conversationId: conversation.id,
        type: "reparatur",
        title: "Türschloss klemmt",
        summary: "Schloss der Wohnungstür klemmt seit gestern",
        urgency: "hoch",
        contractorId: contractor.id,
        appointmentAt: "2026-09-02 zwischen 8 und 10 Uhr",
      })
      .returning()
      .get();
    expect(ticket.status).toBe("neu"); // DDL-DEFAULT 'neu'
    expect(ticket.collectedInfo).toBe("{}"); // DDL-DEFAULT '{}'
    expect(ticket.contractorId).toBe(contractor.id);
    expect(ticket.createdAt).toMatch(ISO_RE);
    expect(ticket.updatedAt).toMatch(ISO_RE);

    const message = db
      .insert(messages)
      .values({
        conversationId: conversation.id,
        ticketId: ticket.id,
        direction: "inbound",
        role: "tenant",
        fromEmail: "max.mustermann@example.com",
        toEmail: "hausverwaltung@example.com",
        subject: "Türschloss defekt [HV-1]",
        body: "Guten Tag, mein Türschloss klemmt.",
        imapMessageId: "<msg-1@example.com>",
      })
      .returning()
      .get();
    expect(message.processingStatus).toBe("pending"); // DDL-DEFAULT 'pending'
    expect(message.processingAttempts).toBe(0); // DDL-DEFAULT 0
    expect(message.processingError).toBeNull();
    expect(message.createdAt).toMatch(ISO_RE);

    const attachment = db
      .insert(attachments)
      .values({
        messageId: message.id,
        filename: "foto.jpg",
        mimeType: "image/jpeg",
        filePath: "/data/attachments/1/foto.jpg",
        size: 12345,
      })
      .returning()
      .get();
    expect(attachment.messageId).toBe(message.id);
    expect(attachment.size).toBe(12345);
    expect(attachment.createdAt).toMatch(ISO_RE);

    const approval = db
      .insert(approvals)
      .values({
        ticketId: ticket.id,
        summary: "Schlüsseldienst mit Reparatur des Türschlosses beauftragen",
        contractorId: contractor.id,
        emailSubject: "Reparaturanfrage Türschloss [HV-1]",
        emailBody: "Sehr geehrter Herr Schloss, bitte nennen Sie uns einen Terminvorschlag.",
      })
      .returning()
      .get();
    expect(approval.status).toBe("offen"); // DDL-DEFAULT 'offen'
    expect(approval.decisionNote).toBeNull();
    expect(approval.decidedAt).toBeNull();
    expect(approval.createdAt).toMatch(ISO_RE);

    const escalation = db
      .insert(escalations)
      .values({
        ticketId: ticket.id,
        conversationId: conversation.id,
        question: "Der Terminvorschlag liegt außerhalb der Zeitfenster — wie verfahren?",
      })
      .returning()
      .get();
    expect(escalation.status).toBe("offen"); // DDL-DEFAULT 'offen'
    expect(escalation.answer).toBeNull();
    expect(escalation.answeredAt).toBeNull();
    expect(escalation.createdAt).toMatch(ISO_RE);

    const document = db
      .insert(documents)
      .values({
        filename: "hausordnung.txt",
        mimeType: "text/plain",
        content: "Ruhezeiten sind von 22 bis 6 Uhr einzuhalten.",
      })
      .returning()
      .get();
    expect(document.content).toContain("Ruhezeiten");
    expect(document.createdAt).toMatch(ISO_RE);

    db.insert(settings).values({ key: "worker_paused", value: "1" }).run();
    expect(db.select().from(settings).all()).toEqual([
      { key: "worker_paused", value: "1" },
    ]);

    // Select-Gegenprobe: jede Tabelle liefert genau die eine eingefügte Zeile
    // (deckt Drift auch auf der Lese-Seite auf: SELECT nennt alle Schema-Spalten)
    expect(db.select().from(properties).all()).toHaveLength(1);
    expect(db.select().from(tenants).all()).toHaveLength(1);
    expect(db.select().from(contractors).all()).toHaveLength(1);
    expect(db.select().from(conversations).all()).toHaveLength(1);
    expect(db.select().from(tickets).all()).toHaveLength(1);
    expect(db.select().from(messages).all()).toHaveLength(1);
    expect(db.select().from(attachments).all()).toHaveLength(1);
    expect(db.select().from(approvals).all()).toHaveLength(1);
    expect(db.select().from(escalations).all()).toHaveLength(1);
    expect(db.select().from(documents).all()).toHaveLength(1);
  });

  it("Roundtrip über waitlist — die Tabelle der öffentlichen Produktseite", () => {
    const db = makeTestDb();

    const eintrag = db
      .insert(waitlist)
      .values({ email: "interessent@example.com", units: "10-49", wantsDemo: 1 })
      .returning()
      .get();

    expect(eintrag.id).toBe(1);
    expect(eintrag.email).toBe("interessent@example.com");
    expect(eintrag.units).toBe("10-49");
    expect(eintrag.wantsDemo).toBe(1);
    expect(eintrag.createdAt).toMatch(ISO_RE);

    // Ohne Angabe zur Größe bleibt die Spalte leer, der Demo-Wunsch fällt auf 0.
    const ohneAngaben = db
      .insert(waitlist)
      .values({ email: "knapp@example.com" })
      .returning()
      .get();
    expect(ohneAngaben.units).toBeNull();
    expect(ohneAngaben.wantsDemo).toBe(0);
  });

  it("erzwingt UNIQUE auf waitlist.email", () => {
    // Trägt sich jemand zweimal ein, darf keine zweite Zeile entstehen —
    // die Action fängt das ab, die Datenbank ist das zweite Netz.
    const db = makeTestDb();
    db.insert(waitlist).values({ email: "doppelt@example.com" }).run();
    expect(() =>
      db.insert(waitlist).values({ email: "doppelt@example.com" }).run(),
    ).toThrow(/UNIQUE/);
  });

  it("erzwingt Fremdschlüssel (PRAGMA foreign_keys = ON)", () => {
    const db = makeTestDb();
    expect(() =>
      db
        .insert(tenants)
        .values({ name: "Niemand", email: "niemand@example.com", propertyId: 999 })
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it("erzwingt UNIQUE auf tenants.email", () => {
    const db = makeTestDb();
    const property = db
      .insert(properties)
      .values({ address: "Musterstraße 1, 20095 Hamburg" })
      .returning()
      .get();
    db.insert(tenants)
      .values({ name: "Max", email: "doppelt@example.com", propertyId: property.id })
      .run();
    expect(() =>
      db
        .insert(tenants)
        .values({ name: "Moritz", email: "doppelt@example.com", propertyId: property.id })
        .run(),
    ).toThrow(/UNIQUE/);
  });
});
