import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";

const url = () => Deno.env.get("SUPABASE_URL")!;

/** Service-role client. Never leaves the Edge runtime. */
export function serviceClient(): SupabaseClient {
  return createClient(url(), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Client acting as the caller (RLS and RPC authorization apply). */
export function userClient(jwt: string): SupabaseClient {
  return createClient(url(), Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

export interface Caller {
  id: string;
  aal: string;
  jwt: string;
}

/** Verifies the bearer token with Supabase Auth and returns the caller. */
export async function requireCaller(req: Request): Promise<Caller> {
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) throw new Error("NOT_AUTHENTICATED");
  const { data, error } = await serviceClient().auth.getUser(jwt);
  if (error || !data.user) throw new Error("NOT_AUTHENTICATED");
  // The token was just validated by Auth; read the assurance level claim.
  const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  return { id: data.user.id, aal: payload.aal ?? "aal1", jwt };
}
