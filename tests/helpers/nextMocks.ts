// tests/helpers/nextMocks.ts
//
// Stub-Factories für die Next.js-Modul-Mocks in Server-Action-Tests.
//
// ACHTUNG: Diese Datei enthält bewusst KEINE vi.mock-Aufrufe. Vitest hoisted
// vi.mock an den Anfang der jeweiligen Testdatei — ein vi.mock-Aufruf aus
// einem importierten Helper heraus würde deshalb NICHT auf die Testdatei
// wirken. Jede Action-Testdatei schreibt die drei vi.mock-Aufrufe
// (next/cache, next/navigation, next/headers) selbst hin und verwendet aus
// dieser Datei nur die Factories.

import { AUTH_COOKIE } from "@/lib/auth";

let authCookieValue = "";

/**
 * Setzt den Wert, den cookiesStub() für das Auth-Cookie liefert.
 * In beforeAll mit `await sha256Hex(process.env.DASHBOARD_PASSWORD!)` befüllen,
 * damit requireAuth() die Tests passieren lässt.
 */
export function setAuthCookieValue(value: string): void {
  authCookieValue = value;
}

export interface CookieStoreStub {
  get(name: string): { name: string; value: string } | undefined;
  set(name: string, value: string, options?: Record<string, unknown>): void;
  delete(name: string): void;
}

/** Nachbildung des cookies()-Stores: liefert das Auth-Cookie, ignoriert Schreibzugriffe. */
export function cookiesStub(): CookieStoreStub {
  return {
    get(name: string) {
      if (name === AUTH_COOKIE && authCookieValue !== "") {
        return { name, value: authCookieValue };
      }
      return undefined;
    },
    set() {
      // Schreibzugriffe sind in Action-Tests irrelevant.
    },
    delete() {
      // Schreibzugriffe sind in Action-Tests irrelevant.
    },
  };
}

/** redirect()-Ersatz: wirft, damit ein unerwarteter Redirect den Test sichtbar fehlschlagen lässt. */
export function redirectStub(url: string): never {
  throw new Error(`redirect:${url}`);
}
