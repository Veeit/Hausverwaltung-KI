import { cookies } from "next/headers";
import { AUTH_COOKIE, getExpectedAuthCookie } from "@/lib/auth";
import { LandingHeader } from "@/app/components/landing/LandingHeader";
import { Hero } from "@/app/components/landing/Hero";
import { Schmerz } from "@/app/components/landing/Schmerz";
import { Beweis } from "@/app/components/landing/Beweis";
import { Sicherheit } from "@/app/components/landing/Sicherheit";
import { Rechnung } from "@/app/components/landing/Rechnung";
import { Einwaende } from "@/app/components/landing/Einwaende";
import { Preise } from "@/app/components/landing/Preise";
import { Abschluss } from "@/app/components/landing/Abschluss";

export const dynamic = "force-dynamic";

/**
 * Öffentliche Landingpage. Sie ersetzt die Anmeldeseite als Einstieg: Der
 * Proxy schickt jeden nicht angemeldeten Zugriff auf /app hierher, nicht mehr
 * auf ein nacktes Passwortfeld.
 *
 * Bewusst KEIN automatischer Weiterleiten angemeldeter Besucher auf /app —
 * die Seite soll auch im angemeldeten Zustand vorführbar bleiben. Stattdessen
 * wechselt nur der Knopf in der Kopfzeile auf "Zum Dashboard".
 */
export default async function LandingPage() {
  const expected = await getExpectedAuthCookie(process.env.DASHBOARD_PASSWORD);
  const cookieStore = await cookies();
  const angemeldet =
    expected !== null && cookieStore.get(AUTH_COOKIE)?.value === expected;

  return (
    <main className="bg-ground font-display text-ink">
      <LandingHeader angemeldet={angemeldet} />
      <Hero />
      <Schmerz />
      <Beweis />
      <Sicherheit />
      <Rechnung />
      <Einwaende />
      <Preise />
      <Abschluss />
    </main>
  );
}
