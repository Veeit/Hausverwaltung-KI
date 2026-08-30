import "dotenv/config";
import { pathToFileURL } from "node:url";
import { getDb } from "../src/db/client";
import { contractors, properties, tenants } from "../src/db/schema";

export function runSeed(): void {
  const db = getDb();

  if (db.select().from(properties).all().length > 0) {
    console.log("Seed übersprungen: Es sind bereits Stammdaten vorhanden.");
    return;
  }

  const property = db
    .insert(properties)
    .values({ address: "Musterstraße 1, 20095 Hamburg" })
    .returning()
    .get();

  db.insert(tenants)
    .values([
      {
        name: "Max Mustermann",
        email: "max.mustermann@example.com",
        propertyId: property.id,
        unitLabel: "2. OG links",
      },
      {
        name: "Erika Beispiel",
        email: "erika.beispiel@example.com",
        propertyId: property.id,
        unitLabel: "EG rechts",
      },
    ])
    .run();

  db.insert(contractors)
    .values([
      { name: "Klaus Rohr", email: "klaus.rohr@example.com", trade: "Sanitär" },
      { name: "Elke Blitz", email: "elke.blitz@example.com", trade: "Elektrik" },
      { name: "Sven Schloss", email: "sven.schloss@example.com", trade: "Schlüsseldienst" },
    ])
    .run();

  console.log("Seed abgeschlossen: 1 Objekt, 2 Mieter, 3 Handwerker angelegt.");
  console.log(
    "Hinweis: Für den Live-Test die E-Mail-Adressen der Mieter und Handwerker im Dashboard (Stammdaten) auf echte Testadressen ändern.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSeed();
}
