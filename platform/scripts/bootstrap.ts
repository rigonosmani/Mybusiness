/**
 * One-time bootstrap: creates the Main Administrator (and optionally the demo
 * hierarchy from the specification's test scenarios) through the Supabase
 * Admin API. Run locally with the service-role key — never in a browser.
 *
 *   npm run bootstrap
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_AUTH_EMAIL_DOMAIN,
 *      BOOTSTRAP_OWNER_USERNAME, BOOTSTRAP_OWNER_PASSWORD, BOOTSTRAP_INITIAL_CREDITS (Cr),
 *      BOOTSTRAP_DEMO_ACCOUNTS=true, BOOTSTRAP_DEMO_PASSWORD
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k}`);
  return v;
};
const url = need("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = need("SUPABASE_SERVICE_ROLE_KEY");
const domain = process.env.NEXT_PUBLIC_AUTH_EMAIL_DOMAIN ?? "accounts.kometa.local";
const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

function checkPassword(pw: string) {
  if (pw.length < 10 || !/[a-z]/i.test(pw) || !/\d/.test(pw)) throw new Error("Passwords need 10+ characters with letters and digits");
}

async function authUser(username: string, password: string) {
  checkPassword(password);
  const { data, error } = await sb.auth.admin.createUser({
    email: `${username}@${domain}`, password, email_confirm: true, user_metadata: { username },
  });
  if (error) throw new Error(`createUser ${username}: ${error.message}`);
  return data.user.id;
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

async function main() {
  const { data: existing } = await sb.from("user_roles").select("user_id").eq("role", "super_admin").maybeSingle();
  let ownerId = existing?.user_id as string | undefined;
  if (ownerId) {
    console.log("Main Administrator already exists — skipping.");
  } else {
    const username = process.env.BOOTSTRAP_OWNER_USERNAME ?? "owner";
    const credits = BigInt(process.env.BOOTSTRAP_INITIAL_CREDITS ?? "1000") * 100n;
    ownerId = await authUser(username, need("BOOTSTRAP_OWNER_PASSWORD"));
    await rpc("svc_bootstrap_super_admin", { p_user_id: ownerId, p_username: username, p_display_name: "Main Administrator", p_initial_credits: credits.toString() });
    console.log(`Created Main Administrator "${username}" with ${credits / 100n} demo credits.`);
  }

  if (process.env.BOOTSTRAP_DEMO_ACCOUNTS === "true") {
    const pw = need("BOOTSTRAP_DEMO_PASSWORD");
    const make = async (actor: string, role: "admin" | "player", username: string) => {
      const { data: taken } = await sb.from("profiles").select("id").eq("username", username).maybeSingle();
      if (taken) return taken.id as string;
      const id = await authUser(username, pw);
      await rpc("svc_provision_account", { p_actor: actor, p_actor_aal: "aal2", p_user_id: id, p_role: role, p_username: username, p_display_name: username.toUpperCase() });
      return id;
    };
    const a = await make(ownerId!, "admin", "admin_a");
    const b = await make(ownerId!, "admin", "admin_b");
    await make(a, "player", "player_a1");
    await make(b, "player", "player_b1");
    console.log("Demo hierarchy ready: admin_a → player_a1, admin_b → player_b1 (no credits allocated; use the dashboards).");
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
