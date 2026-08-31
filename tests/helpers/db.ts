import { createDb, setDbForTesting, type AppDb } from "@/db/client";

export function makeTestDb(): AppDb {
  const db = createDb(":memory:");
  setDbForTesting(db);
  return db;
}
