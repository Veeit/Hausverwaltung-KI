import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDbForTesting } from "@/db/client";
import {
  addDocument,
  deleteDocument,
  listDocuments,
  searchDocuments,
} from "@/lib/documents";
import { makeTestDb } from "../helpers/db";

describe("lib/documents", () => {
  beforeEach(() => {
    makeTestDb();
  });

  afterEach(() => {
    setDbForTesting(null);
  });

  it("addDocument speichert eine txt-Datei als utf8, listDocuments liefert sie zurück (Roundtrip)", async () => {
    const id = await addDocument(
      "hausordnung.txt",
      "text/plain",
      Buffer.from("Ruhezeiten gelten werktags ab 22 Uhr.", "utf8"),
    );

    expect(id).toBeGreaterThan(0);
    const docs = listDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe(id);
    expect(docs[0].filename).toBe("hausordnung.txt");
    expect(docs[0].mimeType).toBe("text/plain");
    expect(docs[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("listDocuments liefert contentLength (Zeichenlänge des extrahierten Texts)", async () => {
    await addDocument("kurz.txt", "text/plain", Buffer.from("Hallo Welt", "utf8"));

    const docs = listDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0].contentLength).toBe(10);
  });

  it("searchDocuments findet ein Wort mit Umlaut", async () => {
    const id = await addDocument(
      "hausordnung.md",
      "text/markdown",
      Buffer.from(
        "# Hausordnung\n\nBei Lärm nach 22 Uhr bitte die Hausverwaltung informieren.",
        "utf8",
      ),
    );

    const hits = searchDocuments("Lärm");
    expect(hits).toHaveLength(1);
    expect(hits[0].documentId).toBe(id);
    expect(hits[0].filename).toBe("hausordnung.md");
  });

  it('Präfix-Suche: "Schlü" findet "Schlüssel" (wegen "wort"*-Quoting)', async () => {
    const id = await addDocument(
      "mietvertrag.txt",
      "text/plain",
      Buffer.from(
        "Der Mieter erhält bei Einzug zwei Schlüssel für die Wohnungstür.",
        "utf8",
      ),
    );

    const hits = searchDocuments("Schlü");
    expect(hits).toHaveLength(1);
    expect(hits[0].documentId).toBe(id);
  });

  it("Snippet enthält <b>-Marker um die Fundstelle", async () => {
    await addDocument(
      "hausordnung.txt",
      "text/plain",
      Buffer.from(
        "Bei anhaltendem Lärm in der Nachtzeit ist die Hausverwaltung zu informieren.",
        "utf8",
      ),
    );

    const hits = searchDocuments("Lärm");
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toContain("<b>");
    expect(hits[0].snippet).toContain("</b>");
  });

  it("kein Treffer → leeres Array", async () => {
    await addDocument(
      "hausordnung.txt",
      "text/plain",
      Buffer.from("Ruhezeiten gelten werktags ab 22 Uhr.", "utf8"),
    );

    expect(searchDocuments("Quantenphysik")).toEqual([]);
  });

  it("leere Query → leeres Array", async () => {
    await addDocument(
      "hausordnung.txt",
      "text/plain",
      Buffer.from("Ruhezeiten gelten werktags ab 22 Uhr.", "utf8"),
    );

    expect(searchDocuments("")).toEqual([]);
    expect(searchDocuments("   ")).toEqual([]);
    // nur FTS-Sonderzeichen, nach dem Splitten bleibt kein Wort übrig:
    expect(searchDocuments('()-"')).toEqual([]);
  });

  it("FTS-Sonderzeichen in der Query crashen nicht (Sanitisierung)", async () => {
    const id = await addDocument(
      "hausordnung.txt",
      "text/plain",
      Buffer.from(
        "Bei Lärm nach 22 Uhr bitte die Hausverwaltung informieren.",
        "utf8",
      ),
    );

    // Rohe FTS5-Syntax wäre hier ungültig — darf nicht werfen:
    expect(() => searchDocuments('"lärm" OR (')).not.toThrow();
    expect(() => searchDocuments("-lärm AND (klammer")).not.toThrow();
    // Das enthaltene echte Wort wird trotzdem gefunden:
    const hits = searchDocuments('"lärm" OR (');
    expect(hits.map((h) => h.documentId)).toContain(id);
  });

  // Haertungsluecke: Alle bisherigen Tests hier nutzen .txt/.md - der
  // isPdf()-Zweig von addDocument() (pdf-parse) wurde nie erreicht, obwohl
  // Mietvertraege/Hausordnungen in der Praxis PDFs sind und pdf-parse
  // nachweislich fragil ist (kaputter Top-Level-Import, siehe Kommentar in
  // src/lib/documents.ts).
  //
  // Das Fixture tests/fixtures/mini-vertrag.pdf ist ein von Hand geschriebenes
  // minimales PDF (Katalog/Pages/Page/Font/Contents-Objekte + korrekte
  // xref-Tabelle, ein BT/Tj/ET-Textblock als Inhalt). Es ist absichtlich >4 KB
  // gross (Fuellmasse als PDF-Kommentarzeile direkt nach dem %PDF-Header,
  // die vom Parser ignoriert wird): pdf-parse@1.1.4 buendelt eine alte
  // pdf.js-Version (v1.10.100), deren interne Worker-Transport-Simulation den
  // Buffer nochmals kopiert. Fuer Buffer < 4096 Byte landet diese interne
  // Kopie an einem Offset != 0 in Node's gemeinsamem Buffer-Pool, und ein
  // Bug in pdf.js' Stream.makeSubStream (nutzt this.bytes.buffer statt den
  // byteOffset des Uint8Array zu beruecksichtigen) liest die xref-Tabelle
  // dann an falscher Position -> "bad XRef entry", reproduzierbar mit einem
  // kleinen handgeschriebenen PDF. Das laesst sich NICHT durch Normalisieren
  // des eigenen Eingabe-Buffers beheben (z.B. Buffer.allocUnsafeSlow), weil
  // die fehlerhafte Kopie erst innerhalb von pdf-parse/pdf.js entsteht -
  // ausserhalb unserer Kontrolle. Ist die Datei > 4096 Byte, erzwingt Node
  // fuer JEDE interne Kopie eine eigene, nicht gepoolte Allocation, wodurch
  // der Offset garantiert 0 ist. Das Fixture wurde daher NICHT als winziges
  // Handschrift-PDF committet, sondern absichtlich mit dieser Fuellmasse auf
  // ca. 4,8 KB aufgeblasen - deterministisch reproduzierbar, unabhaengig vom
  // Allocation-Zustand des Test-Prozesses (mit dem echten, ungemockten
  // pdf-parse mehrfach gegengeprueft, siehe Haertung-Report).
  it("addDocument extrahiert Text aus einem echten PDF (pdf-parse-Zweig), Text ist über searchDocuments auffindbar", async () => {
    const pdfBuffer = readFileSync(join(process.cwd(), "tests", "fixtures", "mini-vertrag.pdf"));

    const id = await addDocument("mietvertrag.pdf", "application/pdf", pdfBuffer);

    expect(id).toBeGreaterThan(0);
    const docs = listDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0].filename).toBe("mietvertrag.pdf");
    expect(docs[0].mimeType).toBe("application/pdf");
    // Die Rohdatei ist ~4,8 KB gross (siehe Kommentar oben zur Fuellmasse) und
    // enthaelt den Text unkomprimiert auch im PDF-Content-Stream selbst -
    // ein Bug, der isPdf() umgeht und stattdessen ungefiltert data.toString()
    // aufruft, wuerde also TROTZDEM einen Treffer in searchDocuments liefern.
    // Die Längenprüfung stellt sicher, dass tatsächlich der schlanke,
    // von pdf-parse extrahierte Text (~40 Zeichen) gespeichert wurde und
    // nicht die komplette Rohdatei samt PDF-Syntax (xref-Tabelle, %PDF-Header
    // etc.):
    expect(docs[0].contentLength).toBeGreaterThan(0);
    expect(docs[0].contentLength).toBeLessThan(200);

    const hits = searchDocuments("Kuendigungsfrist");
    expect(hits).toHaveLength(1);
    expect(hits[0].documentId).toBe(id);
    expect(hits[0].filename).toBe("mietvertrag.pdf");
  });

  it("deleteDocument entfernt Dokument UND FTS-Eintrag", async () => {
    const id = await addDocument(
      "hausordnung.txt",
      "text/plain",
      Buffer.from(
        "Bei Lärm nach 22 Uhr bitte die Hausverwaltung informieren.",
        "utf8",
      ),
    );
    expect(searchDocuments("Lärm")).toHaveLength(1);

    deleteDocument(id);

    expect(listDocuments()).toEqual([]);
    expect(searchDocuments("Lärm")).toEqual([]);
  });
});
