import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";

/** Encryption key for secrets saved from the admin panel. Lives only in Edge Function secrets. */
export function secretsKey(): string | undefined {
  const k = Deno.env.get("INTEGRATION_SECRETS_KEY");
  return k && k.length >= 32 ? k : undefined;
}

/** Secret from the admin panel (encrypted in DB), falling back to an Edge Function env var. */
export async function integrationSecret(svc: SupabaseClient, integration: string, name: string, envName?: string) {
  const key = secretsKey();
  if (key) {
    const { data } = await svc.rpc("svc_get_integration_secret", { p_integration: integration, p_name: name, p_key: key });
    if (typeof data === "string" && data) return data;
  }
  return envName ? Deno.env.get(envName) ?? undefined : undefined;
}
