"use server";

import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { waitlist } from "@/db/schema";
import { fail, OK, type ActionResult } from "@/lib/actionResult";
import {
  isPlausibleEmail,
  isUnitBucket,
  normalizeEmail,
  type WaitlistState,
} from "@/lib/waitlist";
import { requireAuth } from "@/app/actions/auth";
import { revalidatePath } from "next/cache";

/**
 * Eintrag in die Warteliste — die EINZIGE öffentlich erreichbare Server
 * Action dieses Projekts (alle anderen rufen requireAuth auf). Deshalb hier
 * bewusst eng gefasst:
 *
 * - Es werden ausschliesslich drei Werte gespeichert: Adresse, Grössenklasse
 *   aus einer festen Liste, und ein Ja/Nein für den Demo-Wunsch. Kein
 *   Freitextfeld, das sich als Ablage missbrauchen liesse.
 * - Die Adresse wird längenbegrenzt und normalisiert; eine bereits
 *   eingetragene Adresse aktualisiert ihren Eintrag, statt einen zweiten
 *   anzulegen. Die Zeilenzahl wächst also nicht durch wiederholtes Absenden
 *   derselben Adresse.
 * - Ein verstecktes Feld ("website") dient als Köder für einfache Bots:
 *   ausgefüllt heisst automatisch abgeschickt. Dann wird nichts gespeichert,
 *   der Absender bekommt aber dieselbe Bestätigung wie ein Mensch.
 *
 * Was das NICHT abdeckt: ein Angreifer, der viele verschiedene erfundene
 * Adressen einträgt. Dagegen hilft nur eine Ratenbegrenzung pro IP, die auf
 * Anwendungsebene ohne Reverse-Proxy nicht verlässlich umsetzbar ist — für
 * ein Vorführsystem ist das bewusst offen gelassen.
 */
export async function joinWaitlist(
  _prevState: WaitlistState,
  formData: FormData,
): Promise<WaitlistState> {
  if (String(formData.get("website") ?? "") !== "") {
    // Köderfeld ausgefüllt: still verwerfen, ohne dem Bot Rückschluss zu geben.
    return { error: null, ok: true };
  }

  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (email === "") {
    return { error: "Bitte tragen Sie Ihre E-Mail-Adresse ein.", ok: false };
  }
  if (!isPlausibleEmail(email)) {
    return { error: "Diese E-Mail-Adresse sieht nicht vollständig aus.", ok: false };
  }

  const rawUnits = String(formData.get("units") ?? "");
  const units = isUnitBucket(rawUnits) ? rawUnits : null;
  const wantsDemo = formData.get("demo") !== null ? 1 : 0;

  const db = getDb();
  const vorhanden = db.select().from(waitlist).where(eq(waitlist.email, email)).get();
  if (vorhanden) {
    // Zweiter Versuch derselben Adresse: Angaben auffrischen statt doppeln.
    // Die Antwort ist dieselbe wie bei einem neuen Eintrag — sonst liesse
    // sich über das Formular herausfinden, wer bereits auf der Liste steht.
    db.update(waitlist).set({ units, wantsDemo }).where(eq(waitlist.id, vorhanden.id)).run();
  } else {
    db.insert(waitlist).values({ email, units, wantsDemo }).run();
  }

  return { error: null, ok: true };
}

/**
 * Eintrag löschen — nur aus dem Dashboard heraus. Betroffene können ihre
 * Streichung formlos verlangen; ohne diesen Weg gäbe es im Dashboard keine
 * Möglichkeit dazu.
 */
export async function deleteWaitlistEntry(id: number): Promise<ActionResult> {
  await requireAuth();
  const db = getDb();
  const vorhanden = db.select().from(waitlist).where(eq(waitlist.id, id)).get();
  if (!vorhanden) {
    return fail("Dieser Eintrag existiert nicht (mehr).");
  }
  db.delete(waitlist).where(eq(waitlist.id, id)).run();
  revalidatePath("/app/warteliste");
  return OK;
}

/** Alle Einträge, neueste zuerst. Nur für das Dashboard. */
export async function listWaitlist() {
  await requireAuth();
  const db = getDb();
  return db.select().from(waitlist).orderBy(desc(waitlist.id)).all();
}
