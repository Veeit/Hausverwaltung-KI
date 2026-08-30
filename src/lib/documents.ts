import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { documents } from "@/db/schema";
// WICHTIG: pdf-parse NIEMALS über den Top-Level-Import ("pdf-parse") laden —
// der ist kaputt: dessen index.js führt beim Import Debug-Code aus, der eine
// Testdatei ('./test/data/05-versions-space.pdf') sucht und crasht. Deshalb
// der direkte Subpfad-Import der eigentlichen Parser-Funktion:
// @ts-expect-error -- pdf-parse liefert keine Typdefinitionen mit
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export interface DocumentHit {
  documentId: number;
  filename: string;
  snippet: string;
}

function isPdf(filename: string, mimeType: string): boolean {
  return (
    mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf")
  );
}

// Node kopiert Buffer < 4096 Byte (Buffer.poolSize >>> 1) aus einem
// gemeinsamen, wiederverwendeten Pool-ArrayBuffer; ab dieser Groesse
// erzwingt Node fuer JEDE Kopie eine eigene, dedizierte Allokation.
const PDF_PARSE_POOL_THRESHOLD = 4096;

// WICHTIG: Bibliotheksfehler in pdf-parse (buendelt pdf.js v1.10.100) —
// Stream.makeSubStream() in pdf.worker.js nutzt this.bytes.buffer (den
// rohen, potenziell gepoolten ArrayBuffer), addiert dabei aber NICHT den
// byteOffset des Uint8Array. pdf.js kopiert unseren Eingabe-Buffer zudem
// intern nochmal (LoopbackPort-Simulation des Web-Workers via
// postMessage/cloneValue) — diese interne Kopie ist selbst wieder ein
// gepoolter Node-Buffer, sobald ihre Groesse < 4096 Byte ist, mit einem vom
// Allokationszustand des Prozesses abhaengigen (also nicht deterministischen)
// byteOffset != 0. Ergebnis: "bad XRef entry" bereits beim ersten Objekt,
// reproduzierbar bei praktisch jedem PDF < 4 KB — also genau den kurzen
// Dokumenten (Hausordnung, FAQ, einzelne Vertragsklauseln), die hier die
// Norm sind. Wichtig: Der byteOffset UNSERES Eingabe-Buffers spielt dabei
// keine Rolle — auch ein per Buffer.allocUnsafeSlow bereits auf byteOffset 0
// normalisierter Buffer loest den Fehler weiterhin aus (empirisch
// verifiziert, siehe tests/lib/documents.test.ts), weil die fehlerhafte
// Kopie ausschliesslich INNERHALB von pdf-parse/pdf.js entsteht und nur von
// deren eigener (durch unsere Buffer-GROESSE bestimmter) Allokation abhaengt.
// Einzig wirksame Abhilfe: den an pdf-parse uebergebenen Buffer auf
// mindestens 4096 Byte auffuellen, damit auch die interne Kopie garantiert
// nicht gepoolt wird (byteOffset garantiert 0). Die Fuellmasse wird HINTER
// das Dateiende (nach %%EOF) angehaengt: pdf.js sucht "startxref" rueckwaerts
// durch die GESAMTE Datei, zusaetzliche Bytes danach werden nie referenziert
// und veraendern keinen der im xref gespeicherten absoluten Byte-Offsets.
// Buffer.allocUnsafeSlow liefert dafuer eine garantiert pool-freie, dedizierte
// Allokation (siehe Node-Doku); der Rest wird explizit gefuellt, damit kein
// uninitialisierter Prozessspeicher an pdf-parse durchgereicht wird.
function ensurePdfParseSafeBuffer(data: Buffer): Buffer {
  if (data.length >= PDF_PARSE_POOL_THRESHOLD) {
    return data;
  }
  const padded = Buffer.allocUnsafeSlow(PDF_PARSE_POOL_THRESHOLD);
  data.copy(padded);
  padded.fill(0x20, data.length);
  return padded;
}

export async function addDocument(
  filename: string,
  mimeType: string,
  data: Buffer,
): Promise<number> {
  let content: string;
  if (isPdf(filename, mimeType)) {
    const parsed = (await pdfParse(ensurePdfParseSafeBuffer(data))) as {
      text: string;
    };
    content = parsed.text;
  } else {
    content = data.toString("utf8");
  }

  const db = getDb();
  const result = db.insert(documents).values({ filename, mimeType, content }).run();
  const id = Number(result.lastInsertRowid);
  // FTS5-Sync manuell (kein Trigger, siehe db/ddl.ts):
  db.run(
    sql`INSERT INTO documents_fts (rowid, content, document_id) VALUES (${id}, ${content}, ${id})`,
  );
  return id;
}

export function deleteDocument(id: number): void {
  const db = getDb();
  db.run(sql`DELETE FROM documents_fts WHERE document_id = ${id}`);
  db.delete(documents).where(eq(documents.id, id)).run();
}

export function listDocuments(): Array<{
  id: number;
  filename: string;
  mimeType: string;
  createdAt: string;
  contentLength: number;
}> {
  const db = getDb();
  const rows = db.select().from(documents).all();
  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    createdAt: row.createdAt,
    contentLength: row.content.length,
  }));
}

export function searchDocuments(query: string, limit = 5): DocumentHit[] {
  // Sanitisierung: in Wörter splitten (alles außer Buchstaben/Ziffern trennt),
  // leere Teile verwerfen. Nach dem Split können keine FTS5-Syntaxzeichen
  // (-, Klammern, Anführungszeichen, OR/AND/NEAR als Operatoren) mehr wirken,
  // weil jedes Wort unten als "wort"* gequotet wird (macht zugleich Präfix-Suche).
  const words = query.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);
  if (words.length === 0) {
    return [];
  }
  const ftsQuery = words.map((word) => `"${word}"*`).join(" OR ");

  const db = getDb();
  return db.all<DocumentHit>(sql`
    SELECT
      d.id AS documentId,
      d.filename AS filename,
      snippet(documents_fts, 0, '<b>', '</b>', '…', 12) AS snippet
    FROM documents_fts
    JOIN documents AS d ON d.id = documents_fts.document_id
    WHERE documents_fts MATCH ${ftsQuery}
    ORDER BY rank
    LIMIT ${limit}
  `);
}
