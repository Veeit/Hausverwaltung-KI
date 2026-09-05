import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, getExpectedAuthCookie } from "@/lib/auth";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // fail-closed: Ist kein brauchbares Passwort konfiguriert, liefert
  // getExpectedAuthCookie `null` statt sha256(""). Damit kann kein Cookie-Wert
  // jemals passen, egal was der Client mitschickt.
  const expected = await getExpectedAuthCookie(process.env.DASHBOARD_PASSWORD);
  const cookieValue = request.cookies.get(AUTH_COOKIE)?.value;
  if (expected !== null && cookieValue === expected) {
    return NextResponse.next();
  }
  // Ziel ist die öffentliche Landingpage, nicht mehr /login: Wer ohne Zugang
  // auf einen Dashboard-Link stößt, bekommt zuerst zu sehen, worum es geht.
  // Das Passwortfeld erreicht er von dort über "Ich habe bereits Zugang".
  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  // Geschützt ist ausschliesslich das Dashboard unter /app. Alles andere —
  // Produktseite, Anmeldeseite, Framework-Assets — ist öffentlich, deshalb
  // reicht hier ein positiver Pfadabgleich statt der früheren
  // Ausschlussliste. Server Actions der Dashboard-Seiten laufen als POST auf
  // denselben /app-Pfaden und sind damit ebenfalls erfasst.
  //
  // Damit entfällt auch die frühere Einzelausnahme für "api/health": Der
  // Endpunkt liegt ausserhalb von /app und ist ohne Anmeldung erreichbar,
  // wie Docker-HEALTHCHECK und die Rauchprobe der CI es brauchen.
  matcher: ["/app", "/app/:path*"],
};
