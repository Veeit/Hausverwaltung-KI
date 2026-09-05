"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, getExpectedAuthCookie, sha256Hex } from "@/lib/auth";

export async function requireAuth(): Promise<void> {
  // fail-closed: `null` bedeutet "kein Passwort konfiguriert" und muss immer
  // zur Umleitung führen, bevor überhaupt ein Cookie-Wert verglichen wird.
  const expected = await getExpectedAuthCookie(process.env.DASHBOARD_PASSWORD);
  if (expected === null) {
    redirect("/login?fehler=konfiguration");
  }
  const cookieStore = await cookies();
  const value = cookieStore.get(AUTH_COOKIE)?.value;
  if (value !== expected) {
    redirect("/login");
  }
}

export async function login(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  // fail-closed: Ohne konfiguriertes Passwort ist kein Login möglich —
  // auch nicht mit leerem Feld, das sonst zufällig zum leeren Erwartungswert
  // passen würde.
  const expected = await getExpectedAuthCookie(process.env.DASHBOARD_PASSWORD);
  if (expected === null) {
    redirect("/login?fehler=konfiguration");
  }
  const candidate = await sha256Hex(password);
  if (candidate !== expected) {
    redirect("/login?fehler=1");
  }
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, expected, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  redirect("/app");
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE);
  // Nach dem Abmelden auf die Landingpage, nicht zurück ins Passwortfeld.
  redirect("/");
}
