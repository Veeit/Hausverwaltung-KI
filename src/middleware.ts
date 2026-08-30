import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, getExpectedAuthCookie } from "@/lib/auth";

export async function middleware(request: NextRequest): Promise<NextResponse> {
  // fail-closed: Ist kein brauchbares Passwort konfiguriert, liefert
  // getExpectedAuthCookie `null` statt sha256(""). Damit kann kein Cookie-Wert
  // jemals passen, egal was der Client mitschickt.
  const expected = await getExpectedAuthCookie(process.env.DASHBOARD_PASSWORD);
  const cookieValue = request.cookies.get(AUTH_COOKIE)?.value;
  if (expected !== null && cookieValue === expected) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Exakter Pfadabgleich statt Präfix-Lookahead: "login" und "favicon.ico"
  // schliessen nur den jeweils exakten Pfad aus, "_next/" nur echte
  // Framework-Assets. Vorher schloss z.B. "login" jeden mit "login"
  // BEGINNENDEN Pfad aus (z.B. "/loginXYZ", "/login-admin") von der
  // Middleware aus, wodurch diese Pfade nie geprüft wurden.
  matcher: ["/((?!login$|_next(?:/|$)|favicon\\.ico$).*)"],
};
