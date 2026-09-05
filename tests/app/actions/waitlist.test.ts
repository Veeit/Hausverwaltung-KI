import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDbForTesting } from "@/db/client";
import { waitlist } from "@/db/schema";
import { makeTestDb } from "../../helpers/db";
import { joinWaitlist } from "@/app/actions/waitlist";
import { WAITLIST_INITIAL } from "@/lib/waitlist";

// joinWaitlist ist die einzige Server Action ohne requireAuth — sie ist über
// die öffentliche Produktseite für jeden erreichbar. Diese Tests halten fest,
// was dabei NICHT passieren darf.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let db: ReturnType<typeof makeTestDb>;

beforeEach(() => {
  db = makeTestDb();
});

afterEach(() => {
  setDbForTesting(null);
  vi.clearAllMocks();
});

function formular(werte: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(werte)) fd.set(k, v);
  return fd;
}

function alleEintraege() {
  return db.select().from(waitlist).all();
}

describe("joinWaitlist", () => {
  it("legt einen Eintrag an und meldet Erfolg", async () => {
    const state = await joinWaitlist(WAITLIST_INITIAL, formular({ email: "max@example.de", units: "10-49" }));

    expect(state).toEqual({ error: null, ok: true });
    const eintraege = alleEintraege();
    expect(eintraege).toHaveLength(1);
    expect(eintraege[0].email).toBe("max@example.de");
    expect(eintraege[0].units).toBe("10-49");
    expect(eintraege[0].wantsDemo).toBe(0);
  });

  it("merkt sich den Demo-Wunsch, wenn das Kästchen gesetzt ist", async () => {
    await joinWaitlist(WAITLIST_INITIAL, formular({ email: "max@example.de", demo: "on" }));
    expect(alleEintraege()[0].wantsDemo).toBe(1);
  });

  it("speichert die Adresse normalisiert", async () => {
    await joinWaitlist(WAITLIST_INITIAL, formular({ email: "  Max@Example.DE  " }));
    expect(alleEintraege()[0].email).toBe("max@example.de");
  });

  it("legt bei erneutem Absenden derselben Adresse KEINEN zweiten Eintrag an", async () => {
    // Sonst könnte ein einziger Besucher die Tabelle durch wiederholtes
    // Klicken beliebig aufblähen.
    await joinWaitlist(WAITLIST_INITIAL, formular({ email: "max@example.de", units: "1-9" }));
    const state = await joinWaitlist(
      WAITLIST_INITIAL,
      formular({ email: "MAX@example.de", units: "50-249", demo: "on" }),
    );

    expect(state.ok).toBe(true);
    const eintraege = alleEintraege();
    expect(eintraege).toHaveLength(1);
    // Die Angaben werden aufgefrischt statt gedoppelt.
    expect(eintraege[0].units).toBe("50-249");
    expect(eintraege[0].wantsDemo).toBe(1);
  });

  it("gibt bei bereits eingetragener Adresse dieselbe Antwort wie bei einer neuen", async () => {
    // Andernfalls liesse sich über das öffentliche Formular herausfinden,
    // welche Adressen bereits auf der Liste stehen.
    const erst = await joinWaitlist(WAITLIST_INITIAL, formular({ email: "max@example.de" }));
    const zweit = await joinWaitlist(WAITLIST_INITIAL, formular({ email: "max@example.de" }));
    expect(zweit).toEqual(erst);
  });

  it("weist eine unvollständige Adresse mit deutscher Meldung ab und speichert nichts", async () => {
    const state = await joinWaitlist(WAITLIST_INITIAL, formular({ email: "max@example" }));

    expect(state.ok).toBe(false);
    expect(state.error).toBe("Diese E-Mail-Adresse sieht nicht vollständig aus.");
    expect(alleEintraege()).toHaveLength(0);
  });

  it("weist ein leeres Feld gesondert ab", async () => {
    const state = await joinWaitlist(WAITLIST_INITIAL, formular({ email: "   " }));

    expect(state.error).toBe("Bitte tragen Sie Ihre E-Mail-Adresse ein.");
    expect(alleEintraege()).toHaveLength(0);
  });

  it("übernimmt keine erfundene Größenklasse, sondern speichert null", async () => {
    // Das Feld kommt aus einem öffentlichen Formular und ist manipulierbar.
    await joinWaitlist(WAITLIST_INITIAL, formular({ email: "max@example.de", units: "<script>" }));
    expect(alleEintraege()[0].units).toBeNull();
  });

  it("verwirft Einsendungen mit ausgefülltem Köderfeld lautlos", async () => {
    const state = await joinWaitlist(
      WAITLIST_INITIAL,
      formular({ email: "bot@example.de", website: "http://spam.example" }),
    );

    // Nach aussen dieselbe Bestätigung wie für einen Menschen …
    expect(state).toEqual({ error: null, ok: true });
    // … aber nichts landet in der Datenbank.
    expect(alleEintraege()).toHaveLength(0);
  });
});
