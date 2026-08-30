import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DATABASE_PATH, getHealthStatus } from "@/lib/health";

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
    const missing = path.join(dataDir, "gibt-es-nicht", "hausverwaltung.db");

    const result = getHealthStatus({ DATABASE_PATH: missing });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toContain(path.join(dataDir, "gibt-es-nicht"));
    }
  });

  it("faellt ohne DATABASE_PATH auf den Default zurueck", () => {
    const result = getHealthStatus({});

    // Das Default-Verzeichnis ./data existiert im Testlauf nicht.
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toContain(path.dirname(DEFAULT_DATABASE_PATH));
    }
  });
});
