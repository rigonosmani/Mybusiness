import "server-only";
import { redirect } from "next/navigation";
import { getSessionProfile, supabaseServer, type AppRole } from "./supabase/server";

export function homeFor(role: AppRole) {
  return role === "super_admin" ? "/super" : role === "admin" ? "/admin" : "/";
}

/** Server-side guard for an area. Enforces role, account status and admin MFA. */
export async function requireArea(role: AppRole) {
  const s = await getSessionProfile();
  if (!s) redirect("/login");
  if (s.profile.status !== "active") redirect("/login?error=suspended");
  if (s.profile.role !== role) redirect(homeFor(s.profile.role));
  if (role !== "player") {
    const sb = await supabaseServer();
    const [{ data: factors }, { data: setting }] = await Promise.all([
      sb.auth.mfa.listFactors(),
      sb.from("platform_settings").select("value").eq("key", "security.require_admin_mfa").maybeSingle(),
    ]);
    const hasFactor = (factors?.totp ?? []).some((f) => f.status === "verified");
    const required = setting?.value === true;
    if ((hasFactor || required) && s.aal !== "aal2") redirect("/mfa");
  }
  return s.profile;
}
