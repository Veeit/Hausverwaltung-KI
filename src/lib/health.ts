import { accessSync, constants } from "node:fs";
import path from "node:path";

/** Fallback, wenn DATABASE_PATH nicht gesetzt ist (identisch zu .env.example). */
export const DEFAULT_DATABASE_PATH = "./data/hausverwaltung.db";

export type HealthStatus =
  | { status: "ok"; worker: "enabled" | "disabled" }
  | { status: "error"; error: string };

/**
 * Prüft, ob der Container arbeitsfähig ist. Entscheidend ist das Verzeichnis
 * der SQLite-Datei: Auf Unraid gehört /mnt/user/appdata dem Benutzer 99:100,
 * und ein falscher Container-Benutzer scheitert genau hier.
 */
export function getHealthStatus(env: NodeJS.ProcessEnv = process.env): HealthStatus {
  const databasePath = env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
  const dataDir = path.dirname(databasePath);

  try {
    accessSync(dataDir, constants.W_OK);
  } catch {
    return {
      status: "error",
      error: `Datenverzeichnis ${dataDir} fehlt oder ist nicht beschreibbar`,
    };
  }

  return { status: "ok", worker: env.RUN_WORKER === "0" ? "disabled" : "enabled" };
}
