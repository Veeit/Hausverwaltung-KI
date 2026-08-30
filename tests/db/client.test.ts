import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import { properties } from "@/db/schema";

describe("createDb mit Dateipfad", () => {
  it("legt das Verzeichnis rekursiv an und initialisiert eine nutzbare DB-Datei", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-db-test-"));
    const dbPath = path.join(dir, "nested", "test.db");

    const db = createDb(dbPath);
    db.insert(properties).values({ address: "Teststraße 1, 20095 Hamburg" }).run();

    expect(fs.existsSync(dbPath)).toBe(true);
    expect(db.select().from(properties).all()).toHaveLength(1);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
