import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// For Route Handlers / Server Components that need to know the
// signed-in user's own session (respects RLS as that user — this is
// NOT the service-role client). Must be created fresh per request
// since it reads the request's cookies.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a context where cookies can't be written
            // (e.g. a Server Component render) — proxy.ts already
            // refreshes the session cookie on every request, so this
            // is safe to ignore here.
          }
        },
      },
    }
  );
}
