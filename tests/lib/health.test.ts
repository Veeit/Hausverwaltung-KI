import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DATABASE_PATH, getHealthStatus } from "@/lib/health";

// POSIX-Rechteprüfungen werden für uid 0 übersprungen: Als root wäre das
// Verzeichnis trotz chmod 0o555 "beschreibbar", der Test würde aus dem
// falschen Grund fehlschlagen. Deshalb sichtbar überspringen statt verfälschen.
const isRoot = process.getuid?.() === 0;

describe("getHealthStatus", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "hv-health-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("meldet ok, wenn das Datenverzeichnis beschreibbar ist", () => {
    const result = getHealthStatus({
      DATABASE_PATH: path.join(dataDir, "hausverwaltung.db"),
    });

    expect(result).toEqual({ status: "ok", worker: "enabled" });
  });

  it("meldet worker: disabled, wenn RUN_WORKER=0 gesetzt ist", () => {
    const result = getHealthStatus({
      DATABASE_PATH: path.join(dataDir, "hausverwaltung.db"),
      RUN_WORKER: "0",
    });

    expect(result).toEqual({ status: "ok", worker: "disabled" });
  });

  it("meldet error, wenn das Datenverzeichnis fehlt", () => {
    const missingDir = path.join(dataDir, "gibt-es-nicht");
    const missing = path.join(missingDir, "hausverwaltung.db");

    const result = getHealthStatus({ DATABASE_PATH: missing });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toContain(missingDir);
      expect(result.error).toContain("existiert nicht");
    }
  });

  it("verwendet den dokumentierten Default-Pfad", () => {
    expect(DEFAULT_DATABASE_PATH).toBe("./data/hausverwaltung.db");
  });

  it("faellt ohne DATABASE_PATH auf den Default zurueck", () => {
    // Bewusst kein Vergleich mit einem festen Ergebnis: ob ./data im
    // Arbeitsverzeichnis existiert, haengt von der Umgebung ab. Geprueft wird
    // deshalb, dass ein fehlendes DATABASE_PATH sich exakt so verhaelt wie ein
    // ausdruecklich auf den Default gesetztes.
    expect(getHealthStatus({})).toEqual(
      getHealthStatus({ DATABASE_PATH: DEFAULT_DATABASE_PATH }),
    );
  });

  it.skipIf(isRoot)(
    "meldet error mit anderer Ursache, wenn das Datenverzeichnis existiert, aber nicht beschreibbar ist",
    () => {
      const readonlyDir = path.join(dataDir, "readonly");
      mkdirSync(readonlyDir);

      try {
        chmodSync(readonlyDir, 0o555);

        const result = getHealthStatus({
          DATABASE_PATH: path.join(readonlyDir, "hausverwaltung.db"),
        });

        expect(result.status).toBe("error");
        if (result.status === "error") {
          expect(result.error).toContain(readonlyDir);
          expect(result.error).toContain("nicht beschreibbar");
        }
      } finally {
        // Schreibrechte wiederherstellen, damit rmSync im afterEach greift.
        chmodSync(readonlyDir, 0o755);
      }
    },
  );
});
