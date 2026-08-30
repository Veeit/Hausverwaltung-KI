// tests/app/actions/tickets.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../../helpers/db";
import { setAuthCookieValue } from "../../helpers/nextMocks";
import { setDbForTesting, type AppDb } from "@/db/client";
import { conversations, messages, properties, tenants, tickets } from "@/db/schema";
import { sha256Hex } from "@/lib/auth";
import { sendSmtp } from "@/channel/smtp";
import { sendManualReply, setTicketStatus } from "@/app/actions/tickets";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/headers", async () => {
  const { cookiesStub } = await import("../../helpers/nextMocks");
  return { cookies: async () => await cookiesStub() };
});
vi.mock("@/channel/smtp", () => ({ sendSmtp: vi.fn(async () => {}) }));

let db: AppDb;

beforeEach(async () => {
  process.env.ANTHROPIC_API_KEY = "test";
  process.env.MAIL_USER = "veit@example.com";
  process.env.MAIL_PASSWORD = "app-passwort";
  process.env.MAIL_ALIAS = "hausverwaltung@example.com";
  process.env.DASHBOARD_PASSWORD = "test-passwort";
  process.env.MAIL_RATE_LIMIT_PER_HOUR = "20";
  // Ohne diese Zeile liefert cookiesStub() kein Auth-Cookie, requireAuth()
  // löst redirect("/login") aus und JEDER Test dieser Datei schlägt fehl.
  // Vitest isoliert Module pro Testdatei — der in Task 12 gesetzte Wert wirkt hier nicht.
  setAuthCookieValue(await sha256Hex("test-passwort"));
  db = makeTestDb();
  vi.mocked(sendSmtp).mockClear();
});

afterEach(() => {
  setDbForTesting(null);
});

function seed(ticketStatus: string) {
  const prop = db
    .insert(properties)
    .values({ address: "Musterstraße 1, 20095 Hamburg" })
    .returning()
    .get();
  const tenant = db
    .insert(tenants)
    .values({
      name: "Max Mustermann",
      email: "max.mustermann@example.com",
      propertyId: prop.id,
      unitLabel: "2. OG links",
    })
    .returning()
    .get();
  const conv = db
    .insert(conversations)
    .values({
      counterpartType: "tenant",
      counterpartId: tenant.id,
      counterpartEmail: tenant.email,
    })
    .returning()
    .get();
  const ticket = db
    .insert(tickets)
    .values({
      tenantId: tenant.id,
      conversationId: conv.id,
      type: "reparatur",
      status: ticketStatus,
      title: "Türschloss defekt",
    })
    .returning()
    .get();
  return { prop, tenant, conv, ticket };
}

describe("setTicketStatus", () => {
  it("erzwingt auch laut Statusmaschine ungültige Wechsel: erledigt → infosammlung (force)", async () => {
    const { ticket } = seed("erledigt");

    await setTicketStatus(ticket.id, "infosammlung");

    const updated = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get();
    expect(updated?.status).toBe("infosammlung");
  });

  it("setzt einen regulären Statuswechsel: neu → erledigt", async () => {
    const { ticket } = seed("neu");

    await setTicketStatus(ticket.id, "erledigt");

    const updated = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get();
    expect(updated?.status).toBe("erledigt");
  });
});

describe("sendManualReply", () => {
  it("sendet an die Mieter-Adresse mit Ticket-Tag im Betreff und loggt eine outbound-Message mit Rolle landlord", async () => {
    const { tenant, conv, ticket } = seed("infosammlung");

    await sendManualReply(ticket.id, "Guten Tag, wir kümmern uns umgehend um Ihr Anliegen.");

    expect(sendSmtp).toHaveBeenCalledTimes(1);
    const mail = vi.mocked(sendSmtp).mock.calls[0][0];
    expect(mail.to).toBe(tenant.email);
    expect(mail.subject).toBe(`Ihre Anfrage [HV-${ticket.id}]`);
    expect(mail.text).toBe("Guten Tag, wir kümmern uns umgehend um Ihr Anliegen.");

    const logged = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id))
      .all();
    expect(logged).toHaveLength(1);
    expect(logged[0].direction).toBe("outbound");
    expect(logged[0].role).toBe("landlord");
    expect(logged[0].ticketId).toBe(ticket.id);
    expect(logged[0].fromEmail).toBe("hausverwaltung@example.com");
    expect(logged[0].toEmail).toBe(tenant.email);
    expect(logged[0].body).toBe("Guten Tag, wir kümmern uns umgehend um Ihr Anliegen.");
    expect(logged[0].processingStatus).toBe("done");
  });

  it("wirft bei unbekanntem Ticket", async () => {
    await expect(sendManualReply(999, "Hallo")).rejects.toThrow();
    expect(sendSmtp).not.toHaveBeenCalled();
  });

  it("wirft bei leerem Text und sendet nichts", async () => {
    const { ticket } = seed("infosammlung");
    await expect(sendManualReply(ticket.id, "   ")).rejects.toThrow();
    expect(sendSmtp).not.toHaveBeenCalled();
  });
});
