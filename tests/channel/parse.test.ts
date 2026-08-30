import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRawEmail } from "@/channel/parse";

function fixture(name: string): Buffer {
  return readFileSync(join(process.cwd(), "tests", "fixtures", name));
}

describe("parseRawEmail", () => {
  it("parst eine einfache text/plain-Mail: Felder korrekt, Adressen lowercase, Umlaute dekodiert", async () => {
    const mail = await parseRawEmail(fixture("simple.eml"));

    expect(mail.messageId).toBe("<test-simple-001@example.com>");
    expect(mail.from).toBe("max.mustermann@example.com");
    expect(mail.to).toEqual(["hausverwaltung@example.com"]);
    expect(mail.subject).toBe("Türschloss defekt");
    expect(mail.text).toContain("Türschloss klemmt seit gestern stark");
    expect(mail.text).toContain("Grüßen");
    expect(mail.date).toBeInstanceOf(Date);
    expect(mail.attachments).toEqual([]);
  });

  it("parst eine multipart-Mail: Anhang dekodiert, Cc-Adressen lowercase mit in to[]", async () => {
    const mail = await parseRawEmail(fixture("mit-anhang.eml"));

    expect(mail.from).toBe("erika.beispiel@example.com");
    expect(mail.to).toEqual(["hausverwaltung@example.com", "zweite.adresse@example.com"]);
    expect(mail.subject).toBe("Foto vom Wasserschaden");
    expect(mail.text).toContain("Notiz zum Wasserschaden");
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0]?.filename).toBe("notiz.txt");
    expect(mail.attachments[0]?.mimeType).toBe("text/plain");
    expect(mail.attachments[0]?.content.toString("utf8")).toBe("Wasserschaden im Bad");
  });

  it("generiert eine Message-ID, wenn keine vorhanden, und strippt HTML-only-Bodies zu Text", async () => {
    const htmlOnlyRaw = [
      "From: unbekannt@example.com",
      "To: hausverwaltung@example.com",
      "Subject: Frage zur Nebenkostenabrechnung",
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<html><body><p>Guten Tag,</p><p>ich habe eine <b>Frage</b> zur Abrechnung.</p></body></html>",
    ].join("\r\n");

    const mail = await parseRawEmail(Buffer.from(htmlOnlyRaw, "utf8"));

    expect(mail.messageId).toMatch(/^generated-/);
    expect(mail.subject).toBe("Frage zur Nebenkostenabrechnung");
    expect(mail.text).toContain("Frage");
    expect(mail.text).toContain("Abrechnung");
    expect(mail.text).not.toContain("<p>");
    expect(mail.text).not.toContain("<b>");
  });

  // Review-Befund: Ein reiner Zufallswert als Ersatz-Message-ID wäre bei
  // jedem erneuten Parsen derselben Rohmail unterschiedlich — die
  // Dedupe-Prüfung über imapMessageId (ingestEmail) könnte dann nicht
  // greifen, und ein Mieter bekäme zwei KI-Antworten, wenn das Quittieren
  // im Postfach einmal scheitert (die Mail wird beim nächsten Poll aus
  // denselben Rohbytes erneut geparst).
  it("erzeugt für dieselbe Mail ohne Message-ID bei wiederholtem Parsen dieselbe Ersatz-Id (stabile Dedupe-Grundlage)", async () => {
    const raw = [
      "From: unbekannt@example.com",
      "To: hausverwaltung@example.com",
      "Subject: Frage zur Nebenkostenabrechnung",
      "Date: Mon, 1 Sep 2025 10:00:00 +0000",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Guten Tag, ich habe eine Frage zur Abrechnung.",
    ].join("\r\n");

    const first = await parseRawEmail(Buffer.from(raw, "utf8"));
    const second = await parseRawEmail(Buffer.from(raw, "utf8"));

    expect(first.messageId).toBe(second.messageId);
    expect(first.messageId).toMatch(/^generated-/);
  });

  // Restbefund Punkt 5: Fehlen SOWOHL Message-ID ALS AUCH Date-Header, floss
  // vor dem Fix new Date() (der Zeitpunkt des Parse-Aufrufs) in den Hash ein
  // — der wäre bei jedem erneuten Parsen derselben Rohbytes anders und hätte
  // die Dedupe-Prüfung über imapMessageId (ingestEmail) genau in dem Moment
  // versagen lassen, für den die stabile Ersatz-Id eigentlich gebaut wurde:
  // Scheitert das Quittieren einer Mail im Postfach einmal, wird sie beim
  // nächsten Poll aus denselben Rohbytes erneut geparst (siehe pollOnce).
  it("erzeugt für dieselbe Mail OHNE Message-ID UND OHNE Date-Header bei wiederholtem Parsen dieselbe Ersatz-Id (stabile Dedupe-Grundlage)", async () => {
    const raw = [
      "From: unbekannt@example.com",
      "To: hausverwaltung@example.com",
      "Subject: Frage zur Nebenkostenabrechnung",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Guten Tag, ich habe eine Frage zur Abrechnung.",
    ].join("\r\n");

    const first = await parseRawEmail(Buffer.from(raw, "utf8"));
    const second = await parseRawEmail(Buffer.from(raw, "utf8"));

    expect(first.messageId).toMatch(/^generated-/);
    expect(first.messageId).toBe(second.messageId);
  });

  it("erzeugt für unterschiedliche Mails ohne Message-ID unterschiedliche Ersatz-Ids", async () => {
    const rawBase = (subject: string) =>
      [
        "From: unbekannt@example.com",
        "To: hausverwaltung@example.com",
        `Subject: ${subject}`,
        "Date: Mon, 1 Sep 2025 10:00:00 +0000",
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Guten Tag, ich habe eine Frage zur Abrechnung.",
      ].join("\r\n");

    const first = await parseRawEmail(Buffer.from(rawBase("Frage A"), "utf8"));
    const second = await parseRawEmail(Buffer.from(rawBase("Frage B"), "utf8"));

    expect(first.messageId).not.toBe(second.messageId);
  });
});
