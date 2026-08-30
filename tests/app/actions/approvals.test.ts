// tests/app/actions/approvals.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { makeTestDb } from "../../helpers/db";
import { setDbForTesting, type AppDb } from "@/db/client";
import {
  approvals,
  contractors,
  conversations,
  messages,
  properties,
  tenants,
  tickets,
} from "@/db/schema";
import { setAuthCookieValue } from "../../helpers/nextMocks";
import { sha256Hex } from "@/lib/auth";
import { sendSmtp } from "@/channel/smtp";
import { transitionTicket } from "@/lib/tickets";
import {
  approveApproval,
  rejectApproval,
  updateApprovalDraft,
} from "@/app/actions/approvals";

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

function seed(ticketStatus: string = "wartet_auf_genehmigung") {
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
  const contractor = db
    .insert(contractors)
    .values({
      name: "Sven Schloss",
      email: "sven.schloss@example.com",
      trade: "Schlüsseldienst",
    })
    .returning()
    .get();
  const approval = db
    .insert(approvals)
    .values({
      ticketId: ticket.id,
      summary: "Türschloss klemmt stark, Schlüsseldienst soll reparieren.",
      contractorId: contractor.id,
      emailSubject: "Reparaturanfrage Türschloss",
      emailBody:
        "Guten Tag,\n\nin der Musterstraße 1 (2. OG links) klemmt das Wohnungstürschloss.\nTerminfenster des Mieters: Mo 8-12 Uhr, Di 14-18 Uhr.\nBitte um Terminvorschlag per Antwort auf diese E-Mail.\n\nMit freundlichen Grüßen",
    })
    .returning()
    .get();
  return { prop, tenant, conv, ticket, contractor, approval };
}

describe("approveApproval", () => {
  it("durchläuft die Statuskette wartet_auf_genehmigung → genehmigt → handwerker_angefragt und sendet die Handwerker-Mail mit Tag", async () => {
    const { ticket, contractor, approval } = seed();
    // Beide Statuswechsel laufen ohne force über transitionTicket — der Endstatus
    // handwerker_angefragt ist von wartet_auf_genehmigung aus NUR über die
    // Zwischenstation genehmigt erreichbar, sonst würfe transitionTicket.
    await approveApproval(approval.id);

    const updatedTicket = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get();
    expect(updatedTicket?.status).toBe("handwerker_angefragt");
    expect(updatedTicket?.contractorId).toBe(contractor.id);

    const updatedApproval = db
      .select()
      .from(approvals)
      .where(eq(approvals.id, approval.id))
      .get();
    expect(updatedApproval?.status).toBe("genehmigt");
    expect(updatedApproval?.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(sendSmtp).toHaveBeenCalledTimes(1);
    const mail = vi.mocked(sendSmtp).mock.calls[0][0];
    expect(mail.to).toBe("sven.schloss@example.com");
    expect(mail.subject).toBe(`Reparaturanfrage Türschloss [HV-${ticket.id}]`);
    expect(mail.text).toBe(approval.emailBody);

    const contractorConv = db
      .select()
      .from(conversations)
      .where(eq(conversations.counterpartEmail, "sven.schloss@example.com"))
      .get();
    expect(contractorConv).toBeDefined();
    const outbound = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, contractorConv!.id))
      .all();
    expect(outbound).toHaveLength(1);
    expect(outbound[0].direction).toBe("outbound");
    expect(outbound[0].role).toBe("landlord");
    expect(outbound[0].ticketId).toBe(ticket.id);
    expect(outbound[0].processingStatus).toBe("done");
  });

  it("liefert einen Fehler als Rückgabewert, wenn der Antrag bereits entschieden ist, und sendet nichts", async () => {
    const { ticket, approval } = seed();
    db.update(approvals)
      .set({ status: "genehmigt", decidedAt: new Date().toISOString() })
      .where(eq(approvals.id, approval.id))
      .run();

    const result = await approveApproval(approval.id);

    expect(result.error).toBeTruthy();
    expect(sendSmtp).not.toHaveBeenCalled();

    const unchanged = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get();
    expect(unchanged?.status).toBe("wartet_auf_genehmigung");
  });

  it("liefert einen Fehler als Rückgabewert, wenn das Ticket weder wartet_auf_genehmigung noch genehmigt ist, und sendet nichts", async () => {
    const { ticket, approval } = seed("infosammlung");

    const result = await approveApproval(approval.id);

    expect(result.error).toBeTruthy();
    expect(sendSmtp).not.toHaveBeenCalled();

    const unchanged = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get();
    expect(unchanged?.status).toBe("infosammlung");
  });

  it("ist wiederholbar: aus dem Status genehmigt heraus geht die Handwerker-Mail doch noch raus", async () => {
    // Szenario: Der erste Klick hat das Ticket auf "genehmigt" gesetzt, dann
    // schlug der SMTP-Versand fehl. Der Antrag steht noch auf "offen".
    // Der zweite Klick muss den Vorgang zu Ende bringen statt ihn zu blockieren.
    const { ticket, approval } = seed("genehmigt");

    await approveApproval(approval.id);

    expect(sendSmtp).toHaveBeenCalledTimes(1);
    const finished = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get();
    expect(finished?.status).toBe("handwerker_angefragt");
    const decided = db
      .select()
      .from(approvals)
      .where(eq(approvals.id, approval.id))
      .get();
    expect(decided?.status).toBe("genehmigt");
  });

  // Review-Befund Punkt 4: Stellt die KI während der Wartezeit eine Rückfrage
  // (ask_landlord setzt das Ticket automatisch auf "eskaliert"), muss der
  // Antrag trotzdem noch genehmigbar sein — sonst ist er unentscheidbar,
  // obwohl er unverändert mit rotem Zähler im Dashboard steht.
  it("genehmigt auch aus dem Status eskaliert heraus und sendet die Handwerker-Mail", async () => {
    const { ticket, contractor, approval } = seed("eskaliert");

    await approveApproval(approval.id);

    const updatedTicket = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get();
    expect(updatedTicket?.status).toBe("handwerker_angefragt");
    expect(updatedTicket?.contractorId).toBe(contractor.id);

    const updatedApproval = db
      .select()
      .from(approvals)
      .where(eq(approvals.id, approval.id))
      .get();
    expect(updatedApproval?.status).toBe("genehmigt");

    expect(sendSmtp).toHaveBeenCalledTimes(1);
  });

  it("stellt den Zustand her, den das Agent-Werkzeug send_reply für Handwerker-Mails voraussetzt", async () => {
    // send_reply (src/agent/tools.ts) lässt E-Mails an den Handwerker nur zu,
    // wenn GENAU diese Kombination existiert: eine approvals-Zeile mit
    // status="genehmigt" für GENAU dieses Ticket und GENAU diesen Handwerker,
    // sowie tickets.contractorId gesetzt. Dieser Test bildet exakt die Gate-
    // Abfrage aus tools.ts nach, damit eine künftige Änderung an approveApproval
    // diesen Vertrag nicht versehentlich bricht.
    const { ticket, contractor, approval } = seed();

    await approveApproval(approval.id);

    const gateRow = db
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.ticketId, ticket.id),
          eq(approvals.status, "genehmigt"),
          eq(approvals.contractorId, contractor.id),
        ),
      )
      .get();
    expect(gateRow).toBeDefined();
    expect(gateRow?.id).toBe(approval.id);

    const updatedTicket = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get();
    expect(updatedTicket?.contractorId).toBe(contractor.id);
  });

  it("schickt bei zwei überlappenden Genehmigungen genau eine Mail an den Handwerker (Race Condition)", async () => {
    // Realistische SMTP-Latenz simulieren: Ein sofort auflösender Mock würde
    // den Test zufällig serialisieren (requireAuth() braucht selbst ein paar
    // Mikro-Ticks) und die Race Condition dadurch verdecken, statt sie zu
    // beweisen. Mit spürbarer Verzögerung sind beide Aufrufe garantiert
    // gleichzeitig "in Flight", bevor irgendeine Antwort zurückkommt.
    const { ticket, approval } = seed();
    vi.mocked(sendSmtp).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 30)),
    );

    // approveApproval wirft für diesen (erwartbaren) Konfliktfall nicht mehr —
    // beide Aufrufe lösen sich auf, aber nur einer ohne Fehler (siehe
    // src/lib/actionResult.ts).
    const results = await Promise.all([
      approveApproval(approval.id),
      approveApproval(approval.id),
    ]);

    expect(sendSmtp).toHaveBeenCalledTimes(1);

    const succeeded = results.filter((r) => r.error === null);
    const failed = results.filter((r) => r.error !== null);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error).toMatch(/bereits/);

    const finalTicket = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get();
    expect(finalTicket?.status).toBe("handwerker_angefragt");

    const finalApproval = db
      .select()
      .from(approvals)
      .where(eq(approvals.id, approval.id))
      .get();
    expect(finalApproval?.status).toBe("genehmigt");
  });
});

describe("rejectApproval", () => {
  it("lehnt Antrag und Ticket ab und legt eine synthetische Landlord-Message mit Begründung an", async () => {
    const { conv, ticket, approval } = seed();

    await rejectApproval(approval.id, "Zu teuer, bitte erst einen Kostenvoranschlag einholen");

    const updatedApproval = db
      .select()
      .from(approvals)
      .where(eq(approvals.id, approval.id))
      .get();
    expect(updatedApproval?.status).toBe("abgelehnt");
    expect(updatedApproval?.decisionNote).toBe(
      "Zu teuer, bitte erst einen Kostenvoranschlag einholen",
    );
    expect(updatedApproval?.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const updatedTicket = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get();
    expect(updatedTicket?.status).toBe("abgelehnt");

    const synthetic = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id))
      .all();
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0].direction).toBe("inbound");
    expect(synthetic[0].role).toBe("landlord");
    expect(synthetic[0].processingStatus).toBe("pending");
    expect(synthetic[0].ticketId).toBe(ticket.id);
    expect(synthetic[0].fromEmail).toBe("vermieter@dashboard.intern");
    expect(synthetic[0].toEmail).toBe("hausverwaltung@example.com");
    expect(synthetic[0].subject).toBe(`Türschloss defekt [HV-${ticket.id}]`);
    expect(synthetic[0].body).toBe(
      `Der Vermieter hat den Genehmigungsantrag zu Ticket [HV-${ticket.id}] abgelehnt. Begründung: Zu teuer, bitte erst einen Kostenvoranschlag einholen. Bitte informiere den Mieter freundlich und biete ggf. Alternativen an.`,
    );
    expect(synthetic[0].body).toContain(
      "Zu teuer, bitte erst einen Kostenvoranschlag einholen",
    );

    expect(sendSmtp).not.toHaveBeenCalled();
  });

  it("liefert einen Fehler als Rückgabewert, wenn der Antrag bereits entschieden ist", async () => {
    const { approval } = seed();
    db.update(approvals)
      .set({ status: "abgelehnt", decidedAt: new Date().toISOString() })
      .where(eq(approvals.id, approval.id))
      .run();

    const result = await rejectApproval(approval.id, "Egal");

    expect(result.error).toBeTruthy();
  });

  // Review-Befund Punkt 4: Stellt die KI während der Wartezeit eine Rückfrage
  // (ask_landlord), wechselt das Ticket automatisch nach "eskaliert" — ein
  // offener Antrag muss auch dann noch ablehnbar bleiben, sonst steht er
  // unentscheidbar mit rotem Zähler dauerhaft im Dashboard.
  it("lehnt einen Antrag auch dann ab, wenn das Ticket zwischenzeitlich nach 'eskaliert' gewechselt hat", async () => {
    const { conv, ticket, approval } = seed();
    transitionTicket(ticket.id, "eskaliert");

    await rejectApproval(approval.id, "Zu teuer, bitte erst einen Kostenvoranschlag einholen");

    const updatedApproval = db
      .select()
      .from(approvals)
      .where(eq(approvals.id, approval.id))
      .get();
    expect(updatedApproval?.status).toBe("abgelehnt");

    const updatedTicket = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get();
    expect(updatedTicket?.status).toBe("abgelehnt");

    const synthetic = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id))
      .all();
    expect(synthetic).toHaveLength(1);
  });

  it("bricht ab, wenn das Ticket in einem Status steht, aus dem heraus 'abgelehnt' kein gültiger Übergang ist, und lässt den Antrag bearbeitbar", async () => {
    // "genehmigt" ist weder aus wartet_auf_genehmigung noch aus eskaliert
    // erreichbares Ziel für "abgelehnt" — der Guard muss weiterhin für jeden
    // sonstigen Status greifen, nicht pauschal für alle Status geöffnet werden.
    const { conv, ticket, approval } = seed();
    transitionTicket(ticket.id, "genehmigt");

    const result = await rejectApproval(
      approval.id,
      "Zu teuer, bitte erst einen Kostenvoranschlag einholen",
    );

    expect(result.error).toBeTruthy();

    // Der Antrag darf NICHT unwiderruflich auf "abgelehnt" stehen bleiben —
    // sonst verschwindet er aus /genehmigungen, ein erneuter Versuch ist
    // blockiert, und die synthetische Nachricht an den Mieter wird nie erzeugt.
    const unchangedApproval = db
      .select()
      .from(approvals)
      .where(eq(approvals.id, approval.id))
      .get();
    expect(unchangedApproval?.status).toBe("offen");

    const unchangedTicket = db.select().from(tickets).where(eq(tickets.id, ticket.id)).get();
    expect(unchangedTicket?.status).toBe("genehmigt");

    const synthetic = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id))
      .all();
    expect(synthetic).toHaveLength(0);
  });
});

describe("updateApprovalDraft", () => {
  it("aktualisiert Betreff und Body eines offenen Antrags", async () => {
    const { approval } = seed();

    await updateApprovalDraft(approval.id, "Neuer Betreff", "Neuer Mail-Text");

    const updated = db
      .select()
      .from(approvals)
      .where(eq(approvals.id, approval.id))
      .get();
    expect(updated?.emailSubject).toBe("Neuer Betreff");
    expect(updated?.emailBody).toBe("Neuer Mail-Text");
    expect(updated?.status).toBe("offen");
  });

  it("liefert einen Fehler als Rückgabewert bei bereits entschiedenem Antrag", async () => {
    const { approval } = seed();
    db.update(approvals)
      .set({ status: "genehmigt", decidedAt: new Date().toISOString() })
      .where(eq(approvals.id, approval.id))
      .run();

    const result = await updateApprovalDraft(approval.id, "Neuer Betreff", "Neuer Mail-Text");

    expect(result.error).toBeTruthy();
  });
});
