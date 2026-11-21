import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server-component client bound to the request's session cookies (anon key; RLS applies). */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component: the middleware refreshes cookies instead.
        }
      },
    },
  });
}

export type AppRole = "super_admin" | "admin" | "player";

export interface SessionProfile {
  id: string;
  username: string;
  display_name: string;
  role: AppRole;
  status: string;
  tenant_id: string | null;
  locale: "sq" | "en";
}

/** Current user + profile, or null. Uses getUser() which re-validates the JWT with Auth. */
export async function getSessionProfile(): Promise<{ profile: SessionProfile; aal: string | null } | null> {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb.from("profiles").select("id, username, display_name, role, status, tenant_id, locale").eq("id", user.id).single();
  if (!profile) return null;
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  return { profile: profile as SessionProfile, aal: aal?.currentLevel ?? null };
}
