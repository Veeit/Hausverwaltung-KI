import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, getDb } from "@/db/client";
import { properties } from "@/db/schema";
import { getEnv } from "@/env";

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

// Nachstellung des Ersteinrichtungs-Fehlers (Befund 2): `npm run seed` und
// die Stammdaten-Ansichten im Dashboard brauchen ausschließlich
// DATABASE_PATH. getDb() darf deshalb NICHT die vollständige Mail-/
// Anthropic-Konfiguration verlangen — im Unterschied zu getEnv(), das für
// Worker/Agent weiterhin vollständig validieren muss.
describe("getDb() ohne vollständige Mail-Konfiguration", () => {
  // Alle von envSchema verwalteten Variablen außer DATABASE_PATH — werden
  // vor jedem Test entfernt, um den Zustand eines frischen `.env` mit nur
  // DATABASE_PATH gesetzt nachzustellen.
  const MAIL_AND_API_KEYS = [
    "ANTHROPIC_API_KEY",
    "IMAP_HOST",
    "IMAP_PORT",
    "SMTP_HOST",
    "SMTP_PORT",
    "MAIL_USER",
    "MAIL_PASSWORD",
    "MAIL_ALIAS",
    "DASHBOARD_PASSWORD",
    "MAIL_RATE_LIMIT_PER_HOUR",
    "ATTACHMENTS_DIR",
    "POLL_INTERVAL_MS",
    "LANDLORD_NAME",
  ];

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-getdb-test-"));
  const dbPath = path.join(dir, "getdb-test.db");
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv = {};
    for (const key of [...MAIL_AND_API_KEYS, "DATABASE_PATH"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.DATABASE_PATH = dbPath;
  });

  afterEach(() => {
    for (const key of [...MAIL_AND_API_KEYS, "DATABASE_PATH"]) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("erstellt die Datenbank allein mit DATABASE_PATH — kein Mail-/API-Key nötig", () => {
    expect(() => getDb()).not.toThrow();
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("Kontrollprobe: getEnv() wirft in derselben Situation weiterhin (Mail-Konfiguration fehlt)", () => {
    expect(() => getEnv()).toThrow();
  });
});
