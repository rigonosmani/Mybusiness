/**
 * admin-integrations — Main Admin only.
 *   POST { action: "set_secret", integration, name, value }   value "" removes the secret
 *   POST { action: "sync_odds" }                               run the sports sync now
 *   POST { action: "sync_live" }                               run Kometa Live now (polls the score source)
 * Secrets are encrypted in the database with INTEGRATION_SECRETS_KEY (Edge secret).
 */
import { corsHeaders, errorCode, json, statusFor } from "../_shared/http.ts";
import { requireCaller, serviceClient } from "../_shared/supabase.ts";
import { secretsKey } from "../_shared/secrets.ts";
import { runConfiguredSync } from "../_shared/sports/run.ts";
import { runConfiguredLive } from "../_shared/sports/live-run.ts";

const ALLOWED_NAMES = new Set(["api_key", "callback_secret"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "METHOD_NOT_ALLOWED" });
  const svc = serviceClient();
  try {
    const caller = await requireCaller(req);
    const { error: authErr } = await svc.rpc("svc_require_super_admin", { p_actor: caller.id, p_aal: caller.aal });
    if (authErr) throw new Error(authErr.message);
    await svc.rpc("svc_rate_limit", { p_bucket: `admin-integrations:${caller.id}`, p_limit: 20, p_window_seconds: 60 });
    const body = await req.json().catch(() => ({}));

    if (body.action === "set_secret") {
      if (!ALLOWED_NAMES.has(body.name)) return json(req, 400, { error: "INVALID_PARAMS" });
      const key = secretsKey();
      if (!key) return json(req, 400, { error: "SECRETS_KEY_NOT_CONFIGURED" });
      const { data, error } = await svc.rpc("svc_set_integration_secret", {
        p_actor: caller.id, p_aal: caller.aal, p_integration: String(body.integration ?? ""), p_name: body.name,
        p_value: typeof body.value === "string" ? body.value : "", p_key: key,
      });
      if (error) throw new Error(error.message);
      return json(req, 200, data);
    }

    if (body.action === "sync_odds") {
      return json(req, 200, await runConfiguredSync(svc, { force: true }));
    }
    if (body.action === "sync_live") {
      return json(req, 200, await runConfiguredLive(svc, { forcePoll: true }));
    }
    return json(req, 400, { error: "UNKNOWN_ACTION" });
  } catch (e) {
    const code = errorCode(e);
    return json(req, statusFor(code), { error: code });
  }
});
