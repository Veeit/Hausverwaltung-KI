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

export async function addDocument(
  filename: string,
  mimeType: string,
  data: Buffer,
): Promise<number> {
  let content: string;
  if (isPdf(filename, mimeType)) {
    const parsed = (await pdfParse(data)) as { text: string };
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
