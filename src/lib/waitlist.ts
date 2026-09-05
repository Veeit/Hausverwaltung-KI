/**
 * Reine Logik rund um die Warteliste — bewusst ohne Datenbank- und
 * Next.js-Bezug, damit sie ohne Aufbau getestet werden kann.
 */

/** Grössenklassen, aus denen sich Interessenten selbst einordnen. */
export const UNIT_BUCKETS = ["1-9", "10-49", "50-249", "250+"] as const;
export type UnitBucket = (typeof UNIT_BUCKETS)[number];

export const UNIT_BUCKET_LABELS: Record<UnitBucket, string> = {
  "1-9": "bis 9 Einheiten",
  "10-49": "10 bis 49 Einheiten",
  "50-249": "50 bis 249 Einheiten",
  "250+": "250 Einheiten oder mehr",
};

export function isUnitBucket(value: unknown): value is UnitBucket {
  return typeof value === "string" && (UNIT_BUCKETS as readonly string[]).includes(value);
}

export function unitBucketLabel(value: string | null): string {
  return isUnitBucket(value) ? UNIT_BUCKET_LABELS[value] : "keine Angabe";
}

/**
 * Obergrenze für die gespeicherte Adresse. Verhindert, dass über das
 * öffentliche Formular beliebig grosse Werte in die Datenbank wandern.
 */
export const MAX_EMAIL_LENGTH = 254; // RFC 5321

/**
 * Normalisiert eine eingegebene Adresse für Speicherung und Vergleich:
 * Rand-Leerzeichen weg, Kleinschreibung. Gleiche Adresse in anderer
 * Schreibweise soll KEINEN zweiten Eintrag erzeugen — deshalb muss diese
 * Funktion vor jedem Vergleich und vor dem Schreiben laufen.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Bewusst pragmatische Prüfung statt vollständiger RFC-Grammatik: genau ein
 * @, davor und dahinter etwas, im Domainteil mindestens ein Punkt mit
 * Zeichen davor und dahinter, keine Leerzeichen. Wer eine gültige, aber
 * exotische Adresse hat, wird hier nicht ausgesperrt; Tippfehler wie
 * "max@gmail" oder "max @ gmail.com" fallen heraus.
 */
export function isPlausibleEmail(value: string): boolean {
  if (value.length === 0 || value.length > MAX_EMAIL_LENGTH) return false;
  if (/\s/.test(value)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(value);
}

/**
 * Zustand des öffentlichen Wartelisten-Formulars (useActionState).
 *
 * Liegt bewusst HIER und nicht neben der Server Action: eine Datei mit
 * "use server" darf ausschliesslich async-Funktionen exportieren — ein
 * exportiertes Objekt oder ein Typ lässt Next.js zur Laufzeit abbrechen.
 */
export interface WaitlistState {
  error: string | null;
  ok: boolean;
}

export const WAITLIST_INITIAL: WaitlistState = { error: null, ok: false };
