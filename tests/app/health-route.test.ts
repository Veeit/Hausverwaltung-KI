import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  let dataDir: string;
  const originalDatabasePath = process.env.DATABASE_PATH;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "hv-route-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    if (originalDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = originalDatabasePath;
    }
  });

  it("antwortet mit 200 und status ok", async () => {
    process.env.DATABASE_PATH = path.join(dataDir, "hausverwaltung.db");

    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("antwortet mit 503, wenn das Datenverzeichnis fehlt", async () => {
    process.env.DATABASE_PATH = path.join(dataDir, "weg", "hausverwaltung.db");

    const response = GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "error" });
  });
});
