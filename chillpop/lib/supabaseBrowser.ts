import { createBrowserClient } from "@supabase/ssr";

// Admin-side client only — stores the session in cookies (not
// localStorage, unlike lib/supabase.ts) so proxy.ts can read it on
// every request. The public customer site (lib/supabase.ts) doesn't
// need this and is left untouched.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabaseBrowser = createBrowserClient(supabaseUrl, supabaseAnonKey);
