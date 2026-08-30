"use server";

import { revalidatePath } from "next/cache";
import { addDocument, deleteDocument } from "@/lib/documents";
import { requireAuth } from "@/app/actions/auth";
import { OK, fail, type ActionResult } from "@/lib/actionResult";

// Nur Dateitypen zulassen, aus denen addDocument() sinnvollen Text extrahiert
// (PDF via pdf-parse, alles andere über data.toString("utf8")). Ohne diese
// Prüfung landet der Rohinhalt beliebiger Binärdateien (Bilder, ZIPs, ...) im
// FTS5-Volltextindex, den der KI-Agent als Faktenquelle durchsucht — im
// Review nachgewiesen anhand einer hochgeladenen PNG, die per "JFIF" auffindbar
// wurde.
//
// Prüfung über BEIDES, Dateiendung UND MIME-Typ, weil keins der beiden
// Signale allein zuverlässig ist:
// - Der MIME-Typ kommt unverändert vom Browser (file.type) und ist für
//   Markdown-Dateien je nach Betriebssystem/Browser oft leer oder generisch
//   "application/octet-stream" — ein Verlass allein auf den MIME-Typ würde
//   also viele legitime .md-Uploads ablehnen.
// - Die Endung allein erkennt keine Fehlbenennung: Browser ermitteln
//   file.type in der Regel über den tatsächlichen Dateiinhalt bzw. die
//   Systemregistrierung, nicht nur über die Endung im Dateinamen — eine als
//   "hausordnung.txt" umbenannte PNG wird von den meisten Browsern trotzdem
//   mit type "image/png" gemeldet.
//
// Deshalb: Die Endung MUSS zur Allowlist passen; ist zusätzlich ein
// spezifischer (nicht leerer/generischer) MIME-Typ gesetzt, muss auch dieser
// zur Allowlist passen. So werden sowohl falsche Endungen als auch
// Falschbenennungen mit erkennbar fremdem MIME-Typ abgelehnt, während leere
// oder generische MIME-Typen (wie bei .md häufig) nicht fälschlich blockieren.
const ALLOWED_EXTENSIONS = [".pdf", ".txt", ".md", ".markdown"];
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
]);
const GENERIC_MIME_TYPES = new Set(["", "application/octet-stream"]);

// Next.js' Server-Action-Grenze (next.config.ts: bodySizeLimit) liegt bewusst
// höher als dieses Limit: Eine Datei darüber soll an DIESER Prüfung mit einer
// verständlichen deutschen Meldung scheitern, nicht als rohe englische
// Framework-Fehlermeldung an der harten Obergrenze. 8 MB genügt für die hier
// erwarteten Dokumenttypen (Hausordnung, Mietvertrag, FAQ als PDF/TXT/MD) mit
// deutlichem Spielraum.
const MAX_DOCUMENT_SIZE_BYTES = 8 * 1024 * 1024;

function isAllowedDocumentType(filename: string, mimeType: string): boolean {
  const dotIndex = filename.lastIndexOf(".");
  const extension = dotIndex === -1 ? "" : filename.slice(dotIndex).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) return false;
  if (GENERIC_MIME_TYPES.has(mimeType)) return true;
  return ALLOWED_MIME_TYPES.has(mimeType);
}

export async function uploadDocument(formData: FormData): Promise<ActionResult> {
  await requireAuth();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return fail("Bitte eine Datei auswählen.");
  }
  if (!isAllowedDocumentType(file.name, file.type)) {
    return fail(
      "Nicht unterstützter Dateityp. Erlaubt sind nur PDF, TXT und Markdown (.pdf, .txt, .md, .markdown).",
    );
  }
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    const maxMb = (MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024)).toFixed(0);
    const fileMb = (file.size / (1024 * 1024)).toFixed(1);
    return fail(`Datei zu groß (${fileMb} MB). Erlaubt sind maximal ${maxMb} MB.`);
  }
  const data = Buffer.from(await file.arrayBuffer());
  await addDocument(file.name, file.type || "application/octet-stream", data);
  revalidatePath("/dokumente");
  return OK;
}

export async function removeDocument(id: number): Promise<ActionResult> {
  await requireAuth();
  deleteDocument(id);
  revalidatePath("/dokumente");
  return OK;
}
