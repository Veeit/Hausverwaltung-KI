import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setDbForTesting } from "@/db/client";
import { makeTestDb } from "../helpers/db";

afterEach(() => {
  setDbForTesting(null);
});

describe("DDL: FTS5-Tabelle und Indizes", () => {
  it("legt die virtuelle Tabelle documents_fts an; INSERT + MATCH funktionieren", () => {
    const db = makeTestDb();

    const master = db.all(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'documents_fts'`,
    );
    expect(master).toHaveLength(1);

    db.run(
      sql`INSERT INTO documents_fts (rowid, content, document_id) VALUES (1, 'Das Türschloss der Haustür wird jährlich gewartet.', 1)`,
    );
    db.run(
      sql`INSERT INTO documents_fts (rowid, content, document_id) VALUES (2, 'Die Heizung wird im Oktober entlüftet.', 2)`,
    );

    const hits = db.all(
      sql`SELECT document_id FROM documents_fts WHERE documents_fts MATCH 'Türschloss'`,
    );
    expect(hits).toHaveLength(1);

    const none = db.all(
      sql`SELECT document_id FROM documents_fts WHERE documents_fts MATCH 'Aufzug'`,
    );
    expect(none).toHaveLength(0);
  });

  it("legt die drei Indizes aus dem Vertrag an", () => {
    const db = makeTestDb();
    const rows = db.all(
      sql`SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_messages_conversation', 'idx_messages_status', 'idx_tickets_status')`,
    );
    expect(rows).toHaveLength(3);
  });
});
