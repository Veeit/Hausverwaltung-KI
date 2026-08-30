import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, sha256Hex } from "@/lib/auth";

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const expected = await sha256Hex(process.env.DASHBOARD_PASSWORD ?? "");
  const cookieValue = request.cookies.get(AUTH_COOKIE)?.value;
  if (cookieValue === expected) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!login|_next|favicon.ico).*)"],
};
