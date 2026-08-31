import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDbForTesting, type AppDb } from "@/db/client";
import { conversations, messages, properties, tenants } from "@/db/schema";
import { makeTestDb } from "../helpers/db";

// Regression zum Critical-Befund: betaZodTool (aus @anthropic-ai/sdk/helpers/beta/zod)
// importiert intern zod/v4 und ruft z.toJSONSchema() auf. Die Tool-Schemata in
// src/agent/tools.ts wurden ursprünglich mit "zod" (v3) gebaut, was in
// defaultRunTools() (src/agent/run.ts) zu einem synchronen TypeError führte —
// NOCH BEVOR irgendein Netzwerkaufruf stattfand. Kein bestehender Test deckte
// diesen Pfad ab, weil alle anderen Tests ein eigenes runTools injizieren und
// defaultRunTools damit nie ausführen.
//
// Dieser Test injiziert KEIN runTools, ruft also runAgentOnMessage über den
// echten defaultRunTools()-Pfad auf. Der Anthropic-Client selbst wird gemockt
// (kein echter API-Aufruf, kein echter Netzwerkzugriff), betaZodTool bleibt
// aber der echte Code aus dem SDK — genau die Stelle, die vorher abstürzte.

const { toolRunnerMock } = vi.hoisted(() => ({ toolRunnerMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    beta = { messages: { toolRunner: toolRunnerMock } };
  }
  return { default: FakeAnthropic };
});

import { runAgentOnMessage } from "@/agent/run";

let db: AppDb;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test";
  process.env.MAIL_USER = "test@fastmail.com";
  process.env.MAIL_PASSWORD = "test";
  process.env.MAIL_ALIAS = "hausverwaltung@example.com";
  process.env.DASHBOARD_PASSWORD = "geheim";
  process.env.MAIL_RATE_LIMIT_PER_HOUR = "20";
  db = makeTestDb();
  toolRunnerMock.mockReset();
  toolRunnerMock.mockResolvedValue({ stop_reason: "end_turn" });
});

afterEach(() => {
  setDbForTesting(null);
});

function seedTenantWorld(): { tenantId: number; conversationId: number } {
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
  return { tenantId, conversationId };
}

function insertMessage(input: { conversationId: number; role: string; body: string }): number {
  return Number(
    db
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        direction: "inbound",
        role: input.role,
        fromEmail: "max@example.com",
        toEmail: "hausverwaltung@example.com",
        subject: null,
        body: input.body,
      })
      .run().lastInsertRowid,
  );
}

describe("defaultRunTools (Regression Critical-Befund: betaZodTool + Zod-v3-Schemata)", () => {
  it("baut aus den echten Tool-Schemata gültige JSON-Schemas und ruft den Anthropic-Client ohne Absturz auf", async () => {
    const { conversationId } = seedTenantWorld();
    const msgId = insertMessage({ conversationId, role: "tenant", body: "Mein Türschloss klemmt." });

    // Kein deps.runTools -> runAgentOnMessage nutzt intern defaultRunTools(),
    // welches wiederum betaZodTool() auf den echten Tool-Schemata aufruft.
    await runAgentOnMessage(msgId);

    // Ohne den Fix wirft betaZodTool() synchron beim Aufbau des tools-Arrays,
    // bevor toolRunner je aufgerufen wird -> dieser Call bliebe aus.
    expect(toolRunnerMock).toHaveBeenCalledTimes(1);

    const params = toolRunnerMock.mock.calls[0]![0] as { tools: Array<{ name: string; input_schema: unknown }> };
    expect(params.tools).toHaveLength(5);
    expect(params.tools.map((t) => t.name)).toEqual([
      "search_documents",
      "update_ticket",
      "request_approval",
      "ask_landlord",
      "send_reply",
    ]);

    const searchDocsSchema = params.tools.find((t) => t.name === "search_documents")!.input_schema as {
      type: string;
      properties: Record<string, { type: string }>;
      required: string[];
    };
    expect(searchDocsSchema.type).toBe("object");
    expect(searchDocsSchema.properties.query).toBeDefined();
    expect(searchDocsSchema.properties.query.type).toBe("string");
    expect(searchDocsSchema.required).toContain("query");

    // Ohne den Fix würde der Wurf im try/catch von runAgentOnMessage landen und
    // die Nachricht bliebe auf "pending" (Versuch 1) statt "done" zu werden.
    const message = db.select().from(messages).where(eq(messages.id, msgId)).get()!;
    expect(message.processingStatus).toBe("done");
    expect(message.processingAttempts).toBe(0);
    expect(message.processingError).toBeNull();
  });
});
