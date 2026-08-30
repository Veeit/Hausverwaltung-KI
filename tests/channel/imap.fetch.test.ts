import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Haertungsluecke: fetchNewEmails() (src/channel/imap.ts) hat NULL Testabdeckung
// (nur die reine Hilfsfunktion filterToAlias wird in tests/channel/imap.test.ts
// getestet) - dabei laeuft die komplette IMAP-Orchestrierung bei jedem
// Poll-Zyklus in Produktion. In genau dieser Funktion wurden laut Auftrag
// bereits zwei Datenschutz-relevante Fehler gefunden und behoben (das System
// laeuft auf dem privaten Postfach des Nutzers).
//
// Task 10 Fix: fetchNewEmails() markiert Mails NICHT MEHR selbst als \Seen —
// das passiert erst nach erfolgreicher Persistierung durch den Aufrufer, ueber
// die separate Funktion markEmailsSeen(). Der Grund: wuerde \Seen schon beim
// Abholen gesetzt (wie fruehe), ginge eine Mail bei jedem nachgelagerten
// Speicherfehler stillschweigend verloren (gelesen markiert, nie gespeichert,
// beim naechsten Poll nicht mehr geholt). fetchNewEmails() gibt daher pro Mail
// { uid, mail } zurueck, damit der Aufrufer weiss, welche UID er quittieren
// muss.
//
// Dieser Test mockt NUR die imapflow-Bibliothek (ImapFlow-Klasse); der echte
// Code aus fetchNewEmails() UND der echte parseRawEmail()-Pfad (inkl.
// mailparser) laufen durch. Es wird verifiziert:
//  - Die Suchanfrage schraenkt serverseitig bereits auf den Alias ein
//    (seen:false + or[to,cc] auf MAIL_ALIAS) - erste Datenschutz-Schicht.
//  - Liefert der (gemockte) Server eine UID, deren heruntergeladene Mail NICHT
//    tatsaechlich an den Alias geht (IMAP-TO/CC-SEARCH matcht laut RFC 3501 nur
//    als Substring, der Server kann also "false positives" liefern), wird sie
//    weder zurueckgegeben noch je als \Seen markiert - zweite Datenschutz-Schicht.
//  - Eine Mail, die tatsaechlich an den Alias geht, wird mitsamt ihrer UID
//    zurueckgegeben. fetchNewEmails() selbst markiert dabei NIE etwas als
//    \Seen (das ist jetzt Aufgabe von markEmailsSeen()).
//  - Lock und Verbindung werden IMMER freigegeben (lock.release(), logout()),
//    auch wenn beim Verarbeiten einer Mail ein Fehler auftritt.
//  - markEmailsSeen() markiert genau die uebergebenen UIDs als \Seen und baut
//    bei leerer Liste gar keine Verbindung auf.
//
// Keine echte Netzwerkverbindung wird aufgebaut.

const {
  connectMock,
  lockReleaseMock,
  getMailboxLockMock,
  searchMock,
  downloadMock,
  messageFlagsAddMock,
  logoutMock,
  listMock,
  constructorMock,
  FakeImapFlow,
} = vi.hoisted(() => {
  const connectMock = vi.fn().mockResolvedValue(undefined);
  const lockReleaseMock = vi.fn();
  const getMailboxLockMock = vi.fn().mockResolvedValue({ release: lockReleaseMock });
  const searchMock = vi.fn();
  const downloadMock = vi.fn();
  const messageFlagsAddMock = vi.fn().mockResolvedValue(undefined);
  const logoutMock = vi.fn().mockResolvedValue(undefined);
  // Standardmäßig existiert nur INBOX — reicht für alle Tests, die den
  // Default-Ordner verwenden. Tests für IMAP_MAILBOX auf einen eigenen Ordner
  // überschreiben das gezielt mit mockResolvedValueOnce().
  const listMock = vi.fn().mockResolvedValue([{ path: "INBOX" }]);
  const constructorMock = vi.fn();

  class FakeImapFlow {
    constructor(opts: unknown) {
      constructorMock(opts);
    }
    connect = connectMock;
    getMailboxLock = getMailboxLockMock;
    search = searchMock;
    download = downloadMock;
    messageFlagsAdd = messageFlagsAddMock;
    logout = logoutMock;
    list = listMock;
  }

  return {
    connectMock,
    lockReleaseMock,
    getMailboxLockMock,
    searchMock,
    downloadMock,
    messageFlagsAddMock,
    logoutMock,
    listMock,
    constructorMock,
    FakeImapFlow,
  };
});

vi.mock("imapflow", () => ({ ImapFlow: FakeImapFlow }));

import { fetchNewEmails, markEmailsSeen, ImapMailboxNotFoundError } from "@/channel/imap";

const ALIAS = "hausverwaltung@example.com";

// Echte RFC-822-Quelltexte, damit parseRawEmail() (mailparser) real mitlaeuft.
function rawEmail(opts: { messageId: string; to: string; subject: string; text: string }): Buffer {
  const src = [
    `Message-ID: <${opts.messageId}@example.com>`,
    `Date: Sat, 29 Aug 2026 10:15:00 +0200`,
    `From: Max Mustermann <max@example.com>`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    opts.text,
  ].join("\r\n");
  return Buffer.from(src, "utf8");
}

const matchingRaw = rawEmail({
  messageId: "matching-001",
  to: ALIAS,
  subject: "Türschloss klemmt",
  text: "Bitte kümmern Sie sich um das Türschloss.",
});

const nonMatchingRaw = rawEmail({
  messageId: "false-positive-002",
  to: "ganz.privat@example.com",
  subject: "Privates",
  text: "Das geht die Hausverwaltung nichts an.",
});

function downloadFor(raw: Buffer) {
  return { content: Readable.from([raw]) };
}

describe("fetchNewEmails (echte IMAP-Orchestrierung, imapflow gemockt)", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.MAIL_USER = "login@example.com";
    process.env.MAIL_PASSWORD = "app-passwort";
    process.env.MAIL_ALIAS = ALIAS;
    process.env.DASHBOARD_PASSWORD = "test";
    delete process.env.IMAP_MAILBOX;

    constructorMock.mockClear();
    connectMock.mockClear();
    lockReleaseMock.mockClear();
    getMailboxLockMock.mockClear();
    getMailboxLockMock.mockResolvedValue({ release: lockReleaseMock });
    searchMock.mockReset();
    downloadMock.mockReset();
    messageFlagsAddMock.mockClear();
    logoutMock.mockClear();
    listMock.mockClear();
    listMock.mockResolvedValue([{ path: "INBOX" }]);
  });

  it("sucht serverseitig bereits eingeschränkt (seen:false, or[to,cc]=MAIL_ALIAS)", async () => {
    searchMock.mockResolvedValue([]);

    await fetchNewEmails();

    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith(
      { seen: false, or: [{ to: ALIAS }, { cc: ALIAS }] },
      { uid: true },
    );
  });

  it("verwirft eine vom Server gelieferte Mail, die NICHT an den Alias geht: kein Ergebnis, kein \\Seen", async () => {
    searchMock.mockResolvedValue([2]);
    downloadMock.mockResolvedValue(downloadFor(nonMatchingRaw));

    const result = await fetchNewEmails();

    expect(result).toEqual([]);
    expect(messageFlagsAddMock).not.toHaveBeenCalled();
  });

  it("liefert eine tatsächlich an den Alias adressierte Mail zusammen mit ihrer UID zurück — OHNE sie als \\Seen zu markieren", async () => {
    searchMock.mockResolvedValue([1]);
    downloadMock.mockResolvedValue(downloadFor(matchingRaw));

    const result = await fetchNewEmails();

    expect(result).toHaveLength(1);
    expect(result[0]?.uid).toBe(1);
    expect(result[0]?.mail.subject).toBe("Türschloss klemmt");
    expect(result[0]?.mail.to).toEqual([ALIAS]);
    // fetchNewEmails markiert selbst NIE etwas als \Seen — das ist jetzt
    // Aufgabe des Aufrufers (erst nach erfolgreicher Persistierung).
    expect(messageFlagsAddMock).not.toHaveBeenCalled();
  });

  it("aus gemischten Treffern: nur die echte Alias-Mail kommt mit ihrer UID zurück, die falsch-positive Mail wird verworfen", async () => {
    searchMock.mockResolvedValue([1, 2]);
    downloadMock.mockImplementation(async (uid: string) => {
      if (uid === "1") return downloadFor(matchingRaw);
      if (uid === "2") return downloadFor(nonMatchingRaw);
      throw new Error(`unerwartete UID ${uid}`);
    });

    const result = await fetchNewEmails();

    expect(result).toHaveLength(1);
    expect(result[0]?.uid).toBe(1);
    expect(result[0]?.mail.subject).toBe("Türschloss klemmt");
    expect(messageFlagsAddMock).not.toHaveBeenCalled();
  });

  it("gibt Lock und Verbindung im Erfolgsfall frei (lock.release() und client.logout())", async () => {
    searchMock.mockResolvedValue([1]);
    downloadMock.mockResolvedValue(downloadFor(matchingRaw));

    await fetchNewEmails();

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(lockReleaseMock).toHaveBeenCalledTimes(1);
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it("gibt Lock und Verbindung AUCH bei einem Fehler beim Verarbeiten einer Mail frei", async () => {
    searchMock.mockResolvedValue([1, 2]);
    downloadMock.mockImplementation(async (uid: string) => {
      if (uid === "1") return downloadFor(matchingRaw);
      throw new Error("IMAP-Download kaputt");
    });

    await expect(fetchNewEmails()).rejects.toThrow("IMAP-Download kaputt");

    expect(lockReleaseMock).toHaveBeenCalledTimes(1);
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  // Review-Befund: connect() und getMailboxLock() standen AUSSERHALB des
  // try-Blocks, dessen finally client.logout() aufruft. Schlug der
  // Lock-Erwerb NACH erfolgreichem connect() fehl, blieb eine offene
  // IMAP-Sitzung zurück — bei einem Worker, der alle 30 Sekunden pollt,
  // summiert sich das (dieses System läuft auf dem privaten Postfach des
  // Nutzers). lock.release() darf dabei NICHT aufgerufen werden, weil der
  // Lock nie erworben wurde.
  it("schließt die Verbindung AUCH, wenn der Mailbox-Lock-Erwerb fehlschlägt (kein Leak nach erfolgreichem connect())", async () => {
    getMailboxLockMock.mockRejectedValueOnce(new Error("Mailbox-Lock nicht verfügbar"));

    await expect(fetchNewEmails()).rejects.toThrow("Mailbox-Lock nicht verfügbar");

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(lockReleaseMock).not.toHaveBeenCalled();
  });
});

describe("markEmailsSeen (quittiert Mails erst NACH erfolgreicher Persistierung durch den Aufrufer)", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.MAIL_USER = "login@example.com";
    process.env.MAIL_PASSWORD = "app-passwort";
    process.env.MAIL_ALIAS = ALIAS;
    process.env.DASHBOARD_PASSWORD = "test";
    delete process.env.IMAP_MAILBOX;

    constructorMock.mockClear();
    connectMock.mockClear();
    lockReleaseMock.mockClear();
    getMailboxLockMock.mockClear();
    getMailboxLockMock.mockResolvedValue({ release: lockReleaseMock });
    messageFlagsAddMock.mockClear();
    logoutMock.mockClear();
    listMock.mockClear();
    listMock.mockResolvedValue([{ path: "INBOX" }]);
  });

  it("markiert die übergebenen UIDs als \\Seen und gibt Lock/Verbindung frei", async () => {
    await markEmailsSeen([1, 2, 3]);

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(messageFlagsAddMock).toHaveBeenCalledTimes(1);
    expect(messageFlagsAddMock).toHaveBeenCalledWith([1, 2, 3], ["\\Seen"], { uid: true });
    expect(lockReleaseMock).toHaveBeenCalledTimes(1);
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it("baut bei leerer UID-Liste gar keine Verbindung auf", async () => {
    await markEmailsSeen([]);

    expect(constructorMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
    expect(messageFlagsAddMock).not.toHaveBeenCalled();
  });

  it("schließt die Verbindung AUCH, wenn der Mailbox-Lock-Erwerb fehlschlägt (kein Leak nach erfolgreichem connect())", async () => {
    getMailboxLockMock.mockRejectedValueOnce(new Error("Mailbox-Lock nicht verfügbar"));

    await expect(markEmailsSeen([1])).rejects.toThrow("Mailbox-Lock nicht verfügbar");

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(lockReleaseMock).not.toHaveBeenCalled();
  });
});

// Kern des Bugfixes: der Auftraggeber hat in seinem Fastmail-Konto eine Regel
// eingerichtet, die Mails an den Alias in einen EIGENEN Ordner ("Hausverwaltung
// TOOL FOM") sortiert, statt sie in der INBOX zu belassen — guter, datenschutz-
// freundlicher Stil (der Worker fasst die private Inbox dann gar nicht erst
// an). Der Worker durchsuchte aber fest verdrahtet nur "INBOX", fand dort
// nichts und lief scheinbar erfolgreich, aber leer. IMAP_MAILBOX macht den
// durchsuchten Ordner konfigurierbar; beide Funktionen (fetchNewEmails,
// markEmailsSeen) MÜSSEN denselben Ordner verwenden — quittiert markEmailsSeen
// im falschen Postfach, würden Mails endlos erneut geholt.
describe("IMAP_MAILBOX (konfigurierbarer Postfach-Ordner statt fest verdrahtetem INBOX)", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.MAIL_USER = "login@example.com";
    process.env.MAIL_PASSWORD = "app-passwort";
    process.env.MAIL_ALIAS = ALIAS;
    process.env.DASHBOARD_PASSWORD = "test";
    delete process.env.IMAP_MAILBOX;

    constructorMock.mockClear();
    connectMock.mockClear();
    lockReleaseMock.mockClear();
    getMailboxLockMock.mockClear();
    getMailboxLockMock.mockResolvedValue({ release: lockReleaseMock });
    searchMock.mockReset();
    searchMock.mockResolvedValue([]);
    downloadMock.mockReset();
    messageFlagsAddMock.mockClear();
    logoutMock.mockClear();
    listMock.mockClear();
    listMock.mockResolvedValue([{ path: "INBOX" }]);
  });

  afterEach(() => {
    delete process.env.IMAP_MAILBOX;
  });

  it("verwendet standardmäßig INBOX, wenn IMAP_MAILBOX nicht gesetzt ist (unverändertes Verhalten für bestehende Konfigurationen)", async () => {
    await fetchNewEmails();
    expect(getMailboxLockMock).toHaveBeenCalledWith("INBOX");

    getMailboxLockMock.mockClear();
    await markEmailsSeen([1]);
    expect(getMailboxLockMock).toHaveBeenCalledWith("INBOX");
  });

  it("verwendet einen konfigurierten Ordner (inkl. Trimmen von Leer­zeichen) in BEIDEN Funktionen", async () => {
    // Führendes/abschließendes Leerzeichen ist ein realistischer Fehler beim
    // Kopieren des Ordnernamens aus der Fastmail-Oberfläche in die .env.
    process.env.IMAP_MAILBOX = "  Hausverwaltung TOOL FOM  ";
    listMock.mockResolvedValue([{ path: "INBOX" }, { path: "Hausverwaltung TOOL FOM" }]);

    await fetchNewEmails();
    expect(getMailboxLockMock).toHaveBeenCalledWith("Hausverwaltung TOOL FOM");

    getMailboxLockMock.mockClear();
    await markEmailsSeen([1]);
    expect(getMailboxLockMock).toHaveBeenCalledWith("Hausverwaltung TOOL FOM");
  });

  it("wirft eine verständliche deutsche Fehlermeldung, wenn der konfigurierte Ordner nicht existiert — inkl. Liste der tatsächlich vorhandenen Ordner", async () => {
    process.env.IMAP_MAILBOX = "Nicht Vorhanden";
    // Steht stellvertretend für die technische IMAP-Meldung, die imapflow bei
    // einem SELECT auf einen nicht existierenden Ordner tatsächlich wirft.
    getMailboxLockMock.mockRejectedValue(
      new Error("NO [NONEXISTENT] Unknown Mailbox: Nicht Vorhanden"),
    );
    listMock.mockResolvedValue([{ path: "INBOX" }, { path: "Hausverwaltung TOOL FOM" }]);

    let caught: unknown;
    try {
      await fetchNewEmails();
      expect.unreachable("fetchNewEmails() hätte werfen müssen");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ImapMailboxNotFoundError);
    const message = (caught as Error).message;
    expect(message).toContain("Nicht Vorhanden");
    expect(message).toContain("IMAP_MAILBOX");
    expect(message).toContain("INBOX");
    expect(message).toContain("Hausverwaltung TOOL FOM");

    // Verbindung wird trotzdem sauber geschlossen; der (nie erworbene) Lock
    // wird nicht freigegeben — gleiche Absicherung wie bei jedem anderen
    // Lock-Fehlschlag.
    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(lockReleaseMock).not.toHaveBeenCalled();
  });

  it("lässt den ursprünglichen Fehler unverändert durch, wenn der konfigurierte Ordner tatsächlich existiert (Ursache liegt woanders, z. B. Netzwerk)", async () => {
    process.env.IMAP_MAILBOX = "Hausverwaltung TOOL FOM";
    listMock.mockResolvedValue([{ path: "INBOX" }, { path: "Hausverwaltung TOOL FOM" }]);
    getMailboxLockMock.mockRejectedValueOnce(new Error("Netzwerkfehler beim Öffnen"));

    await expect(fetchNewEmails()).rejects.toThrow("Netzwerkfehler beim Öffnen");
  });
});
