import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setDbForTesting, type AppDb } from "@/db/client";
import { documents } from "@/db/schema";
import { sha256Hex } from "@/lib/auth";
import { listDocuments, searchDocuments } from "@/lib/documents";
import { makeTestDb } from "../../helpers/db";
import { setAuthCookieValue } from "../../helpers/nextMocks";
import { removeDocument, uploadDocument } from "@/app/actions/documents";

// Action-Test-Muster aus Task 12: vi.mock wird gehoisted, deshalb stehen die
// drei Next.js-Mocks explizit in dieser Datei (siehe tests/helpers/nextMocks.ts).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async () => {
  const { redirectStub } = await import("../../helpers/nextMocks");
  return { redirect: vi.fn(redirectStub) };
});
vi.mock("next/headers", async () => {
  const { cookiesStub } = await import("../../helpers/nextMocks");
  return { cookies: vi.fn(async () => cookiesStub()) };
});

let db: AppDb;

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = "test";
  process.env.MAIL_USER = "test";
  process.env.MAIL_PASSWORD = "test";
  process.env.MAIL_ALIAS = "hausverwaltung@example.com";
  process.env.DASHBOARD_PASSWORD = "test-passwort";
  setAuthCookieValue(await sha256Hex("test-passwort"));
});

beforeEach(() => {
  db = makeTestDb();
});

afterEach(() => {
  setDbForTesting(null);
});

function uploadFormData(filename: string, text: string): FormData {
  const file = new File([Buffer.from(text, "utf8")], filename, {
    type: "text/plain",
  });
  const formData = new FormData();
  formData.set("file", file);
  return formData;
}

describe("uploadDocument", () => {
  it("legt eine Document-Row an und indiziert den Inhalt für die Volltextsuche", async () => {
    const text =
      "Hausordnung: Die Waschküche darf werktags von 8 bis 20 Uhr genutzt werden.";

    await uploadDocument(uploadFormData("haus.txt", text));

    const row = db.select().from(documents).all()[0];
    expect(row).toBeDefined();
    expect(row.filename).toBe("haus.txt");
    expect(row.mimeType).toBe("text/plain");
    expect(row.content).toContain("Waschküche");

    const hits = searchDocuments("Waschküche");
    expect(hits).toHaveLength(1);
    expect(hits[0].documentId).toBe(row.id);
    expect(hits[0].filename).toBe("haus.txt");
  });

  it("liefert eine deutsche Fehlermeldung als Rückgabewert, wenn keine Datei übergeben wurde", async () => {
    const result = await uploadDocument(new FormData());

    expect(result.error).toContain("Bitte eine Datei auswählen.");
    expect(db.select().from(documents).all()).toHaveLength(0);
  });

  it("akzeptiert eine Markdown-Datei (.md)", async () => {
    const text = "# Hausordnung\n\nRuhezeiten gelten werktags ab 22 Uhr.";
    const file = new File([Buffer.from(text, "utf8")], "hausordnung.md", {
      type: "text/markdown",
    });
    const formData = new FormData();
    formData.set("file", file);

    await uploadDocument(formData);

    const row = db.select().from(documents).all()[0];
    expect(row).toBeDefined();
    expect(row.filename).toBe("hausordnung.md");
    expect(row.mimeType).toBe("text/markdown");
    expect(row.content).toContain("Ruhezeiten");
  });

  // Haertungsluecke aus dem Review: Ein versehentlich hochgeladenes Bild landete
  // vor diesem Fix per data.toString("utf8") als Binaermuell im FTS5-Index, den
  // der KI-Agent als Faktenquelle durchsucht (Nachweis: Suche nach "JFIF" fand
  // einen Treffer). uploadDocument muss solche Dateitypen ablehnen, BEVOR sie
  // addDocument()/dem Index erreichen.
  it("lehnt einen nicht unterstützten Dateityp (PNG) mit einer deutschen Fehlermeldung als Rückgabewert ab und indiziert nichts", async () => {
    const pngBytes = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    ]); // JFIF-Signatur
    const file = new File([pngBytes], "urlaubsfoto.png", { type: "image/png" });
    const formData = new FormData();
    formData.set("file", file);

    const result = await uploadDocument(formData);

    expect(result.error).toMatch(/PDF.*TXT.*Markdown|Nicht unterstützter Dateityp/);
    expect(db.select().from(documents).all()).toHaveLength(0);
    expect(searchDocuments("JFIF")).toEqual([]);
  });

  // Review-Befund: Next.js' Standardlimit für Server Actions liegt bei 1 MB,
  // next.config.ts hebt es projektweit an; uploadDocument prüft zusätzlich
  // selbst mit einer eigenen, deutschen Meldung, damit ein zu großer Upload
  // nicht an der harten Framework-Grenze mit einer rohen, englischen
  // Fehlermeldung scheitert.
  it("lehnt eine Datei über dem Größenlimit mit einer deutschen Meldung als Rückgabewert ab", async () => {
    const oversized = Buffer.alloc(8 * 1024 * 1024 + 1, "a");
    const file = new File([oversized], "riesige-hausordnung.txt", { type: "text/plain" });
    const formData = new FormData();
    formData.set("file", file);

    const result = await uploadDocument(formData);

    expect(result.error).toMatch(/zu groß/);
    expect(db.select().from(documents).all()).toHaveLength(0);
  });

  it("akzeptiert eine Datei knapp unterhalb des Größenlimits", async () => {
    const nearLimit = Buffer.alloc(8 * 1024 * 1024 - 1, "a");
    const file = new File([nearLimit], "grosse-hausordnung.txt", { type: "text/plain" });
    const formData = new FormData();
    formData.set("file", file);

    const result = await uploadDocument(formData);

    expect(result.error).toBeNull();
    expect(db.select().from(documents).all()).toHaveLength(1);
  });
});

describe("removeDocument", () => {
  it("löscht Dokument und FTS-Eintrag", async () => {
    await uploadFormDataAndStore();

    const id = db.select().from(documents).all()[0].id;
    await removeDocument(id);

    expect(listDocuments()).toHaveLength(0);
    expect(searchDocuments("Kleintiere")).toHaveLength(0);
  });
});

async function uploadFormDataAndStore(): Promise<void> {
  await uploadDocument(
    uploadFormData("vertrag.txt", "Mietvertrag: Kleintiere sind erlaubt."),
  );
}
