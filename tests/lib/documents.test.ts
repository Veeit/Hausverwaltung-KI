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
