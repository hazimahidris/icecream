import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { STAFF_ALLOWED_PREFIXES, isStaffAllowedPage } from "@/lib/staffAccess";

// Named "proxy.ts", not "middleware.ts" — this Next.js version (16)
// deprecated the middleware.ts convention in favour of proxy.ts /
// export function proxy. See node_modules/next/dist/docs/.../proxy.md.
// (The user's spec for this task said "middleware.ts" — that file
// wouldn't be picked up by this Next.js version, so this replaces
// the *existing* proxy.ts instead, same as every other gate in this
// project.)
//
// Replaces the single shared ADMIN_PASSWORD cookie gate with
// per-request Supabase Auth + role-based access:
//   - No valid session -> redirect to /admin/login (pages) or 401 (API)
//   - No staff_users row, or is_active = false -> same as no session
//     (an Auth account can exist without being provisioned as staff)
//   - role = 'staff' and path outside the allowlist below -> redirect
//     to /admin/pos (pages) or 403 (API)
//   - role = 'admin' -> unrestricted
//
// The staff allowlist is enforced here for BOTH /admin/* pages and
// /api/admin/* routes, so a staff account can't reach a restricted
// API directly even if they know the URL — the page never being
// rendered isn't real protection on its own.
const PUBLIC_ADMIN_PATHS = ["/admin/login", "/admin/reset-password"];

// API equivalent of the page prefixes in lib/staffAccess.ts, plus the
// low-stock bell endpoint (a shared UI element on every admin page
// staff can reach, not sensitive data).
const STAFF_ALLOWED_API_PREFIXES = [
  ...STAFF_ALLOWED_PREFIXES.map((p) => p.replace("/admin/", "/api/admin/")),
  "/api/admin/alerts",
];

function isStaffAllowed(pathname: string): boolean {
  if (pathname.startsWith("/api/")) {
    return STAFF_ALLOWED_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  }
  return isStaffAllowedPage(pathname);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith("/api/");

  function deny(status: 401 | 403, message: string) {
    if (isApi) {
      return NextResponse.json({ error: message }, { status });
    }
    if (status === 403) {
      const url = new URL("/admin/pos", request.url);
      url.searchParams.set("denied", "1");
      return NextResponse.redirect(url);
    }
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() (not getSession()) — revalidates the JWT against the
  // Auth server rather than trusting a decoded cookie value.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return deny(401, "Unauthorized");
  }

  const { data: staffUser } = await supabase
    .from("staff_users")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (!staffUser || !staffUser.is_active) {
    return deny(401, "Unauthorized");
  }

  if (staffUser.role === "staff" && !isStaffAllowed(pathname)) {
    return deny(403, "You do not have permission to access this page.");
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
