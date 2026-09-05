import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { AUTH_COOKIE, sha256Hex } from "@/lib/auth";
import { config, proxy } from "@/proxy";

const ORIGINAL_DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

function restoreEnv(): void {
  if (ORIGINAL_DASHBOARD_PASSWORD === undefined) {
    delete process.env.DASHBOARD_PASSWORD;
  } else {
    process.env.DASHBOARD_PASSWORD = ORIGINAL_DASHBOARD_PASSWORD;
  }
}

function requestWithCookie(cookieValue: string | undefined): NextRequest {
  const headers = new Headers();
  if (cookieValue !== undefined) {
    headers.set("cookie", `${AUTH_COOKIE}=${cookieValue}`);
  }
  // Geschützt ist nur noch /app — deshalb prüft der Test einen echten
  // Dashboard-Pfad statt der (öffentlichen) Wurzel.
  return new NextRequest("http://localhost/app/vorgaenge", { headers });
}

/** Pfad des Location-Headers einer Weiterleitung. */
function redirectPath(response: Response): string {
  return new URL(response.headers.get("location") ?? "").pathname;
}

describe("proxy (Zugriffsschutz, fail-closed)", () => {
  afterEach(restoreEnv);

  it(
    "verweigert Zugriff, wenn DASHBOARD_PASSWORD leer ist, selbst mit dem " +
      "Cookie-Wert sha256('') — der Reviewer-Reproduktionsfall (Befund 1, Critical)",
    async () => {
      process.env.DASHBOARD_PASSWORD = "";
      const publiclyKnownEmptyHash = await sha256Hex("");
      // Bekannter konstanter Wert, den jeder ohne Passwortkenntnis kennt:
      expect(publiclyKnownEmptyHash).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );

      const request = requestWithCookie(publiclyKnownEmptyHash);
      const response = await proxy(request);

      expect(response.status).not.toBe(200);
      expect(redirectPath(response)).toBe("/");
    },
  );

  it("verweigert Zugriff, wenn DASHBOARD_PASSWORD nicht gesetzt ist (undefined)", async () => {
    delete process.env.DASHBOARD_PASSWORD;
    const publiclyKnownEmptyHash = await sha256Hex("");

    const request = requestWithCookie(publiclyKnownEmptyHash);
    const response = await proxy(request);

    expect(response.status).not.toBe(200);
    expect(redirectPath(response)).toBe("/");
  });

  it("verweigert Zugriff ganz ohne Cookie, wenn DASHBOARD_PASSWORD leer ist", async () => {
    process.env.DASHBOARD_PASSWORD = "";
    const request = requestWithCookie(undefined);
    const response = await proxy(request);

    expect(response.status).not.toBe(200);
    expect(redirectPath(response)).toBe("/");
  });

  it("lässt den Zugriff mit korrektem Cookie zu, wenn ein Passwort konfiguriert ist", async () => {
    process.env.DASHBOARD_PASSWORD = "korrektes-passwort";
    const hash = await sha256Hex("korrektes-passwort");
    const request = requestWithCookie(hash);
    const response = await proxy(request);

    // NextResponse.next() liefert Status 200 und leitet nicht um.
    expect(response.status).toBe(200);
  });

  it("verweigert Zugriff mit falschem Cookie, wenn ein Passwort konfiguriert ist", async () => {
    process.env.DASHBOARD_PASSWORD = "korrektes-passwort";
    const request = requestWithCookie(await sha256Hex("falsches-passwort"));
    const response = await proxy(request);

    expect(response.status).not.toBe(200);
    expect(redirectPath(response)).toBe("/");
  });

  it("leitet Nichtangemeldete auf die Landingpage, nicht auf das Passwortfeld", async () => {
    process.env.DASHBOARD_PASSWORD = "korrektes-passwort";
    const response = await proxy(requestWithCookie(undefined));

    // Der Einstieg ist die Landingpage: Wer ohne Zugang auf einen
    // Dashboard-Link stösst, soll erst erfahren, worum es geht. Das
    // Passwortfeld auf /login erreicht er von dort aus.
    expect(response.status).not.toBe(200);
    expect(redirectPath(response)).toBe("/");
    expect(redirectPath(response)).not.toBe("/login");
  });
});

describe("proxy (Geltungsbereich)", () => {
  it("schützt /app und alles darunter", () => {
    expect(config.matcher).toContain("/app");
    expect(config.matcher).toContain("/app/:path*");
  });

  it("lässt Landingpage und Anmeldeseite öffentlich", () => {
    // Ein Muster, das auf "/" oder "/login" passt, würde die öffentliche
    // Seite hinter das Passwort sperren — genau das soll dieser Umbau nicht.
    for (const muster of config.matcher) {
      expect(muster.startsWith("/app")).toBe(true);
    }
  });
});
