import { NextRequest } from "next/server";
// Next kompiliert config.matcher nicht als rohen JS-Regex-String, sondern als
// path-to-regexp-Muster (vollstaendig verankert, mit optionalem
// Trailing-Slash am Ende) - genau dieselbe Funktion nutzt Next intern beim
// Build, um aus dem Matcher-String den tatsaechlichen Abgleich-Regex zu
// erzeugen. tryToParsePath direkt zu nutzen bildet also nach, wie Next
// "/((?!login$|api/health$|...).*)" wirklich anwendet - ein naives
// `new RegExp(matcher)` waere NICHT verankert und wuerde jeden mit "/"
// beginnenden Pfad faelschlich matchen.
import { tryToParsePath } from "next/dist/lib/try-to-parse-path";
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
  return new NextRequest("http://localhost/", { headers });
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
      expect(response.headers.get("location")).toContain("/login");
    },
  );

  it("verweigert Zugriff, wenn DASHBOARD_PASSWORD nicht gesetzt ist (undefined)", async () => {
    delete process.env.DASHBOARD_PASSWORD;
    const publiclyKnownEmptyHash = await sha256Hex("");

    const request = requestWithCookie(publiclyKnownEmptyHash);
    const response = await proxy(request);

    expect(response.status).not.toBe(200);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("verweigert Zugriff ganz ohne Cookie, wenn DASHBOARD_PASSWORD leer ist", async () => {
    process.env.DASHBOARD_PASSWORD = "";
    const request = requestWithCookie(undefined);
    const response = await proxy(request);

    expect(response.status).not.toBe(200);
    expect(response.headers.get("location")).toContain("/login");
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
    expect(response.headers.get("location")).toContain("/login");
  });
});

describe("proxy config.matcher (entscheidet, welche Pfade den Proxy ueberhaupt durchlaufen)", () => {
  const { regexStr } = tryToParsePath(config.matcher[0]);
  if (regexStr === undefined) {
    throw new Error("config.matcher[0] liess sich nicht als Next-Pfadmuster parsen");
  }
  const matcherRegex = new RegExp(regexStr);

  function matches(path: string): boolean {
    return matcherRegex.test(path);
  }

  it.each([
    // [Pfad, laeuft durch den Proxy (true = geschuetzt), Beschreibung]
    ["/api/health", false, "Health-Endpunkt ist ausgenommen"],
    ["/login", false, "Login-Seite ist ausgenommen"],
    ["/favicon.ico", false, "Favicon ist ausgenommen"],
    ["/_next/static/chunk.js", false, "Next-Framework-Assets sind ausgenommen"],
    ["/api/healthz", true, "aehnlicher, aber anderer Pfad bleibt geschuetzt"],
    ["/api/health/", true, "Trailing Slash ist NICHT derselbe Pfad wie api/health"],
    ["/api/health/secret", true, "Unterpfad von api/health bleibt geschuetzt"],
    ["/loginXYZ", true, "Pfad, der nur mit 'login' BEGINNT, bleibt geschuetzt"],
    ["/login/admin", true, "Unterpfad von /login bleibt geschuetzt"],
    ["/", true, "Startseite ist geschuetzt"],
    ["/vorgaenge", true, "Dashboard-Seite ist geschuetzt"],
    ["/vorgaenge/1", true, "Detailseite ist geschuetzt"],
  ])("%s -> geschuetzt=%s (%s)", (path, protected_) => {
    expect(matches(path)).toBe(protected_);
  });
});
