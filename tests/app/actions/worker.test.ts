import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { setDbForTesting, type AppDb } from "@/db/client";
import { contractors, conversations, messages, properties, tenants } from "@/db/schema";
import { sha256Hex } from "@/lib/auth";
import { makeTestDb } from "../../helpers/db";
import { setAuthCookieValue } from "../../helpers/nextMocks";
import { reprocessMessage } from "@/app/actions/worker";

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

function seedUnknownMessage(fromEmail: string): { messageId: number; conversationId: number } {
  const conversationId = Number(
    db
      .insert(conversations)
      .values({ counterpartType: "unknown", counterpartEmail: fromEmail })
      .run().lastInsertRowid,
  );
  const messageId = Number(
    db
      .insert(messages)
      .values({
        conversationId,
        direction: "inbound",
        role: "unknown",
        fromEmail,
        toEmail: "hausverwaltung@example.com",
        subject: "Frage",
        body: "Hallo, ich habe eine Frage.",
        processingStatus: "done",
      })
      .run().lastInsertRowid,
  );
  return { messageId, conversationId };
}

describe("reprocessMessage", () => {
  it("gibt eine Nachricht frei, deren Absender inzwischen als Mieter angelegt wurde", async () => {
    const propertyId = Number(
      db.insert(properties).values({ address: "Musterstraße 1, 20095 Hamburg" }).run().lastInsertRowid,
    );
    const { messageId, conversationId } = seedUnknownMessage("neu@example.com");
    const tenantId = Number(
      db
        .insert(tenants)
        .values({ name: "Neue Mieterin", email: "neu@example.com", propertyId })
        .run().lastInsertRowid,
    );

    await reprocessMessage(messageId);

    const msg = db.select().from(messages).where(eq(messages.id, messageId)).get()!;
    expect(msg.role).toBe("tenant");
    expect(msg.processingStatus).toBe("pending");

    const conv = db.select().from(conversations).where(eq(conversations.id, conversationId)).get()!;
    expect(conv.counterpartType).toBe("tenant");
    expect(conv.counterpartId).toBe(tenantId);
  });

  it("gibt eine Nachricht frei, deren Absender inzwischen als Handwerker angelegt wurde", async () => {
    const { messageId } = seedUnknownMessage("handwerker@example.com");
    const contractorId = Number(
      db
        .insert(contractors)
        .values({ name: "Neuer Handwerker", email: "handwerker@example.com", trade: "Elektrik" })
        .run().lastInsertRowid,
    );

    await reprocessMessage(messageId);

    const msg = db.select().from(messages).where(eq(messages.id, messageId)).get()!;
    expect(msg.role).toBe("contractor");
    expect(msg.processingStatus).toBe("pending");
    expect(
      db.select().from(conversations).where(eq(conversations.id, msg.conversationId)).get()!.counterpartId,
    ).toBe(contractorId);
  });

  it("wirft, wenn der Absender weiterhin unbekannt ist", async () => {
    const { messageId } = seedUnknownMessage("immernoch-fremd@example.com");

    await expect(reprocessMessage(messageId)).rejects.toThrow("weiterhin keinem Mieter oder Handwerker");

    const msg = db.select().from(messages).where(eq(messages.id, messageId)).get()!;
    expect(msg.role).toBe("unknown");
    expect(msg.processingStatus).toBe("done");
  });

  it("wirft, wenn die Nachricht keiner unbekannten Absenderin zugeordnet ist", async () => {
    const propertyId = Number(
      db.insert(properties).values({ address: "Musterstraße 1, 20095 Hamburg" }).run().lastInsertRowid,
    );
    const tenantId = Number(
      db
        .insert(tenants)
        .values({ name: "Max Mustermann", email: "max@example.com", propertyId })
        .run().lastInsertRowid,
    );
    const conversationId = Number(
      db
        .insert(conversations)
        .values({ counterpartType: "tenant", counterpartId: tenantId, counterpartEmail: "max@example.com" })
        .run().lastInsertRowid,
    );
    const messageId = Number(
      db
        .insert(messages)
        .values({
          conversationId,
          direction: "inbound",
          role: "tenant",
          fromEmail: "max@example.com",
          toEmail: "hausverwaltung@example.com",
          body: "Hallo",
          processingStatus: "done",
        })
        .run().lastInsertRowid,
    );

    await expect(reprocessMessage(messageId)).rejects.toThrow("kann daher nicht erneut freigegeben werden");
  });
});
