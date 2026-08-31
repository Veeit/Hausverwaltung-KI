export const AUTH_COOKIE = "hv_auth";

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Liefert den erwarteten Wert des Auth-Cookies für das konfigurierte
 * DASHBOARD_PASSWORD, oder `null`, wenn kein brauchbares Passwort
 * konfiguriert ist (Variable fehlt oder ist auch nach `trim()` leer).
 *
 * Wichtig: Ein leeres Passwort darf NIEMALS als gültige Konfiguration
 * durchgehen. Ohne diese Prüfung würde `sha256("")` als erwarteter
 * Cookie-Wert berechnet — ein öffentlich bekannter, konstanter Hash
 * (`e3b0c442...`), den jeder ohne Passwortkenntnis in sein Cookie
 * schreiben könnte. Deshalb geben wir hier bewusst `null` zurück statt
 * eines Hashs, und alle Aufrufer müssen `null` als "Zugriff verweigert"
 * behandeln, bevor überhaupt verglichen wird (fail-closed).
 *
 * Bleibt Edge-kompatibel: nur Web Crypto (`crypto.subtle`), kein
 * `getEnv()`/zod und keine Node-Imports, da diese Datei auch von der
 * Middleware (Edge-Runtime) verwendet wird.
 */
export async function getExpectedAuthCookie(
  rawPassword: string | undefined,
): Promise<string | null> {
  if (!rawPassword || rawPassword.trim() === "") {
    return null;
  }
  return sha256Hex(rawPassword);
}
