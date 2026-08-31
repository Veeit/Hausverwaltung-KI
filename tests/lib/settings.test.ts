import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDbForTesting, type AppDb } from "@/db/client";
import { settings } from "@/db/schema";
import { deleteSetting, getSetting, setSetting } from "@/lib/settings";
import { makeTestDb } from "../helpers/db";

let db: AppDb;

beforeEach(() => {
  db = makeTestDb();
});

afterEach(() => {
  setDbForTesting(null);
});

describe("lib/settings", () => {
  it("liefert null für einen unbekannten Key", () => {
    expect(getSetting("gibt_es_nicht")).toBeNull();
  });

  it("speichert und liest einen Wert", () => {
    setSetting("worker_paused", "1");
    expect(getSetting("worker_paused")).toBe("1");
  });

  it("überschreibt beim zweiten setSetting denselben Key (Upsert, keine Duplikate)", () => {
    setSetting("worker_paused", "1");
    setSetting("worker_paused", "0");
    expect(getSetting("worker_paused")).toBe("0");
    expect(db.select().from(settings).all()).toHaveLength(1);
  });

  it("löscht einen Wert; Löschen eines unbekannten Keys ist ein No-op", () => {
    setSetting("worker_paused", "1");
    deleteSetting("worker_paused");
    expect(getSetting("worker_paused")).toBeNull();
    expect(() => deleteSetting("gibt_es_nicht")).not.toThrow();
  });
});
