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
/** Nur die beiden gelesenen Schluessel werden gebraucht - `process.env` erfuellt
 * diesen Typ, Testobjekte ebenso. `NodeJS.ProcessEnv` waere unnoetig eng. */
type EnvLike = Record<string, string | undefined>;

export function getHealthStatus(env: EnvLike = process.env): HealthStatus {
  const databasePath = env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
  const dataDir = path.dirname(databasePath);

  try {
    accessSync(dataDir, constants.W_OK);
  } catch (err) {
    // ENOENT = Verzeichnis fehlt, EACCES/EPERM = Verzeichnis existiert, aber
    // ist nicht beschreibbar (z. B. falscher Container-Benutzer auf Unraid).
    const code = (err as NodeJS.ErrnoException).code;
    const error =
      code === "ENOENT"
        ? `Datenverzeichnis ${dataDir} existiert nicht`
        : `Datenverzeichnis ${dataDir} ist nicht beschreibbar`;

    return { status: "error", error };
  }

  return { status: "ok", worker: env.RUN_WORKER === "0" ? "disabled" : "enabled" };
}
