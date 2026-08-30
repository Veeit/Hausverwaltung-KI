import { z } from "zod";

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
  MAIL_ALIAS: z.string().email(),        // hausverwaltung@… — Filter + Absender
  DASHBOARD_PASSWORD: z.string().min(1),
  MAIL_RATE_LIMIT_PER_HOUR: z.coerce.number().default(20),
  DATABASE_PATH: z.string().default("./data/hausverwaltung.db"),
  ATTACHMENTS_DIR: z.string().default("./data/attachments"),
  POLL_INTERVAL_MS: z.coerce.number().default(30000),
  LANDLORD_NAME: z.string().default("Der Vermieter"),
});

export type Env = z.infer<typeof envSchema>;

// Liest process.env bei JEDEM Aufruf neu (lazy, dadurch testbar).
// Wirft einen ZodError, wenn Pflichtfelder fehlen oder Werte ungueltig sind.
export function getEnv(): Env {
  return envSchema.parse(process.env);
}
