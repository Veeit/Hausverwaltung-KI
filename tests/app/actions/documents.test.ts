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

  it("wirft eine deutsche Fehlermeldung, wenn keine Datei übergeben wurde", async () => {
    await expect(uploadDocument(new FormData())).rejects.toThrow(
      "Bitte eine Datei auswählen.",
    );
    expect(db.select().from(documents).all()).toHaveLength(0);
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
