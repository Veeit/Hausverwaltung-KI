import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../helpers/db";
import { setDbForTesting, type AppDb } from "@/db/client";
import {
  attachments,
  contractors,
  conversations,
  messages,
  properties,
  tenants,
} from "@/db/schema";
import type { IncomingEmail } from "@/channel/types";
import { findOrCreateConversation } from "@/lib/conversations";
import { createTicket } from "@/lib/tickets";
import { setSetting } from "@/lib/settings";
import { WORKER_PAUSED_KEY } from "@/lib/rateLimit";
import type { AgentRunDeps } from "@/agent/run";
import { ingestEmail, processPendingMessages, pollOnce } from "@/worker/processor";

let db: AppDb;
let attachmentsDir: string;

function makeAgentFake(): { deps: AgentRunDeps; calls: () => number } {
  let count = 0;
  return {
    deps: {
      runTools: async () => {
        count++;
        return { stopReason: "end_turn" };
      },
    },
    calls: () => count,
  };
}

function seedTenant(): number {
  const property = db
    .insert(properties)
    .values({ address: "Musterstraße 1, 20095 Hamburg" })
    .returning({ id: properties.id })
    .get();
  const tenant = db
    .insert(tenants)
    .values({
      name: "Max Mustermann",
      email: "max.mustermann@example.com",
      propertyId: property.id,
      unitLabel: "2. OG links",
    })
    .returning({ id: tenants.id })
    .get();
  return tenant.id;
}

function seedContractor(): number {
  const contractor = db
    .insert(contractors)
    .values({ name: "Klaus Rohr", email: "klaus.rohr@example.com", trade: "Sanitär" })
    .returning({ id: contractors.id })
    .get();
  return contractor.id;
}

function makeMail(overrides: Partial<IncomingEmail> = {}): IncomingEmail {
  return {
    messageId: "<msg-1@example.com>",
    from: "max.mustermann@example.com",
    to: ["hausverwaltung@example.com"],
    subject: "Türschloss defekt",
    text: "Guten Tag, mein Türschloss klemmt seit gestern.",
    date: new Date("2026-08-29T10:00:00.000Z"),
    attachments: [],
    ...overrides,
  };
}

beforeEach(() => {
  db = makeTestDb();
  attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-attachments-"));
  process.env.ANTHROPIC_API_KEY = "test";
  process.env.MAIL_USER = "worker-test@example.com";
  process.env.MAIL_PASSWORD = "test";
  process.env.MAIL_ALIAS = "hausverwaltung@example.com";
  process.env.DASHBOARD_PASSWORD = "test";
  process.env.ATTACHMENTS_DIR = attachmentsDir;
});

afterEach(() => {
  setDbForTesting(null);
  fs.rmSync(attachmentsDir, { recursive: true, force: true });
});

describe("ingestEmail", () => {
  it("klassifiziert bekannte Mieter als role 'tenant' mit Status 'pending'", async () => {
    const tenantId = seedTenant();
    const id = await ingestEmail(makeMail());
    expect(id).not.toBeNull();

    const msg = db.select().from(messages).where(eq(messages.id, id!)).get()!;
    expect(msg.direction).toBe("inbound");
    expect(msg.role).toBe("tenant");
    expect(msg.processingStatus).toBe("pending");
    expect(msg.fromEmail).toBe("max.mustermann@example.com");
    expect(msg.toEmail).toBe("hausverwaltung@example.com");
    expect(msg.imapMessageId).toBe("<msg-1@example.com>");
    expect(msg.body).toBe("Guten Tag, mein Türschloss klemmt seit gestern.");

    const conv = db
      .select()
      .from(conversations)
      .where(eq(conversations.id, msg.conversationId))
      .get()!;
    expect(conv.counterpartType).toBe("tenant");
    expect(conv.counterpartId).toBe(tenantId);
    expect(conv.lastMessageAt).not.toBeNull();
  });

  it("klassifiziert bekannte Handwerker als role 'contractor' mit Status 'pending'", async () => {
    seedContractor();
    const id = await ingestEmail(
      makeMail({ from: "klaus.rohr@example.com", messageId: "<msg-2@example.com>" }),
    );
    const msg = db.select().from(messages).where(eq(messages.id, id!)).get()!;
    expect(msg.role).toBe("contractor");
    expect(msg.processingStatus).toBe("pending");
  });

  it("legt unbekannte Absender als role 'unknown' mit Status 'done' ab — kein Agent-Lauf", async () => {
    const id = await ingestEmail(
      makeMail({ from: "fremd@example.com", messageId: "<msg-3@example.com>" }),
    );
    const msg = db.select().from(messages).where(eq(messages.id, id!)).get()!;
    expect(msg.role).toBe("unknown");
    expect(msg.processingStatus).toBe("done");

    const fake = makeAgentFake();
    await processPendingMessages(fake.deps);
    expect(fake.calls()).toBe(0);
  });

  it("dedupliziert per imapMessageId: zweiter Aufruf liefert null, kein zweiter Insert", async () => {
    seedTenant();
    const first = await ingestEmail(makeMail());
    const second = await ingestEmail(makeMail());
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    const all = db.select().from(messages).all();
    expect(all.length).toBe(1);
  });

  it("setzt ticketId aus dem [HV-id]-Betreff-Tag, wenn das Ticket existiert", async () => {
    const tenantId = seedTenant();
    const conversationId = findOrCreateConversation({
      email: "max.mustermann@example.com",
      counterpartType: "tenant",
      counterpartId: tenantId,
    });
    const ticketId = createTicket({
      tenantId,
      conversationId,
      type: "reparatur",
      title: "Türschloss defekt",
    });
    const id = await ingestEmail(
      makeMail({
        subject: `Re: Ihre Anfrage [HV-${ticketId}]`,
        messageId: "<msg-tag@example.com>",
      }),
    );
    const msg = db.select().from(messages).where(eq(messages.id, id!)).get()!;
    expect(msg.ticketId).toBe(ticketId);
  });

  it("setzt ticketId auf null, wenn das getaggte Ticket nicht existiert", async () => {
    seedTenant();
    const id = await ingestEmail(
      makeMail({ subject: "Re: [HV-999]", messageId: "<msg-tag-invalid@example.com>" }),
    );
    const msg = db.select().from(messages).where(eq(messages.id, id!)).get()!;
    expect(msg.ticketId).toBeNull();
  });

  it("legt Anhänge unter ATTACHMENTS_DIR/<messageId>/<sanitized> ab und schreibt die attachments-Row", async () => {
    seedTenant();
    const content = Buffer.from("fake-jpeg-daten");
    const id = await ingestEmail(
      makeMail({
        messageId: "<msg-att@example.com>",
        attachments: [{ filename: "foto tür.jpg", mimeType: "image/jpeg", content }],
      }),
    );

    const row = db
      .select()
      .from(attachments)
      .where(eq(attachments.messageId, id!))
      .get()!;
    expect(row.filename).toBe("foto tür.jpg"); // Originalname in der DB
    expect(row.mimeType).toBe("image/jpeg");
    expect(row.size).toBe(content.length);

    // Leerzeichen und 'ü' sind nicht in [a-zA-Z0-9._-] → '_'
    const expectedPath = path.join(path.resolve(attachmentsDir, String(id)), "foto_t_r.jpg");
    expect(row.filePath).toBe(expectedPath);
    expect(path.isAbsolute(row.filePath)).toBe(true);
    expect(fs.existsSync(row.filePath)).toBe(true);
    expect(fs.readFileSync(row.filePath, "utf8")).toBe("fake-jpeg-daten");
  });

  it("sanitisiert gefährliche Dateinamen — Datei bleibt INNERHALB des Zielordners", async () => {
    seedTenant();
    const id = await ingestEmail(
      makeMail({
        messageId: "<msg-evil@example.com>",
        attachments: [
          { filename: "../../evil.sh", mimeType: "text/x-sh", content: Buffer.from("echo boese") },
        ],
      }),
    );

    const row = db
      .select()
      .from(attachments)
      .where(eq(attachments.messageId, id!))
      .get()!;
    const messageDir = path.resolve(attachmentsDir, String(id));

    // Kein Pfadausbruch: filePath liegt strikt innerhalb des Message-Ordners.
    // Hinweis: die zweite Prüfung ist segment-bewusst (nicht `.startsWith("..")`
    // auf dem rohen String), da der sanitisierte Dateiname selbst mit ".."
    // beginnen darf (siehe Kommentar unten) — das ist kein Pfadausbruch,
    // solange ".." nicht als eigenes Pfadsegment auftritt.
    expect(row.filePath.startsWith(messageDir + path.sep)).toBe(true);
    const rel = path.relative(messageDir, row.filePath);
    expect(rel === ".." || rel.startsWith(`..${path.sep}`)).toBe(false);
    // '/' → '_', Punkte bleiben erlaubt: "../../evil.sh" → ".._.._evil.sh"
    expect(row.filePath).toBe(path.join(messageDir, ".._.._evil.sh"));
    expect(fs.existsSync(row.filePath)).toBe(true);
  });
});

describe("processPendingMessages", () => {
  it("verarbeitet pending Mieter-Nachrichten über den Agenten und markiert sie 'done'", async () => {
    seedTenant();
    const id = await ingestEmail(makeMail());
    const fake = makeAgentFake();

    await processPendingMessages(fake.deps);

    expect(fake.calls()).toBe(1);
    // Der Fake antwortet dem Mieter nicht → runAgentOnMessage legt eine Eskalation an
    // (Task-9-Verhalten); die Message ist trotzdem 'done'.
    const msg = db.select().from(messages).where(eq(messages.id, id!)).get()!;
    expect(msg.processingStatus).toBe("done");
  });

  it("überspringt Nachrichten mit processingAttempts >= 3", async () => {
    const tenantId = seedTenant();
    const conversationId = findOrCreateConversation({
      email: "max.mustermann@example.com",
      counterpartType: "tenant",
      counterpartId: tenantId,
    });
    db.insert(messages)
      .values({
        conversationId,
        direction: "inbound",
        role: "tenant",
        fromEmail: "max.mustermann@example.com",
        toEmail: "hausverwaltung@example.com",
        subject: "Alte Nachricht",
        body: "Diese Nachricht ist dreimal fehlgeschlagen.",
        processingStatus: "pending",
        processingAttempts: 3,
      })
      .run();

    const fake = makeAgentFake();
    await processPendingMessages(fake.deps);
    expect(fake.calls()).toBe(0);
  });

  it("überspringt role 'unknown' auch bei Status 'pending'", async () => {
    const conversationId = findOrCreateConversation({
      email: "fremd@example.com",
      counterpartType: "unknown",
    });
    db.insert(messages)
      .values({
        conversationId,
        direction: "inbound",
        role: "unknown",
        fromEmail: "fremd@example.com",
        toEmail: "hausverwaltung@example.com",
        subject: "Spam",
        body: "Hallo",
        processingStatus: "pending",
      })
      .run();

    const fake = makeAgentFake();
    await processPendingMessages(fake.deps);
    expect(fake.calls()).toBe(0);
  });
});

describe("pollOnce", () => {
  it("ruft fetch NICHT auf, wenn der Worker pausiert ist (Kill-Switch)", async () => {
    setSetting(WORKER_PAUSED_KEY, "1");
    let fetchCalls = 0;
    const fake = makeAgentFake();

    await pollOnce({
      fetch: async () => {
        fetchCalls++;
        return [];
      },
      agent: fake.deps,
    });

    expect(fetchCalls).toBe(0);
    expect(fake.calls()).toBe(0);
  });

  it("normaler Durchlauf: fetch → ingest → Verarbeitung", async () => {
    seedTenant();
    let fetchCalls = 0;
    const fake = makeAgentFake();

    await pollOnce({
      fetch: async () => {
        fetchCalls++;
        return [makeMail()];
      },
      agent: fake.deps,
    });

    expect(fetchCalls).toBe(1);
    expect(fake.calls()).toBe(1);
    const msg = db
      .select()
      .from(messages)
      .where(eq(messages.imapMessageId, "<msg-1@example.com>"))
      .get()!;
    expect(msg.processingStatus).toBe("done");
  });
});
