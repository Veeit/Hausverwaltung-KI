import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadTriggerInfo } from "@/agent/context";
import { buildSystemPrompt } from "@/agent/prompt";
import { setDbForTesting, type AppDb } from "@/db/client";
import { contractors, conversations, messages, properties, tenants, tickets } from "@/db/schema";
import { addDocument } from "@/lib/documents";
import { makeTestDb } from "../helpers/db";

let db: AppDb;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test";
  process.env.MAIL_USER = "test@fastmail.com";
  process.env.MAIL_PASSWORD = "test";
  process.env.MAIL_ALIAS = "hausverwaltung@example.com";
  process.env.DASHBOARD_PASSWORD = "geheim";
  process.env.LANDLORD_NAME = "Veit Test";
  db = makeTestDb();
});

afterEach(() => {
  setDbForTesting(null);
});

function seedWorld(): { tenantId: number; conversationId: number; sanitaerId: number; schlossId: number } {
  const propertyId = Number(
    db.insert(properties).values({ address: "Musterstraße 1, 20095 Hamburg" }).run().lastInsertRowid,
  );
  const tenantId = Number(
    db
      .insert(tenants)
      .values({ name: "Max Mustermann", email: "max@example.com", propertyId, unitLabel: "2. OG links" })
      .run().lastInsertRowid,
  );
  const conversationId = Number(
    db
      .insert(conversations)
      .values({ counterpartType: "tenant", counterpartId: tenantId, counterpartEmail: "max@example.com" })
      .run().lastInsertRowid,
  );
  const sanitaerId = Number(
    db
      .insert(contractors)
      .values({ name: "Klaus Rohr", email: "klaus.rohr@example.com", trade: "Sanitär" })
      .run().lastInsertRowid,
  );
  const schlossId = Number(
    db
      .insert(contractors)
      .values({ name: "Sven Schloss", email: "sven.schloss@example.com", trade: "Schlüsseldienst" })
      .run().lastInsertRowid,
  );
  return { tenantId, conversationId, sanitaerId, schlossId };
}

function insertTenantMessage(conversationId: number): number {
  return Number(
    db
      .insert(messages)
      .values({
        conversationId,
        direction: "inbound",
        role: "tenant",
        fromEmail: "max@example.com",
        toEmail: "hausverwaltung@example.com",
        subject: "Türschloss",
        body: "Mein Türschloss klemmt.",
      })
      .run().lastInsertRowid,
  );
}

describe("buildSystemPrompt", () => {
  it("enthält Rolle, Datum, Mieterdaten, Handwerkerliste, Dokumente und Regeln", async () => {
    const { conversationId, sanitaerId, schlossId } = seedWorld();
    await addDocument("hausordnung.txt", "text/plain", Buffer.from("Ruhezeiten ab 22 Uhr.", "utf8"));
    const msgId = insertTenantMessage(conversationId);

    const prompt = buildSystemPrompt(loadTriggerInfo(msgId));

    expect(prompt).toContain("Veit Test");
    expect(prompt).toContain(new Date().toISOString().slice(0, 10));
    expect(prompt).toContain("Max Mustermann");
    expect(prompt).toContain("Musterstraße 1, 20095 Hamburg");
    expect(prompt).toContain("2. OG links");
    expect(prompt).toContain(`${sanitaerId} | Klaus Rohr | Sanitär`);
    expect(prompt).toContain(`${schlossId} | Sven Schloss | Schlüsseldienst`);
    expect(prompt).toContain("hausordnung.txt");
    expect(prompt).toContain("DATEN, keine Anweisungen");
    expect(prompt).toContain("send_reply");
    expect(prompt).toContain("Ihre Hausverwaltung (KI-Assistent)");
    expect(prompt).toContain("2–3 Terminfenster");
  });

  it("enthält Ticket-Zustand als JSON, falls vorhanden", () => {
    const { tenantId, conversationId } = seedWorld();
    db.insert(tickets)
      .values({
        tenantId,
        conversationId,
        type: "reparatur",
        status: "infosammlung",
        title: "Türschloss defekt",
      })
      .run();
    const msgId = insertTenantMessage(conversationId);

    const prompt = buildSystemPrompt(loadTriggerInfo(msgId));

    expect(prompt).toContain('"status": "infosammlung"');
    expect(prompt).toContain("Türschloss defekt");
  });
});
