import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../helpers/db";
import { setDbForTesting, type AppDb } from "@/db/client";
import { properties, tenants, conversations, messages } from "@/db/schema";
import { sendAndLogEmail } from "@/lib/outbound";
import { RecipientNotAllowedError } from "@/lib/recipients";
import { RateLimitExceededError, WORKER_PAUSED_KEY } from "@/lib/rateLimit";
import { getSetting } from "@/lib/settings";
import type { OutgoingEmail } from "@/channel/types";

describe("sendAndLogEmail", () => {
  let db: AppDb;
  let conversationId: number;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.MAIL_USER = "login@example.com";
    process.env.MAIL_PASSWORD = "test";
    process.env.MAIL_ALIAS = "hausverwaltung@example.com";
    process.env.DASHBOARD_PASSWORD = "test";
    process.env.MAIL_RATE_LIMIT_PER_HOUR = "3";

    db = makeTestDb();
    const propertyId = Number(
      db.insert(properties).values({ address: "Musterstraße 1, 20095 Hamburg" }).run().lastInsertRowid,
    );
    const tenantId = Number(
      db
        .insert(tenants)
        .values({ name: "Max Mustermann", email: "max.mustermann@example.com", propertyId })
        .run().lastInsertRowid,
    );
    conversationId = Number(
      db
        .insert(conversations)
        .values({
          counterpartType: "tenant",
          counterpartId: tenantId,
          counterpartEmail: "max.mustermann@example.com",
        })
        .run().lastInsertRowid,
    );
  });

  afterEach(() => {
    setDbForTesting(null);
  });

  it("Erfolgspfad: loggt VOR dem Senden mit 'sending', setzt danach 'done' und lastMessageAt", async () => {
    let statusAtSendTime: string | null = null;
    const sent: OutgoingEmail[] = [];
    const fakeSend = async (mail: OutgoingEmail): Promise<void> => {
      const rows = db.select().from(messages).all();
      statusAtSendTime = rows[rows.length - 1]?.processingStatus ?? null;
      sent.push(mail);
    };

    const id = await sendAndLogEmail(
      {
        to: "max.mustermann@example.com",
        subject: "Ihre Anfrage",
        text: "Guten Tag, wir kümmern uns darum.",
        role: "ai",
        conversationId,
      },
      fakeSend,
    );

    expect(sent).toEqual([
      { to: "max.mustermann@example.com", subject: "Ihre Anfrage", text: "Guten Tag, wir kümmern uns darum." },
    ]);
    expect(statusAtSendTime).toBe("sending");

    const row = db.select().from(messages).where(eq(messages.id, id)).get();
    expect(row?.direction).toBe("outbound");
    expect(row?.role).toBe("ai");
    expect(row?.fromEmail).toBe("hausverwaltung@example.com");
    expect(row?.toEmail).toBe("max.mustermann@example.com");
    expect(row?.processingStatus).toBe("done");

    const conv = db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
    expect(conv?.lastMessageAt).not.toBeNull();
  });

  it("Fehlerpfad: markiert 'failed', speichert processingError und wirft den Fehler weiter", async () => {
    const fakeSend = async (): Promise<void> => {
      throw new Error("SMTP kaputt");
    };

    await expect(
      sendAndLogEmail(
        { to: "max.mustermann@example.com", subject: "Test", text: "Hallo", role: "ai", conversationId },
        fakeSend,
      ),
    ).rejects.toThrow("SMTP kaputt");

    const rows = db.select().from(messages).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.processingStatus).toBe("failed");
    expect(rows[0]?.processingError).toContain("SMTP kaputt");

    const conv = db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
    expect(conv?.lastMessageAt).toBeNull();
  });

  it("Whitelist-Verstoß: RecipientNotAllowedError, KEIN Insert, send nie aufgerufen", async () => {
    const fakeSend = vi.fn(async (): Promise<void> => {});

    await expect(
      sendAndLogEmail(
        { to: "fremder@example.com", subject: "Test", text: "Hallo", role: "ai", conversationId },
        fakeSend,
      ),
    ).rejects.toBeInstanceOf(RecipientNotAllowedError);

    expect(fakeSend).not.toHaveBeenCalled();
    expect(db.select().from(messages).all()).toHaveLength(0);
  });

  it("Rate-Limit-Verstoß: RateLimitExceededError, KEIN Insert, worker_paused gesetzt", async () => {
    process.env.MAIL_RATE_LIMIT_PER_HOUR = "2";
    for (let i = 0; i < 2; i++) {
      db.insert(messages)
        .values({
          conversationId,
          direction: "outbound",
          role: "ai",
          fromEmail: "hausverwaltung@example.com",
          toEmail: "max.mustermann@example.com",
          subject: "Alt",
          body: "Alte Mail",
          processingStatus: "done",
        })
        .run();
    }
    const fakeSend = vi.fn(async (): Promise<void> => {});

    await expect(
      sendAndLogEmail(
        { to: "max.mustermann@example.com", subject: "Test", text: "Hallo", role: "ai", conversationId },
        fakeSend,
      ),
    ).rejects.toBeInstanceOf(RateLimitExceededError);

    expect(fakeSend).not.toHaveBeenCalled();
    expect(db.select().from(messages).all()).toHaveLength(2);
    expect(getSetting(WORKER_PAUSED_KEY)).toBe("1");
  });
});
