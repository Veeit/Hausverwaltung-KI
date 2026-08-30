import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
import {
  ingestEmail,
  processPendingMessages,
  pollOnce,
  resetStuckProcessingMessages,
} from "@/worker/processor";

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

  // Review-Befund: Ohne .trim() auf mail.from wurde ein bekannter Mieter mit
  // umgebenden Leerzeichen in der Absenderadresse (z.B. durch einen
  // eigenwillig kopierten Mail-Header) faelschlich als role "unknown"
  // eingestuft — die Nachricht waere dann NIE beantwortet worden.
  it("klassifiziert einen bekannten Mieter trotz umgebender Leerzeichen in der Absenderadresse korrekt", async () => {
    seedTenant();
    const id = await ingestEmail(
      makeMail({
        from: "  max.mustermann@example.com  ",
        messageId: "<msg-whitespace@example.com>",
      }),
    );
    const msg = db.select().from(messages).where(eq(messages.id, id!)).get()!;
    expect(msg.role).toBe("tenant");
    expect(msg.processingStatus).toBe("pending");
    expect(msg.fromEmail).toBe("max.mustermann@example.com");
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

  // Critical-Befund aus dem Abschluss-Review: Ein fremder Mieter nennt im
  // Betreff den Tag eines Tickets, das nicht ihm gehört (erraten oder aus
  // einer alten Mail bekannt). Ohne Berechtigungsprüfung würde die Nachricht
  // dem fremden Ticket zugeordnet — der komplette Ticket-Datensatz (inkl.
  // sensibler summary/collectedInfo) landete dann im KI-Kontext, und über
  // update_ticket könnte der fremde Mieter den Vorgang sogar verändern.
  it("ordnet den [HV-id]-Betreff-Tag NICHT zu, wenn der Absender nicht der Mieter dieses Tickets ist", async () => {
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
      title: "Vertretersuche",
    });
    const fremderTenant = db
      .insert(tenants)
      .values({
        name: "Fremde Mieterin",
        email: "fremd.mieterin@example.com",
        propertyId: db.select().from(properties).all()[0]!.id,
      })
      .returning({ id: tenants.id })
      .get();
    void fremderTenant;

    const id = await ingestEmail(
      makeMail({
        from: "fremd.mieterin@example.com",
        subject: `Re: [HV-${ticketId}]`,
        messageId: "<msg-fremdes-ticket@example.com>",
      }),
    );

    const msg = db.select().from(messages).where(eq(messages.id, id!)).get()!;
    expect(msg.role).toBe("tenant");
    expect(msg.ticketId).toBeNull();
  });

  // Gegenstück: ein Handwerker, der für dieses Ticket nicht beauftragt ist,
  // nennt trotzdem dessen Tag — auch das darf keine Zuordnung ergeben.
  it("ordnet den [HV-id]-Betreff-Tag NICHT zu, wenn der Handwerker für dieses Ticket nicht beauftragt ist", async () => {
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
      title: "Heizung defekt",
    });
    seedContractor(); // klaus.rohr@example.com — für DIESES Ticket nicht beauftragt

    const id = await ingestEmail(
      makeMail({
        from: "klaus.rohr@example.com",
        subject: `Re: [HV-${ticketId}]`,
        messageId: "<msg-fremder-handwerker@example.com>",
      }),
    );

    const msg = db.select().from(messages).where(eq(messages.id, id!)).get()!;
    expect(msg.role).toBe("contractor");
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

  // Bekannter Auslöser des Important-Befunds: ein Anhang mit sehr langem
  // Dateinamen löste in fs.writeFileSync ein unbehandeltes ENAMETOOLONG aus,
  // das aus ingestEmail herauspropagierte und (vor dem Fix) die komplette
  // pollOnce-Schleife abbrach. sanitizeFilename kürzt jetzt auf eine sichere
  // Länge — die Endung bleibt dabei erhalten, damit die Datei später noch
  // zugeordnet werden kann.
  it("kürzt einen sehr langen Dateinamen (500 Zeichen) auf eine sichere Länge, behält aber die Endung", async () => {
    seedTenant();
    const longName = "a".repeat(500) + ".pdf";
    const content = Buffer.from("harmloser pdf-inhalt");
    const id = await ingestEmail(
      makeMail({
        messageId: "<msg-longname@example.com>",
        attachments: [{ filename: longName, mimeType: "application/pdf", content }],
      }),
    );
    expect(id).not.toBeNull();

    const row = db
      .select()
      .from(attachments)
      .where(eq(attachments.messageId, id!))
      .get()!;
    const messageDir = path.resolve(attachmentsDir, String(id));

    // Datei liegt innerhalb von ATTACHMENTS_DIR und wurde erfolgreich geschrieben.
    expect(row.filePath.startsWith(messageDir + path.sep)).toBe(true);
    expect(fs.existsSync(row.filePath)).toBe(true);
    expect(fs.readFileSync(row.filePath, "utf8")).toBe("harmloser pdf-inhalt");

    // Die Endung bleibt erhalten, der Dateiname selbst ist sicher kurz.
    const writtenName = path.basename(row.filePath);
    expect(writtenName.endsWith(".pdf")).toBe(true);
    expect(writtenName.length).toBeLessThanOrEqual(200);
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

// Important-Befund aus dem Abschluss-Review: runAgentOnMessage() setzt den
// Status auf 'processing', BEVOR der Modell-Lauf beginnt. Stirbt der Prozess
// währenddessen, bliebe die Nachricht ohne diesen Reset für immer hängen —
// processPendingMessages() wählt nur 'pending', und die Übersicht zeigte
// bisher nur 'failed'. Wird beim Start des Worker-Prozesses aufgerufen
// (src/worker/index.ts), nicht bei jedem einzelnen Poll.
describe("resetStuckProcessingMessages", () => {
  it("setzt 'processing'-Nachrichten auf 'pending' zurück und lässt andere Status unangetastet", () => {
    const tenantId = seedTenant();
    const conversationId = findOrCreateConversation({
      email: "max.mustermann@example.com",
      counterpartType: "tenant",
      counterpartId: tenantId,
    });
    const base = {
      conversationId,
      direction: "inbound" as const,
      role: "tenant" as const,
      fromEmail: "max.mustermann@example.com",
      toEmail: "hausverwaltung@example.com",
      body: "Text",
    };
    const stuckId = Number(
      db.insert(messages).values({ ...base, subject: "hängt", processingStatus: "processing" }).run()
        .lastInsertRowid,
    );
    const pendingId = Number(
      db.insert(messages).values({ ...base, subject: "wartet", processingStatus: "pending" }).run()
        .lastInsertRowid,
    );
    const doneId = Number(
      db.insert(messages).values({ ...base, subject: "fertig", processingStatus: "done" }).run()
        .lastInsertRowid,
    );
    const failedId = Number(
      db.insert(messages).values({ ...base, subject: "kaputt", processingStatus: "failed" }).run()
        .lastInsertRowid,
    );

    const resetCount = resetStuckProcessingMessages();

    expect(resetCount).toBe(1);
    expect(db.select().from(messages).where(eq(messages.id, stuckId)).get()!.processingStatus).toBe(
      "pending",
    );
    expect(db.select().from(messages).where(eq(messages.id, pendingId)).get()!.processingStatus).toBe(
      "pending",
    );
    expect(db.select().from(messages).where(eq(messages.id, doneId)).get()!.processingStatus).toBe("done");
    expect(db.select().from(messages).where(eq(messages.id, failedId)).get()!.processingStatus).toBe(
      "failed",
    );
  });

  it("liefert 0, wenn keine Nachricht in 'processing' hängt", () => {
    expect(resetStuckProcessingMessages()).toBe(0);
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

  it("normaler Durchlauf: fetch → ingest → Verarbeitung, UID wird nach Erfolg quittiert", async () => {
    seedTenant();
    let fetchCalls = 0;
    const seenUids: number[] = [];
    const fake = makeAgentFake();

    await pollOnce({
      fetch: async () => {
        fetchCalls++;
        return [{ uid: 42, mail: makeMail() }];
      },
      markSeen: async (uids) => {
        seenUids.push(...uids);
      },
      agent: fake.deps,
    });

    expect(fetchCalls).toBe(1);
    expect(fake.calls()).toBe(1);
    expect(seenUids).toEqual([42]);
    const msg = db
      .select()
      .from(messages)
      .where(eq(messages.imapMessageId, "<msg-1@example.com>"))
      .get()!;
    expect(msg.processingStatus).toBe("done");
  });

  // Regressionstest für den Important-Befund: fetchNewEmails() markierte Mails
  // frueher schon beim Abholen als \Seen, BEVOR sie in der DB standen. Schlug
  // das Speichern danach fehl (z.B. durch einen kaputten Anhang), war die Mail
  // im Postfach gelesen markiert, wurde beim naechsten Poll nicht mehr geholt
  // und existierte nirgends — der schlimmste denkbare Fehler fuer eine
  // Mieter-Reparaturmeldung. Der Fix: \Seen wird erst NACH erfolgreicher
  // Persistierung gesetzt (markEmailsSeen, separat von fetchNewEmails), UND
  // pollOnce faengt Fehler PRO MAIL ab, damit eine kaputte Mail nicht die
  // gesamte for-Schleife abbricht und dabei die nachfolgenden, noch nicht
  // verarbeiteten Mails des Batches mit sich reisst.
  //
  // Die kaputte Mail hier hat `text: undefined` statt eines Strings — ein
  // realistischer Fall fuer eine unvollstaendig geparste/korrupte Mail (z.B.
  // ein zukuenftiger zweiter Kanal mit lockerer Validierung), der die
  // NOT-NULL-Spalte `messages.body` verletzt: der INSERT selbst schlaegt mit
  // einem echten, unbehandelten SqliteError fehl, BEVOR irgendeine Zeile
  // committet wird — die Mail landet also nachweislich nirgends in der DB.
  // (Ein kaputter Anhang wuerde denselben pollOnce-Fix ebenso durchlaufen,
  // haette aber bereits eine — unvollstaendige — message-Zeile erzeugt, da
  // ingestEmail die Message vor den Anhaengen persistiert; das wuerde hier
  // nur den Test verkomplizieren, ohne die eigentliche Regression staerker
  // zu belegen.)
  //
  // Die kaputte Mail wird ABSICHTLICH VOR der guten Mail im Batch platziert,
  // um zu beweisen, dass ein frueher Fehler die spaeteren Mails nicht mehr
  // mitreisst (das war exakt die alte Schleifenabbruch-Regression).
  it("Speicherfehler bei einer Mail: sie bleibt ungelesen, die übrigen Mails des Batches werden trotzdem verarbeitet und quittiert", async () => {
    seedTenant();
    const brokenMail = makeMail({
      messageId: "<msg-broken@example.com>",
      text: undefined as unknown as string,
    });
    const goodMail = makeMail({ messageId: "<msg-ok@example.com>" });
    const seenUids: number[] = [];
    const fake = makeAgentFake();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await pollOnce({
      fetch: async () => [
        { uid: 11, mail: brokenMail },
        { uid: 10, mail: goodMail },
      ],
      markSeen: async (uids) => {
        seenUids.push(...uids);
      },
      agent: fake.deps,
    });

    // Nur die erfolgreich gespeicherte Mail wird quittiert; die kaputte Mail
    // bleibt ungelesen und wird beim naechsten Poll erneut versucht.
    expect(seenUids).toEqual([10]);
    expect(seenUids).not.toContain(11);

    // Die kaputte Mail existiert nirgends in der DB (kein halb gespeicherter
    // Zustand) — der INSERT ist an der NOT-NULL-Constraint gescheitert, bevor
    // irgendetwas committet wurde.
    const brokenMsg = db
      .select()
      .from(messages)
      .where(eq(messages.imapMessageId, "<msg-broken@example.com>"))
      .get();
    expect(brokenMsg).toBeUndefined();

    // Die gute Mail — obwohl NACH der kaputten im Batch — wurde trotzdem
    // persistiert und verarbeitet (kein Schleifenabbruch mehr).
    const okMsg = db
      .select()
      .from(messages)
      .where(eq(messages.imapMessageId, "<msg-ok@example.com>"))
      .get();
    expect(okMsg).toBeTruthy();
    expect(okMsg!.processingStatus).toBe("done");
    expect(fake.calls()).toBe(1);

    // Der Fehler wurde geloggt, mit UID und Absender, damit man die Mail im
    // Postfach wiederfindet.
    expect(consoleErrorSpy).toHaveBeenCalled();
    const loggedText = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join(" ");
    expect(loggedText).toContain("11");
    expect(loggedText).toContain("max.mustermann@example.com");

    consoleErrorSpy.mockRestore();
  });

  // Review-Befund: markSeenFn() stand ohne eigenes try/catch VOR
  // processPendingMessages(). Warf das Quittieren (z.B. ein abgebrochener
  // IMAP-Verbindungsaufbau), erreichte processPendingMessages() diesen
  // Durchlauf gar nicht mehr — bereits sicher gespeicherte Nachrichten blieben
  // liegen, obwohl an ihrer Verarbeitung nichts hinderte. Kein Datenverlust:
  // nicht quittierte Mails werden beim naechsten Poll erneut geholt und ueber
  // die Message-ID dedupliziert (siehe ingestEmail).
  it("Quittierungsfehler (markSeen wirft): gespeicherte Nachrichten werden trotzdem verarbeitet", async () => {
    seedTenant();
    const fake = makeAgentFake();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await pollOnce({
      fetch: async () => [{ uid: 42, mail: makeMail() }],
      markSeen: async () => {
        throw new Error("IMAP-Verbindung abgebrochen");
      },
      agent: fake.deps,
    });

    // Die Nachricht wurde trotz gescheitertem Quittieren gespeichert UND verarbeitet.
    const msg = db
      .select()
      .from(messages)
      .where(eq(messages.imapMessageId, "<msg-1@example.com>"))
      .get();
    expect(msg).toBeTruthy();
    expect(msg!.processingStatus).toBe("done");
    expect(fake.calls()).toBe(1);

    // Der Quittierungsfehler wurde geloggt, statt den restlichen Durchlauf zu blockieren.
    expect(consoleErrorSpy).toHaveBeenCalled();
    const loggedText = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join(" ");
    expect(loggedText).toContain("IMAP-Verbindung abgebrochen");

    consoleErrorSpy.mockRestore();
  });
});
