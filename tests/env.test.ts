import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnvValidationError, getEnv } from "@/env";

// Pflichtfelder, die jeder Testfall als Ausgangsbasis gesetzt bekommt.
const REQUIRED_ENV: Record<string, string> = {
  ANTHROPIC_API_KEY: "test-key",
  MAIL_USER: "konto@example.com",
  MAIL_PASSWORD: "app-passwort",
  MAIL_ALIAS: "hausverwaltung@example.com",
  DASHBOARD_PASSWORD: "geheim",
};

// Alle Variablen des Schemas — werden vor jedem Test geleert und danach
// auf den urspruenglichen Zustand der Shell zurueckgesetzt.
const MANAGED_KEYS = [
  "ANTHROPIC_API_KEY",
  "IMAP_HOST",
  "IMAP_PORT",
  "IMAP_MAILBOX",
  "IMAP_LOOKBACK_DAYS",
  "SMTP_HOST",
  "SMTP_PORT",
  "MAIL_USER",
  "MAIL_PASSWORD",
  "MAIL_ALIAS",
  "DASHBOARD_PASSWORD",
  "MAIL_RATE_LIMIT_PER_HOUR",
  "DATABASE_PATH",
  "ATTACHMENTS_DIR",
  "POLL_INTERVAL_MS",
  "LANDLORD_NAME",
];

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of MANAGED_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(REQUIRED_ENV)) {
    process.env[key] = value;
  }
});

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

describe("getEnv", () => {
  it("liefert Pflichtfelder und fuellt alle Defaults", () => {
    const env = getEnv();
    expect(env.ANTHROPIC_API_KEY).toBe("test-key");
    expect(env.MAIL_USER).toBe("konto@example.com");
    expect(env.MAIL_PASSWORD).toBe("app-passwort");
    expect(env.MAIL_ALIAS).toBe("hausverwaltung@example.com");
    expect(env.DASHBOARD_PASSWORD).toBe("geheim");
    expect(env.IMAP_HOST).toBe("imap.fastmail.com");
    expect(env.IMAP_PORT).toBe(993);
    expect(env.IMAP_MAILBOX).toBe("INBOX");
    expect(env.IMAP_LOOKBACK_DAYS).toBe(3);
    expect(env.SMTP_HOST).toBe("smtp.fastmail.com");
    expect(env.SMTP_PORT).toBe(465);
    expect(env.MAIL_RATE_LIMIT_PER_HOUR).toBe(20);
    expect(env.DATABASE_PATH).toBe("./data/hausverwaltung.db");
    expect(env.ATTACHMENTS_DIR).toBe("./data/attachments");
    expect(env.POLL_INTERVAL_MS).toBe(30000);
    expect(env.LANDLORD_NAME).toBe("Der Vermieter");
  });

  it("wandelt numerische Strings in Zahlen um", () => {
    process.env.IMAP_PORT = "1993";
    process.env.MAIL_RATE_LIMIT_PER_HOUR = "3";
    const env = getEnv();
    expect(env.IMAP_PORT).toBe(1993);
    expect(env.MAIL_RATE_LIMIT_PER_HOUR).toBe(3);
  });

  // Bugfix: ein Vermieter, der per Fastmail-Regel Mails an seinen Alias in
  // einen eigenen Ordner sortiert (statt sie in der INBOX zu belassen),
  // konfiguriert diesen Ordnernamen über IMAP_MAILBOX. Ordnernamen können
  // Leerzeichen und Umlaute enthalten (z. B. "Hausverwaltung TOOL FOM") —
  // ein beim Kopieren aus der Fastmail-Oberfläche versehentlich mitgenommenes
  // führendes/abschließendes Leerzeichen darf dabei nicht zu einem "Ordner
  // nicht gefunden"-Fehler führen.
  it("übernimmt einen konfigurierten IMAP_MAILBOX-Ordnernamen unverändert (Leerzeichen und Umlaute erlaubt)", () => {
    process.env.IMAP_MAILBOX = "Hausverwaltung TOOL FOM";
    expect(getEnv().IMAP_MAILBOX).toBe("Hausverwaltung TOOL FOM");
  });

  it("entfernt führende/abschließende Leerzeichen aus IMAP_MAILBOX", () => {
    process.env.IMAP_MAILBOX = "  Hausverwaltung TOOL FOM  ";
    expect(getEnv().IMAP_MAILBOX).toBe("Hausverwaltung TOOL FOM");
  });

  // IMAP_LOOKBACK_DAYS begrenzt die Schlagwort-basierte IMAP-Suche zeitlich
  // (siehe src/channel/imap.ts) — ohne diese Grenze würde der allererste Lauf
  // gegen einen gewachsenen Postfach-Ordner jede jemals an den Alias
  // gegangene Mail als neu ansehen.
  it("wandelt IMAP_LOOKBACK_DAYS in eine Zahl um", () => {
    process.env.IMAP_LOOKBACK_DAYS = "7";
    expect(getEnv().IMAP_LOOKBACK_DAYS).toBe(7);
  });

  it("wirft bei einem nicht-positiven IMAP_LOOKBACK_DAYS", () => {
    process.env.IMAP_LOOKBACK_DAYS = "0";
    expect(() => getEnv()).toThrow();
  });

  it("wirft, wenn ein Pflichtfeld fehlt", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => getEnv()).toThrow();
  });

  it("wirft bei ungueltiger E-Mail-Adresse in MAIL_ALIAS", () => {
    process.env.MAIL_ALIAS = "keine-mailadresse";
    expect(() => getEnv()).toThrow();
  });

  it("liest process.env bei jedem Aufruf neu (lazy)", () => {
    expect(getEnv().LANDLORD_NAME).toBe("Der Vermieter");
    process.env.LANDLORD_NAME = "Vera Vermieter";
    expect(getEnv().LANDLORD_NAME).toBe("Vera Vermieter");
    delete process.env.LANDLORD_NAME;
    expect(getEnv().LANDLORD_NAME).toBe("Der Vermieter");
  });
});

// Nachstellung des Ersteinrichtungs-Fehlers: ein Betreiber trägt bei
// MAIL_ALIAS nur den Namensteil statt einer vollständigen Adresse ein und
// lässt gleichzeitig ANTHROPIC_API_KEY leer. getEnv() darf dabei keinen
// rohen ZodError mehr durchreichen, sondern muss eine lesbare, deutsche
// Sammelmeldung werfen, die BEIDE Variablen nennt.
describe("getEnv Fehlermeldung bei ungültiger Konfiguration", () => {
  it("wirft keinen rohen ZodError, sondern ein normales Error-Objekt", () => {
    delete process.env.ANTHROPIC_API_KEY;
    try {
      getEnv();
      expect.unreachable("getEnv() hätte werfen müssen");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).not.toBe("ZodError");
    }
  });

  // Der Fehlertyp erlaubt Aufrufern (z.B. dem Worker-Einstiegspunkt), einen
  // Konfigurationsfehler zuverlaessig am Typ zu erkennen statt am Text der
  // Meldung zu raten — siehe reportStartupError() in src/lib/startupError.ts.
  it("wirft eine EnvValidationError (erkennbarer Typ statt generischem Error)", () => {
    delete process.env.ANTHROPIC_API_KEY;
    let caught: unknown;
    try {
      getEnv();
      expect.unreachable("getEnv() hätte werfen müssen");
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof EnvValidationError).toBe(true);
  });

  it("nennt alle fehlerhaften Variablen auf einmal, nicht nur die erste", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.MAIL_ALIAS = "hausverwaltung-tool"; // der reale Tippfehler: nur Namensteil, keine vollständige Adresse
    let message = "";
    try {
      getEnv();
      expect.unreachable("getEnv() hätte werfen müssen");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("ANTHROPIC_API_KEY");
    expect(message).toContain("MAIL_ALIAS");
  });

  it("formuliert eine fehlende Pflichtvariable anders als eine ungültige", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.MAIL_ALIAS = "hausverwaltung-tool";
    let message = "";
    try {
      getEnv();
      expect.unreachable("getEnv() hätte werfen müssen");
    } catch (err) {
      message = (err as Error).message;
    }
    const anthropicLine = message.split("\n").find((line) => line.includes("ANTHROPIC_API_KEY"));
    const aliasLine = message.split("\n").find((line) => line.includes("MAIL_ALIAS"));
    expect(anthropicLine).toMatch(/fehlt/i);
    expect(aliasLine).toMatch(/ungültig/i);
    expect(anthropicLine).not.toMatch(/ungültig/i);
    expect(aliasLine).not.toMatch(/fehlt/i);
  });

  it("nennt bei MAIL_ALIAS ein vollständiges Beispiel und zeigt den vorgefundenen (unkritischen) Wert", () => {
    process.env.MAIL_ALIAS = "hausverwaltung-tool";
    let message = "";
    try {
      getEnv();
      expect.unreachable("getEnv() hätte werfen müssen");
    } catch (err) {
      message = (err as Error).message;
    }
    // Beispiel muss eine vollständige Adresse mit @ und Domain sein.
    expect(message).toMatch(/[a-z0-9.-]+@[a-z0-9.-]+\.[a-z]+/i);
    // Der konkret vorgefundene (fehlerhafte) Wert hilft beim Debuggen und ist
    // unkritisch (keine Zugangsdaten) — darf also angezeigt werden.
    expect(message).toContain("hausverwaltung-tool");
  });

  it("verweist auf .env und .env.example", () => {
    delete process.env.ANTHROPIC_API_KEY;
    let message = "";
    try {
      getEnv();
      expect.unreachable("getEnv() hätte werfen müssen");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain(".env.example");
    expect(message).toContain(".env");
  });

  it("gibt bei fehlenden Geheimnissen (API-Key, Mail-Passwort, Dashboard-Passwort) niemals deren Wert aus", () => {
    process.env.ANTHROPIC_API_KEY = "";
    process.env.MAIL_PASSWORD = "";
    process.env.DASHBOARD_PASSWORD = "";
    let message = "";
    try {
      getEnv();
      expect.unreachable("getEnv() hätte werfen müssen");
    } catch (err) {
      message = (err as Error).message;
    }
    const secretLines = message
      .split("\n")
      .filter((line) =>
        ["ANTHROPIC_API_KEY", "MAIL_PASSWORD", "DASHBOARD_PASSWORD"].some((name) =>
          line.includes(name),
        ),
      );
    expect(secretLines.length).toBeGreaterThan(0);
    for (const line of secretLines) {
      expect(line).not.toMatch(/Wert/i);
    }
  });
});
