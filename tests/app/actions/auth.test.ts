import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_COOKIE, sha256Hex } from "@/lib/auth";

// next/headers und next/navigation sind Next.js-Serverkontext-Module, die
// außerhalb einer echten Request nicht funktionieren. Für den Unit-Test
// simulieren wir sie: redirect() wirft (wie im echten Next.js) und das
// jeweilige Ziel wird über den Fehler nachvollziehbar.
class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`REDIRECT:${url}`);
  }
}

const cookieStore = new Map<string, string>();

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectSignal(url);
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  })),
}));

const ORIGINAL_DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

function restoreEnv(): void {
  if (ORIGINAL_DASHBOARD_PASSWORD === undefined) {
    delete process.env.DASHBOARD_PASSWORD;
  } else {
    process.env.DASHBOARD_PASSWORD = ORIGINAL_DASHBOARD_PASSWORD;
  }
}

async function importAuthActions() {
  // Frisches Modul pro Test laden, damit process.env-Änderungen sicher greifen.
  vi.resetModules();
  return import("@/app/actions/auth");
}

describe("requireAuth (fail-closed)", () => {
  afterEach(() => {
    restoreEnv();
    cookieStore.clear();
    vi.clearAllMocks();
  });

  it("verweigert Zugriff mit dem Cookie-Wert sha256(''), wenn DASHBOARD_PASSWORD leer ist", async () => {
    process.env.DASHBOARD_PASSWORD = "";
    const { requireAuth } = await importAuthActions();
    cookieStore.set(AUTH_COOKIE, await sha256Hex(""));

    const error: RedirectSignal = await requireAuth().catch((e) => e);
    expect(error).toBeInstanceOf(RedirectSignal);
    expect(error.url).toContain("/login");
  });

  it("verweigert Zugriff, wenn DASHBOARD_PASSWORD nicht gesetzt ist", async () => {
    delete process.env.DASHBOARD_PASSWORD;
    const { requireAuth } = await importAuthActions();
    cookieStore.set(AUTH_COOKIE, await sha256Hex(""));

    await expect(requireAuth()).rejects.toThrow(RedirectSignal);
  });

  it("lässt Zugriff mit korrektem Cookie zu, wenn ein Passwort konfiguriert ist", async () => {
    process.env.DASHBOARD_PASSWORD = "korrektes-passwort";
    const { requireAuth } = await importAuthActions();
    cookieStore.set(AUTH_COOKIE, await sha256Hex("korrektes-passwort"));

    await expect(requireAuth()).resolves.toBeUndefined();
  });
});

describe("login (fail-closed)", () => {
  afterEach(() => {
    restoreEnv();
    cookieStore.clear();
    vi.clearAllMocks();
  });

  it("weist einen Login-Versuch mit leerem Passwort ab, wenn DASHBOARD_PASSWORD leer ist", async () => {
    process.env.DASHBOARD_PASSWORD = "";
    const { login } = await importAuthActions();
    const formData = new FormData();
    formData.set("password", "");

    await expect(login(formData)).rejects.toThrow(RedirectSignal);
    expect(cookieStore.has(AUTH_COOKIE)).toBe(false);
  });

  it("meldet die fehlende Konfiguration über fehler=konfiguration statt eines stillen Fehlschlags", async () => {
    process.env.DASHBOARD_PASSWORD = "";
    const { login } = await importAuthActions();
    const formData = new FormData();
    formData.set("password", "irgendwas");

    const error: RedirectSignal = await login(formData).catch((e) => e);
    expect(error).toBeInstanceOf(RedirectSignal);
    expect(error.url).toBe("/login?fehler=konfiguration");
  });

  it("meldet Erfolg und setzt das Cookie bei korrektem Passwort", async () => {
    process.env.DASHBOARD_PASSWORD = "korrektes-passwort";
    const { login } = await importAuthActions();
    const formData = new FormData();
    formData.set("password", "korrektes-passwort");

    await expect(login(formData)).rejects.toThrow(RedirectSignal);
    expect(cookieStore.get(AUTH_COOKIE)).toBe(await sha256Hex("korrektes-passwort"));
  });
});
