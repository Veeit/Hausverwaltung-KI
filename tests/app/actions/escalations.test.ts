import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT: ${url}`);
  }),
}));
vi.mock("next/headers", async () => {
  const { cookiesStub } = await import("../../helpers/nextMocks");
  // cookiesStub() liefert das Store-Objekt, NICHT die cookies-Funktion —
  // requireAuth() ruft `await cookies()` auf, hier muss also eine Funktion stehen.
  return { cookies: vi.fn(async () => cookiesStub()) };
});

import { setDbForTesting, type AppDb } from "@/db/client";
import {
  conversations,
  escalations,
  messages,
  properties,
  tenants,
  tickets,
} from "@/db/schema";
import { makeTestDb } from "../../helpers/db";
import { setAuthCookieValue } from "../../helpers/nextMocks";
import { sha256Hex } from "@/lib/auth";
import { answerEscalation } from "@/app/actions/escalations";

let db: AppDb;

beforeEach(async () => {
  process.env.ANTHROPIC_API_KEY = "test";
  process.env.MAIL_USER = "veit@fastmail.com";
  process.env.MAIL_PASSWORD = "test-app-passwort";
  process.env.MAIL_ALIAS = "hausverwaltung@example.com";
  process.env.DASHBOARD_PASSWORD = "geheim";
  // Ohne diese Zeile liefert cookiesStub() kein Auth-Cookie, requireAuth()
  // löst redirect("/login") aus und JEDER Test dieser Datei schlägt fehl.
  setAuthCookieValue(await sha256Hex("geheim"));
  db = makeTestDb();
});

afterEach(() => {
  setDbForTesting(null);
  vi.clearAllMocks();
});

function seedTenantConversation(): { tenantId: number; conversationId: number } {
  const propertyId = Number(
    db
      .insert(properties)
      .values({ address: "Musterstraße 1, 20095 Hamburg" })
      .run().lastInsertRowid,
  );
  const tenantId = Number(
    db
      .insert(tenants)
      .values({
        name: "Max Mustermann",
        email: "max.mustermann@example.com",
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
        counterpartEmail: "max.mustermann@example.com",
      })
      .run().lastInsertRowid,
  );
  return { tenantId, conversationId };
}

function seedEscalationWithTicket(): {
  conversationId: number;
  ticketId: number;
  escalationId: number;
} {
  const { tenantId, conversationId } = seedTenantConversation();
  const ticketId = Number(
    db
      .insert(tickets)
      .values({
        tenantId,
        conversationId,
        type: "reparatur",
        status: "eskaliert",
        title: "Türschloss klemmt",
      })
      .run().lastInsertRowid,
  );
  const escalationId = Number(
    db
      .insert(escalations)
      .values({
        ticketId,
        conversationId,
        question: "Dürfen wir den Schlüsseldienst mit Notöffnung beauftragen?",
      })
      .run().lastInsertRowid,
  );
  return { conversationId, ticketId, escalationId };
}

describe("answerEscalation", () => {
  it("setzt answer, status 'beantwortet' und answeredAt", async () => {
    const { escalationId } = seedEscalationWithTicket();

    await answerEscalation(escalationId, "Ja, bitte beauftragen.");

    const esc = db
      .select()
      .from(escalations)
      .where(eq(escalations.id, escalationId))
      .get();
    expect(esc?.status).toBe("beantwortet");
    expect(esc?.answer).toBe("Ja, bitte beauftragen.");
    expect(esc?.answeredAt).toBeTruthy();
    expect(esc?.answeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("legt synthetische Landlord-Message mit exaktem Body-Muster an", async () => {
    const { conversationId, ticketId, escalationId } = seedEscalationWithTicket();

    await answerEscalation(escalationId, "Ja, bitte beauftragen.");

    const rows = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .all();
    expect(rows).toHaveLength(1);
    const msg = rows[0];
    expect(msg.direction).toBe("inbound");
    expect(msg.role).toBe("landlord");
    expect(msg.processingStatus).toBe("pending");
    expect(msg.ticketId).toBe(ticketId);
    expect(msg.fromEmail).toBe("vermieter@dashboard.intern");
    expect(msg.toEmail).toBe("hausverwaltung@example.com");
    expect(msg.subject).toBe(`Türschloss klemmt [HV-${ticketId}]`);
    expect(msg.body).toBe(
      'Antwort des Vermieters auf die Rückfrage "Dürfen wir den Schlüsseldienst mit Notöffnung beauftragen?": Ja, bitte beauftragen.\nBitte formuliere daraus eine Antwort an den Mieter.',
    );
    expect(msg.body).toContain(
      "Dürfen wir den Schlüsseldienst mit Notöffnung beauftragen?",
    );
    expect(msg.body).toContain("Ja, bitte beauftragen.");
  });

  it("funktioniert bei Eskalation ohne Ticket: Message ohne ticketId", async () => {
    const { conversationId } = seedTenantConversation();
    const escalationId = Number(
      db
        .insert(escalations)
        .values({
          ticketId: null,
          conversationId,
          question: "Wie lautet die Hausordnung zum Thema Grillen?",
        })
        .run().lastInsertRowid,
    );

    await answerEscalation(escalationId, "Grillen ist auf dem Balkon nicht erlaubt.");

    const rows = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .all();
    expect(rows).toHaveLength(1);
    const msg = rows[0];
    expect(msg.ticketId).toBeNull();
    expect(msg.direction).toBe("inbound");
    expect(msg.role).toBe("landlord");
    expect(msg.processingStatus).toBe("pending");
    expect(msg.subject).toBe("Antwort des Vermieters");
    expect(msg.body).toBe(
      'Antwort des Vermieters auf die Rückfrage "Wie lautet die Hausordnung zum Thema Grillen?": Grillen ist auf dem Balkon nicht erlaubt.\nBitte formuliere daraus eine Antwort an den Mieter.',
    );
  });

  it("wirft bei bereits beantworteter Eskalation und legt keine zweite Message an", async () => {
    const { conversationId, escalationId } = seedEscalationWithTicket();

    await answerEscalation(escalationId, "Ja, bitte beauftragen.");
    await expect(
      answerEscalation(escalationId, "Doch lieber nicht."),
    ).rejects.toThrow(/bereits beantwortet/);

    const rows = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .all();
    expect(rows).toHaveLength(1);
  });
});
