/**
 * casino-launch — player opens an external (licensed aggregator) game.
 *   POST { game_id }  →  { url }   (the URL is shown in an iframe)
 * The session is created as the player (RLS + limits + status apply), then the
 * aggregator is called server-to-server with the panel-configured API key.
 */
import { corsHeaders, errorCode, json, statusFor } from "../_shared/http.ts";
import { requireCaller, serviceClient, userClient } from "../_shared/supabase.ts";
import { integrationSecret } from "../_shared/secrets.ts";
import { buildLaunchRequest, parseLaunchResponse, type LaunchContext } from "../_shared/casino/generic-aggregator.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "METHOD_NOT_ALLOWED" });
  const svc = serviceClient();
  try {
    const caller = await requireCaller(req);
    await svc.rpc("svc_rate_limit", { p_bucket: `launch:${caller.id}`, p_limit: 20, p_window_seconds: 60 });
    const { game_id } = await req.json().catch(() => ({}));
    const { data: session, error } = await userClient(caller.jwt).rpc("casino_create_session", { p_game_id: String(game_id ?? "") });
    if (error) throw new Error(error.message);
    const { data: ctx, error: ctxErr } = await svc.rpc("svc_launch_context", { p_session: session.session_id });
    if (ctxErr || !ctx) throw new Error(ctxErr?.message ?? "SESSION_INVALID");
    const apiKey = await integrationSecret(svc, ctx.provider_id, "api_key", `PROVIDER_API_KEY_${String(ctx.provider_id).toUpperCase()}`);
    if (!apiKey || !ctx.api_base_url) return json(req, 400, { error: "PROVIDER_NOT_CONFIGURED" });
    const origin = req.headers.get("origin") ?? "";
    const request = await buildLaunchRequest(ctx as LaunchContext, session.launch_token, apiKey, { returnUrl: `${origin}/casino` });
    const res = await fetch(request.url, request.init);
    if (!res.ok) return json(req, 502, { error: "PROVIDER_ERROR", status: res.status });
    const url = parseLaunchResponse(await res.json(), (ctx.config ?? {}).launch_url_field);
    return json(req, 200, { url });
  } catch (e) {
    const code = errorCode(e);
    if (code === "INTERNAL_ERROR") console.error("casino-launch:", (e as Error)?.message ?? e);
    return json(req, statusFor(code), { error: code });
  }
});
