import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEnv } from "@/env";

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
