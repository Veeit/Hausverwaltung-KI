"use server";

import { revalidatePath } from "next/cache";
import { addDocument, deleteDocument } from "@/lib/documents";
import { requireAuth } from "@/app/actions/auth";

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

function isAllowedDocumentType(filename: string, mimeType: string): boolean {
  const dotIndex = filename.lastIndexOf(".");
  const extension = dotIndex === -1 ? "" : filename.slice(dotIndex).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) return false;
  if (GENERIC_MIME_TYPES.has(mimeType)) return true;
  return ALLOWED_MIME_TYPES.has(mimeType);
}

export async function uploadDocument(formData: FormData): Promise<void> {
  await requireAuth();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Bitte eine Datei auswählen.");
  }
  if (!isAllowedDocumentType(file.name, file.type)) {
    throw new Error(
      "Nicht unterstützter Dateityp. Erlaubt sind nur PDF, TXT und Markdown (.pdf, .txt, .md, .markdown).",
    );
  }
  const data = Buffer.from(await file.arrayBuffer());
  await addDocument(file.name, file.type || "application/octet-stream", data);
  revalidatePath("/dokumente");
}

export async function removeDocument(id: number): Promise<void> {
  await requireAuth();
  deleteDocument(id);
  revalidatePath("/dokumente");
}
