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
});
