import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { getDbEnv } from "@/env";
import { DDL_SQL } from "./ddl";
import * as schema from "./schema";

export type AppDb = BetterSQLite3Database<typeof schema>;

let singleton: AppDb | null = null;
let testOverride: AppDb | null = null;

export function createDb(dbPath: string): AppDb {
  const isFileDb = dbPath !== ":memory:";
  if (isFileDb) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  if (isFileDb) {
    sqlite.pragma("journal_mode = WAL");
  }
  sqlite.exec(DDL_SQL);
  return drizzle(sqlite, { schema });
}

export function getDb(): AppDb {
  if (testOverride) {
    return testOverride;
  }
  if (!singleton) {
    // Bewusst getDbEnv() statt getEnv(): reiner Datenbankzugriff (z.B.
    // `npm run seed` oder die Stammdaten-Ansichten im Dashboard) darf nicht
    // an einer noch unvollständigen Mail-/Anthropic-Konfiguration scheitern.
    singleton = createDb(getDbEnv().DATABASE_PATH);
  }
  return singleton;
}

export function setDbForTesting(db: AppDb | null): void {
  testOverride = db;
}
