import "server-only";
import { createClient } from "@supabase/supabase-js";

// Bypasses RLS entirely — only ever import this from server-side code
// (Route Handlers). The `server-only` import above makes it a build
// error to accidentally pull this into a "use client" component.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});
