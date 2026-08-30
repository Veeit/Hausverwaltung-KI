import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../helpers/db";
import { setDbForTesting, type AppDb } from "@/db/client";
import {
  approvals,
  contractors,
  conversations,
  escalations,
  messages,
  properties,
  tenants,
  tickets,
} from "@/db/schema";
import { createTicket, transitionTicket } from "@/lib/tickets";
import { addDocument } from "@/lib/documents";
import type { OutgoingEmail } from "@/channel/types";
import {
  buildAgentTools,
  type AgentToolContext,
  type AgentToolSpec,
} from "@/agent/tools";

const TENANT_EMAIL = "max.mustermann@example.com";
const CONTRACTOR_EMAIL = "sven.schloss@example.com";

interface Fixture {
  propertyId: number;
  tenantId: number;
  contractorId: number;
  conversationId: number;
  triggerMessageId: number;
  tenantEmail: string;
  contractorEmail: string;
}

function seedFixture(db: AppDb): Fixture {
  const { id: propertyId } = db
    .insert(properties)
    .values({ address: "Musterstraße 1, 20095 Hamburg" })
    .returning({ id: properties.id })
    .get();
  const { id: tenantId } = db
    .insert(tenants)
    .values({
      name: "Max Mustermann",
      email: TENANT_EMAIL,
      propertyId,
      unitLabel: "2. OG links",
    })
    .returning({ id: tenants.id })
    .get();
  const { id: contractorId } = db
    .insert(contractors)
    .values({
      name: "Sven Schloss",
      email: CONTRACTOR_EMAIL,
      trade: "Schlüsseldienst",
    })
    .returning({ id: contractors.id })
    .get();
  const { id: conversationId } = db
    .insert(conversations)
    .values({
      counterpartType: "tenant",
      counterpartId: tenantId,
      counterpartEmail: TENANT_EMAIL,
      subject: "Türschloss defekt",
    })
    .returning({ id: conversations.id })
    .get();
  const { id: triggerMessageId } = db
    .insert(messages)
    .values({
      conversationId,
      direction: "inbound",
      role: "tenant",
      fromEmail: TENANT_EMAIL,
      toEmail: "hausverwaltung@example.com",
      subject: "Türschloss defekt",
      body: "Mein Türschloss klemmt seit gestern.",
      processingStatus: "processing",
    })
    .returning({ id: messages.id })
    .get();
  return {
    propertyId,
    tenantId,
    contractorId,
    conversationId,
    triggerMessageId,
    tenantEmail: TENANT_EMAIL,
    contractorEmail: CONTRACTOR_EMAIL,
  };
}

function makeCtx(
  f: Fixture,
  overrides: Partial<AgentToolContext> = {},
): AgentToolContext {
  return {
    kind: "tenant_message",
    conversationId: f.conversationId,
    triggerMessageId: f.triggerMessageId,
    tenant: { id: f.tenantId, name: "Max Mustermann", email: f.tenantEmail },
    contractor: {
      id: f.contractorId,
      name: "Sven Schloss",
      email: f.contractorEmail,
    },
    ticketId: null,
    repliedToTenant: false,
    ...overrides,
  };
}

function getTool(specs: AgentToolSpec[], name: string): AgentToolSpec {
  const spec = specs.find((s) => s.name === name);
  if (!spec) throw new Error(`Tool ${name} nicht gefunden`);
  return spec;
}

function makeSendFnFake(): {
  calls: OutgoingEmail[];
  sendFn: (mail: OutgoingEmail) => Promise<void>;
} {
  const calls: OutgoingEmail[] = [];
  return {
    calls,
    sendFn: async (mail: OutgoingEmail) => {
      calls.push(mail);
    },
  };
}

function makeRepairTicket(f: Fixture): number {
  return createTicket({
    tenantId: f.tenantId,
    conversationId: f.conversationId,
    type: "reparatur",
    title: "Türschloss klemmt",
  });
}

let db: AppDb;
let fixture: Fixture;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test";
  process.env.MAIL_USER = "veit@example.com";
  process.env.MAIL_PASSWORD = "app-passwort";
  process.env.MAIL_ALIAS = "hausverwaltung@example.com";
  process.env.DASHBOARD_PASSWORD = "geheim";
  process.env.MAIL_RATE_LIMIT_PER_HOUR = "100";
  db = makeTestDb();
  fixture = seedFixture(db);
});

afterEach(() => {
  setDbForTesting(null);
});

describe("buildAgentTools", () => {
  it("liefert genau die fünf Vertrags-Tools", () => {
    const names = buildAgentTools(makeCtx(fixture)).map((s) => s.name);
    expect(names).toEqual([
      "search_documents",
      "update_ticket",
      "request_approval",
      "ask_landlord",
      "send_reply",
    ]);
  });
});

describe("search_documents", () => {
  it("findet passende Dokumente und nennt den Dateinamen", async () => {
    await addDocument(
      "hausordnung.txt",
      "text/plain",
      Buffer.from("Die Ruhezeiten gelten werktags von 22 bis 6 Uhr.", "utf8"),
    );
    const tool = getTool(buildAgentTools(makeCtx(fixture)), "search_documents");
    const result = await tool.run({ query: "Ruhezeiten" });
    expect(result.startsWith("FEHLER")).toBe(false);
    expect(result).toContain("hausordnung.txt");
  });

  it("meldet 'Keine Treffer.' ohne passende Dokumente", async () => {
    const tool = getTool(buildAgentTools(makeCtx(fixture)), "search_documents");
    const result = await tool.run({ query: "Fahrstuhlwartung" });
    expect(result).toBe("Keine Treffer.");
  });
});

describe("update_ticket", () => {
  it("legt ein Ticket an, setzt ctx.ticketId und verknüpft die Trigger-Message", async () => {
    const ctx = makeCtx(fixture);
    const tool = getTool(buildAgentTools(ctx), "update_ticket");
    const result = await tool.run({
      type: "reparatur",
      title: "Türschloss klemmt",
      summary: "Türschloss klemmt seit gestern.",
      urgency: "hoch",
    });
    expect(result.startsWith("FEHLER")).toBe(false);
    expect(ctx.ticketId).not.toBeNull();
    const ticket = db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ctx.ticketId!))
      .get();
    expect(ticket).toBeDefined();
    expect(ticket!.tenantId).toBe(fixture.tenantId);
    expect(ticket!.conversationId).toBe(fixture.conversationId);
    expect(ticket!.type).toBe("reparatur");
    expect(ticket!.title).toBe("Türschloss klemmt");
    expect(ticket!.status).toBe("neu");
    expect(ticket!.urgency).toBe("hoch");
    const trigger = db
      .select()
      .from(messages)
      .where(eq(messages.id, fixture.triggerMessageId))
      .get();
    expect(trigger!.ticketId).toBe(ctx.ticketId);
  });

  it("gibt FEHLER zurück, wenn bei der Anlage title fehlt", async () => {
    const ctx = makeCtx(fixture);
    const tool = getTool(buildAgentTools(ctx), "update_ticket");
    const result = await tool.run({ type: "reparatur" });
    expect(result.startsWith("FEHLER: ")).toBe(true);
    expect(ctx.ticketId).toBeNull();
    expect(db.select().from(tickets).all()).toHaveLength(0);
  });

  it("gibt FEHLER zurück, wenn kein Mieter im Kontext ist", async () => {
    const ctx = makeCtx(fixture, { tenant: null });
    const tool = getTool(buildAgentTools(ctx), "update_ticket");
    const result = await tool.run({
      type: "reparatur",
      title: "Türschloss klemmt",
    });
    expect(result.startsWith("FEHLER: ")).toBe(true);
    expect(db.select().from(tickets).all()).toHaveLength(0);
  });

  it("merged setInfo in das collectedInfo-JSON", async () => {
    const ticketId = makeRepairTicket(fixture);
    const ctx = makeCtx(fixture, { ticketId });
    const tool = getTool(buildAgentTools(ctx), "update_ticket");
    await tool.run({ setInfo: [{ key: "seit_wann", value: "gestern" }] });
    await tool.run({
      setInfo: [
        { key: "seit_wann", value: "vorgestern" },
        { key: "terminfenster", value: "Mo 8-12, Di 14-18, Mi 8-12" },
      ],
    });
    const ticket = db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .get();
    expect(JSON.parse(ticket!.collectedInfo)).toEqual({
      seit_wann: "vorgestern",
      terminfenster: "Mo 8-12, Di 14-18, Mi 8-12",
    });
  });

  it("führt einen gültigen Statuswechsel aus und verknüpft die Trigger-Message", async () => {
    const ticketId = makeRepairTicket(fixture);
    const ctx = makeCtx(fixture, { ticketId });
    const tool = getTool(buildAgentTools(ctx), "update_ticket");
    const result = await tool.run({ status: "infosammlung" });
    expect(result.startsWith("FEHLER")).toBe(false);
    const ticket = db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .get();
    expect(ticket!.status).toBe("infosammlung");
    const trigger = db
      .select()
      .from(messages)
      .where(eq(messages.id, fixture.triggerMessageId))
      .get();
    expect(trigger!.ticketId).toBe(ticketId);
  });

  it("gibt bei ungültigem Statuswechsel einen FEHLER-Text zurück", async () => {
    const ticketId = makeRepairTicket(fixture); // Status "neu"
    const ctx = makeCtx(fixture, { ticketId });
    const tool = getTool(buildAgentTools(ctx), "update_ticket");
    const result = await tool.run({ status: "terminiert" });
    expect(result.startsWith("FEHLER: ")).toBe(true);
    expect(result).toContain("Ungültiger Statuswechsel");
    const ticket = db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .get();
    expect(ticket!.status).toBe("neu");
  });
});

describe("request_approval", () => {
  it("legt den Genehmigungsantrag an und setzt Status + Dringlichkeit", async () => {
    const ticketId = makeRepairTicket(fixture);
    const ctx = makeCtx(fixture, { ticketId });
    const tool = getTool(buildAgentTools(ctx), "request_approval");
    const result = await tool.run({
      summary: "Türschloss klemmt, Schlüsseldienst soll reparieren.",
      contractorId: fixture.contractorId,
      emailSubject: "Reparaturauftrag Türschloss, Musterstraße 1",
      emailBody:
        "Sehr geehrter Herr Schloss, bitte nennen Sie uns einen Terminvorschlag.",
      urgency: "hoch",
    });
    expect(result.startsWith("FEHLER")).toBe(false);
    const approval = db
      .select()
      .from(approvals)
      .where(eq(approvals.ticketId, ticketId))
      .get();
    expect(approval).toBeDefined();
    expect(approval!.contractorId).toBe(fixture.contractorId);
    expect(approval!.emailSubject).toBe(
      "Reparaturauftrag Türschloss, Musterstraße 1",
    );
    expect(approval!.emailBody).toContain("Terminvorschlag");
    expect(approval!.status).toBe("offen");
    const ticket = db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .get();
    expect(ticket!.status).toBe("wartet_auf_genehmigung");
    expect(ticket!.urgency).toBe("hoch");
  });

  it("gibt FEHLER zurück, wenn noch kein Ticket existiert", async () => {
    const ctx = makeCtx(fixture); // ticketId: null
    const tool = getTool(buildAgentTools(ctx), "request_approval");
    const result = await tool.run({
      summary: "Türschloss klemmt.",
      contractorId: fixture.contractorId,
      emailSubject: "Reparaturauftrag",
      emailBody: "Bitte um Terminvorschlag.",
    });
    expect(result.startsWith("FEHLER: ")).toBe(true);
    expect(db.select().from(approvals).all()).toHaveLength(0);
  });

  it("gibt FEHLER bei unbekanntem contractorId zurück", async () => {
    const ticketId = makeRepairTicket(fixture);
    const ctx = makeCtx(fixture, { ticketId });
    const tool = getTool(buildAgentTools(ctx), "request_approval");
    const result = await tool.run({
      summary: "Türschloss klemmt.",
      contractorId: 999,
      emailSubject: "Reparaturauftrag",
      emailBody: "Bitte um Terminvorschlag.",
    });
    expect(result.startsWith("FEHLER: ")).toBe(true);
    expect(db.select().from(approvals).all()).toHaveLength(0);
    const ticket = db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .get();
    expect(ticket!.status).toBe("neu");
  });
});

describe("ask_landlord", () => {
  it("legt eine Eskalation an und setzt das Ticket auf eskaliert", async () => {
    const ticketId = makeRepairTicket(fixture);
    const ctx = makeCtx(fixture, { ticketId });
    const tool = getTool(buildAgentTools(ctx), "ask_landlord");
    const result = await tool.run({
      question: "Übernehmen wir die Kosten für den Schlüsseldienst?",
    });
    expect(result.startsWith("FEHLER")).toBe(false);
    const rows = db.select().from(escalations).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ticketId).toBe(ticketId);
    expect(rows[0]!.conversationId).toBe(fixture.conversationId);
    expect(rows[0]!.question).toBe(
      "Übernehmen wir die Kosten für den Schlüsseldienst?",
    );
    expect(rows[0]!.status).toBe("offen");
    const ticket = db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .get();
    expect(ticket!.status).toBe("eskaliert");
  });

  it("funktioniert auch ohne Ticket", async () => {
    const ctx = makeCtx(fixture); // ticketId: null
    const tool = getTool(buildAgentTools(ctx), "ask_landlord");
    const result = await tool.run({
      question: "Wie lautet die Regelung zur Kaution?",
    });
    expect(result.startsWith("FEHLER")).toBe(false);
    const rows = db.select().from(escalations).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ticketId).toBeNull();
    expect(rows[0]!.conversationId).toBe(fixture.conversationId);
  });
});

describe("send_reply", () => {
  it("mieter: sendet über sendFn, ergänzt den Ticket-Tag und setzt repliedToTenant", async () => {
    const ticketId = makeRepairTicket(fixture);
    const { calls, sendFn } = makeSendFnFake();
    const ctx = makeCtx(fixture, { ticketId, sendFn });
    const tool = getTool(buildAgentTools(ctx), "send_reply");
    const result = await tool.run({
      recipient: "mieter",
      subject: "Ihre Reparaturmeldung",
      body: "Sehr geehrter Herr Mustermann, wir kümmern uns um Ihr Anliegen.\n\nIhre Hausverwaltung (KI-Assistent)",
    });
    expect(result.startsWith("FEHLER")).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.to).toBe(fixture.tenantEmail);
    expect(calls[0]!.subject).toBe(`Ihre Reparaturmeldung [HV-${ticketId}]`);
    expect(ctx.repliedToTenant).toBe(true);
    const outbound = db
      .select()
      .from(messages)
      .where(eq(messages.direction, "outbound"))
      .all();
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.role).toBe("ai");
    expect(outbound[0]!.toEmail).toBe(fixture.tenantEmail);
    expect(outbound[0]!.processingStatus).toBe("done");
    expect(outbound[0]!.ticketId).toBe(ticketId);
  });

  it("handwerker vor Genehmigung: FEHLER, keine Mail", async () => {
    const ticketId = makeRepairTicket(fixture); // Status "neu"
    const { calls, sendFn } = makeSendFnFake();
    const ctx = makeCtx(fixture, { ticketId, sendFn });
    const tool = getTool(buildAgentTools(ctx), "send_reply");
    const result = await tool.run({
      recipient: "handwerker",
      subject: "Terminbestätigung",
      body: "Sehr geehrter Herr Schloss, der Termin passt.",
    });
    expect(result.startsWith("FEHLER: ")).toBe(true);
    expect(calls).toHaveLength(0);
    expect(ctx.repliedToTenant).toBe(false);
    expect(
      db.select().from(messages).where(eq(messages.direction, "outbound")).all(),
    ).toHaveLength(0);
  });

  it("handwerker bei Status handwerker_angefragt OHNE Genehmigung: FEHLER, keine Mail (Regression Critical-Befund)", async () => {
    // Sichert die behobene Sicherheitslücke ab: Vor dem Fix prüfte send_reply(handwerker)
    // NUR den Ticket-Status. Diesen Status kann die KI aber selbst herbeiführen, ohne
    // dass je eine Genehmigung stattfand — z.B. hier direkt per transitionTicket (force),
    // ohne jemals request_approval + Genehmigung durchlaufen zu haben. Die approvals-
    // Tabelle ist leer; das Gate muss trotz "passendem" Status ablehnen.
    const ticketId = makeRepairTicket(fixture);
    transitionTicket(ticketId, "handwerker_angefragt", { force: true });
    const { calls, sendFn } = makeSendFnFake();
    const ctx = makeCtx(fixture, { ticketId, sendFn });
    const tool = getTool(buildAgentTools(ctx), "send_reply");
    const result = await tool.run({
      recipient: "handwerker",
      subject: "Terminbestätigung",
      body: "Sehr geehrter Herr Schloss, der Termin passt dem Mieter.",
    });
    expect(result.startsWith("FEHLER: ")).toBe(true);
    expect(calls).toHaveLength(0);
    expect(ctx.repliedToTenant).toBe(false);
  });

  it("handwerker bei Status handwerker_angefragt MIT gültiger Genehmigung: sendet an den Handwerker", async () => {
    const ticketId = makeRepairTicket(fixture);
    db.insert(approvals)
      .values({
        ticketId,
        summary: "Türschloss klemmt, Schlüsseldienst soll reparieren.",
        contractorId: fixture.contractorId,
        emailSubject: "Reparaturauftrag",
        emailBody: "Bitte um Terminvorschlag.",
        status: "genehmigt",
      })
      .run();
    transitionTicket(ticketId, "handwerker_angefragt", { force: true });
    const { calls, sendFn } = makeSendFnFake();
    const ctx = makeCtx(fixture, { ticketId, sendFn });
    const tool = getTool(buildAgentTools(ctx), "send_reply");
    const result = await tool.run({
      recipient: "handwerker",
      subject: "Terminbestätigung",
      body: "Sehr geehrter Herr Schloss, der Termin passt dem Mieter.",
    });
    expect(result.startsWith("FEHLER")).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.to).toBe(fixture.contractorEmail);
    expect(calls[0]!.subject).toBe(`Terminbestätigung [HV-${ticketId}]`);
    expect(ctx.repliedToTenant).toBe(false);
  });

  it("handwerker bei Status terminiert MIT gültiger Genehmigung: sendet an den Handwerker", async () => {
    const ticketId = makeRepairTicket(fixture);
    db.insert(approvals)
      .values({
        ticketId,
        summary: "Türschloss klemmt, Schlüsseldienst soll reparieren.",
        contractorId: fixture.contractorId,
        emailSubject: "Reparaturauftrag",
        emailBody: "Bitte um Terminvorschlag.",
        status: "genehmigt",
      })
      .run();
    transitionTicket(ticketId, "terminiert", { force: true });
    const { calls, sendFn } = makeSendFnFake();
    const ctx = makeCtx(fixture, { ticketId, sendFn });
    const tool = getTool(buildAgentTools(ctx), "send_reply");
    const result = await tool.run({
      recipient: "handwerker",
      subject: "Terminbestätigung",
      body: "Sehr geehrter Herr Schloss, bis dann.",
    });
    expect(result.startsWith("FEHLER")).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.to).toBe(fixture.contractorEmail);
    expect(ctx.repliedToTenant).toBe(false);
  });

  it("Regression (Critical): Status-Bypass über Eskalations-Rückweg ohne Genehmigung wird abgelehnt", async () => {
    // Reproduziert die im Code-Review gefundene Lücke Schritt für Schritt:
    // 1. update_ticket legt ein Ticket an -> Status "neu"
    // 2. ask_landlord setzt den Status automatisch auf "eskaliert"
    // 3. update_ticket({status:"terminiert"}) wird akzeptiert, weil eskaliert -> terminiert
    //    in TICKET_TRANSITIONS erlaubt ist (Rückweg für die Wiederaufnahme nach einer
    //    Vermieter-Antwort) — die approvals-Tabelle bleibt dabei komplett leer.
    // 4. send_reply(handwerker) sah vor dem Fix nur den Status "terminiert" und ließ
    //    die Mail durch. Nach dem Fix muss Schritt 4 FEHLER liefern und der Fake-
    //    Versand darf nicht aufgerufen werden.
    const { calls, sendFn } = makeSendFnFake();
    const ctx = makeCtx(fixture, { sendFn });
    const tools = buildAgentTools(ctx);

    const createResult = await getTool(tools, "update_ticket").run({
      type: "reparatur",
      title: "Türschloss klemmt",
    });
    expect(createResult.startsWith("FEHLER")).toBe(false);
    expect(ctx.ticketId).not.toBeNull();

    const escalateResult = await getTool(tools, "ask_landlord").run({
      question: "Übernehmen wir die Kosten für den Schlüsseldienst?",
    });
    expect(escalateResult.startsWith("FEHLER")).toBe(false);
    const escalatedTicket = db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ctx.ticketId!))
      .get();
    expect(escalatedTicket!.status).toBe("eskaliert");

    const transitionResult = await getTool(tools, "update_ticket").run({
      status: "terminiert",
    });
    expect(transitionResult.startsWith("FEHLER")).toBe(false);
    const terminiertTicket = db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ctx.ticketId!))
      .get();
    expect(terminiertTicket!.status).toBe("terminiert");
    expect(db.select().from(approvals).all()).toHaveLength(0);

    const sendResult = await getTool(tools, "send_reply").run({
      recipient: "handwerker",
      subject: "Terminbestätigung",
      body: "Sehr geehrter Herr Schloss, der Termin passt.",
    });
    expect(sendResult.startsWith("FEHLER: ")).toBe(true);
    expect(calls).toHaveLength(0);
    expect(ctx.repliedToTenant).toBe(false);
  });

  it("mieter: protokolliert in der Mieter-Conversation, nicht in der auslösenden Handwerker-Conversation", async () => {
    // Fehlender Test für die bereits vorhandene Logik in send_reply: die Nachricht
    // muss in der Conversation des EMPFÄNGERS (Mieter) protokolliert werden, auch
    // wenn der Tool-Aufruf aus einem Handwerker-Kontext (ctx.conversationId zeigt auf
    // die Handwerker-Conversation) heraus erfolgt.
    const ticketId = makeRepairTicket(fixture);
    const { id: contractorConversationId } = db
      .insert(conversations)
      .values({
        counterpartType: "contractor",
        counterpartId: fixture.contractorId,
        counterpartEmail: fixture.contractorEmail,
        subject: "Terminvorschlag Schlüsseldienst",
      })
      .returning({ id: conversations.id })
      .get();
    expect(contractorConversationId).not.toBe(fixture.conversationId);
    const { calls, sendFn } = makeSendFnFake();
    const ctx = makeCtx(fixture, {
      kind: "contractor_message",
      conversationId: contractorConversationId,
      ticketId,
      sendFn,
    });
    const tool = getTool(buildAgentTools(ctx), "send_reply");
    const result = await tool.run({
      recipient: "mieter",
      subject: "Terminbestätigung",
      body: "Sehr geehrter Herr Mustermann, der Termin steht.",
    });
    expect(result.startsWith("FEHLER")).toBe(false);
    expect(calls).toHaveLength(1);
    const outbound = db
      .select()
      .from(messages)
      .where(eq(messages.direction, "outbound"))
      .all();
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.conversationId).toBe(fixture.conversationId);
    expect(outbound[0]!.conversationId).not.toBe(contractorConversationId);
  });

  it("RecipientNotAllowedError wird zu einem FEHLER-String statt einer Exception", async () => {
    const ticketId = makeRepairTicket(fixture);
    const { calls, sendFn } = makeSendFnFake();
    const ctx = makeCtx(fixture, {
      ticketId,
      tenant: {
        id: fixture.tenantId,
        name: "Unbekannt",
        email: "nicht-in-der-whitelist@example.com",
      },
      sendFn,
    });
    const tool = getTool(buildAgentTools(ctx), "send_reply");
    const result = await tool.run({
      recipient: "mieter",
      subject: "Test",
      body: "Testinhalt.",
    });
    expect(result.startsWith("FEHLER: ")).toBe(true);
    expect(result).toContain("Whitelist");
    expect(calls).toHaveLength(0);
    expect(
      db.select().from(messages).where(eq(messages.direction, "outbound")).all(),
    ).toHaveLength(0);
  });
});

describe("request_approval: ungültiger Statuswechsel", () => {
  it("gibt FEHLER zurück, wenn der Ticket-Status keinen Wechsel zu wartet_auf_genehmigung erlaubt", async () => {
    const ticketId = makeRepairTicket(fixture);
    transitionTicket(ticketId, "erledigt", { force: true });
    const ctx = makeCtx(fixture, { ticketId });
    const tool = getTool(buildAgentTools(ctx), "request_approval");
    const result = await tool.run({
      summary: "Türschloss klemmt.",
      contractorId: fixture.contractorId,
      emailSubject: "Reparaturauftrag",
      emailBody: "Bitte um Terminvorschlag.",
    });
    expect(result.startsWith("FEHLER: ")).toBe(true);
    expect(result).toContain("Ungültiger Statuswechsel");
    expect(db.select().from(approvals).all()).toHaveLength(0);
  });
});
