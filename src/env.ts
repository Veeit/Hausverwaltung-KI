import { z, type ZodError } from "zod";

// Schema aller Umgebungsvariablen. Pflichtfelder haben keinen Default;
// Zahlen werden per z.coerce aus Strings gewandelt, da process.env
// ausschliesslich Strings liefert.
const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  IMAP_HOST: z.string().default("imap.fastmail.com"),
  IMAP_PORT: z.coerce.number().default(993),
  SMTP_HOST: z.string().default("smtp.fastmail.com"),
  SMTP_PORT: z.coerce.number().default(465),
  MAIL_USER: z.string().min(1),          // Fastmail-Login
  MAIL_PASSWORD: z.string().min(1),      // App-Passwort
  MAIL_ALIAS: z.string().email(),        // hausverwaltung-tool@ihre-domain.de — Filter + Absender
  DASHBOARD_PASSWORD: z.string().min(1),
  MAIL_RATE_LIMIT_PER_HOUR: z.coerce.number().default(20),
  DATABASE_PATH: z.string().default("./data/hausverwaltung.db"),
  ATTACHMENTS_DIR: z.string().default("./data/attachments"),
  POLL_INTERVAL_MS: z.coerce.number().default(30000),
  LANDLORD_NAME: z.string().default("Der Vermieter"),
});

export type Env = z.infer<typeof envSchema>;

// Variablen, deren Wert ein Geheimnis ist (API-Schluessel, Passwoerter).
// Deren Inhalt darf in einer Fehlermeldung NIE im Klartext auftauchen —
// dort genuegt der Variablenname.
const SECRET_FIELDS = new Set(["ANTHROPIC_API_KEY", "MAIL_PASSWORD", "DASHBOARD_PASSWORD"]);

// Kurze, fuer Menschen verstaendliche Beschreibung dessen, was pro Variable
// erwartet wird. Wird sowohl bei fehlenden als auch bei ungueltigen Werten
// in der Fehlermeldung verwendet.
const FIELD_HINTS: Record<string, string> = {
  ANTHROPIC_API_KEY: "ein Anthropic-API-Schlüssel (siehe https://console.anthropic.com)",
  IMAP_HOST: "der Hostname des IMAP-Servers",
  IMAP_PORT: "eine Portnummer (Zahl), z. B. 993",
  SMTP_HOST: "der Hostname des SMTP-Servers",
  SMTP_PORT: "eine Portnummer (Zahl), z. B. 465",
  MAIL_USER: "die vollständige Fastmail-Login-E-Mail-Adresse",
  MAIL_PASSWORD: "ein Fastmail-App-Passwort (nicht das normale Kontopasswort)",
  MAIL_ALIAS:
    "eine VOLLSTÄNDIGE E-Mail-Adresse, z. B. hausverwaltung-tool@ihre-domain.de — " +
    "nicht nur der Namensteil vor dem @",
  DASHBOARD_PASSWORD: "ein Passwort für das Vermieter-Dashboard",
  MAIL_RATE_LIMIT_PER_HOUR: "eine Zahl (maximale ausgehende Mails pro Stunde)",
  DATABASE_PATH: "ein Dateipfad für die SQLite-Datenbank",
  ATTACHMENTS_DIR: "ein Verzeichnispfad für Mail-Anhänge",
  POLL_INTERVAL_MS: "eine Zahl (Millisekunden)",
  LANDLORD_NAME: "der Name des Vermieters",
};

function isEmpty(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

// Wandelt einen ZodError aus dem Parsen von process.env in eine lesbare,
// deutsche Sammelmeldung um: alle betroffenen Variablen auf einmal, je
// Variable eine eigene Zeile mit dem, was erwartet wird, und getrennter
// Formulierung fuer "fehlt" vs. "ungueltig". Geheimnisse (SECRET_FIELDS)
// zeigen nie ihren Wert; bei unkritischen Feldern wie MAIL_ALIAS hilft der
// vorgefundene Wert beim Debuggen und wird deshalb angezeigt.
function formatEnvError(error: ZodError): Error {
  const seenFields = new Set<string>();
  const lines: string[] = [];

  for (const issue of error.issues) {
    const field = String(issue.path[0]);
    if (seenFields.has(field)) continue;
    seenFields.add(field);

    const rawValue = process.env[field];
    const hint = FIELD_HINTS[field] ?? "ein gültiger Wert";

    if (isEmpty(rawValue)) {
      lines.push(`  - ${field}: fehlt. Erwartet wird ${hint}.`);
    } else if (SECRET_FIELDS.has(field)) {
      lines.push(`  - ${field}: ungültig. Erwartet wird ${hint}.`);
    } else {
      lines.push(`  - ${field}: ungültig (aktueller Wert: "${rawValue}"). Erwartet wird ${hint}.`);
    }
  }

  const message =
    "Ungültige oder fehlende Umgebungsvariablen:\n" +
    lines.join("\n") +
    "\n\nBitte die Werte in der Datei .env korrigieren (Vorlage: .env.example).";

  return new Error(message);
}

// Liest process.env bei JEDEM Aufruf neu (lazy, dadurch testbar).
// Wirft eine lesbare, deutsche Fehlermeldung, wenn Pflichtfelder fehlen
// oder Werte ungueltig sind — siehe formatEnvError().
export function getEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    throw formatEnvError(result.error);
  }
  return result.data;
}
