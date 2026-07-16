import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isValidSessionToken, SESSION_COOKIE_NAME } from "@/lib/adminAuth";

// Named "proxy.ts", not "middleware.ts" — this Next.js version (16)
// deprecated the middleware.ts convention in favour of proxy.ts /
// export function proxy. See node_modules/next/dist/docs/.../proxy.md.
//
// Also gates /api/admin/* (except auth/logout, which establish/clear
// the session and must stay reachable without one). This is the real
// enforcement boundary for admin data — /api/admin/payments/* uses
// the service_role key server-side, so this cookie check is the only
// thing standing between that data and the public internet.
const PUBLIC_ADMIN_PATHS = ["/admin/login", "/api/admin/auth", "/api/admin/logout"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_ADMIN_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!isValidSessionToken(token)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
