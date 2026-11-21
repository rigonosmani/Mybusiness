/**
 * odds-sync — scheduled job (Supabase cron / pg_net or an external scheduler).
 * Requires header `x-cron-secret: $CRON_SECRET`. Pulls odds and results from the
 * enabled sports provider and settles finished fixtures.
 */
import { serviceClient } from "../_shared/supabase.ts";
import { runOddsSync } from "../_shared/sports/sync.ts";
import { TheOddsApiProvider } from "../_shared/sports/the-odds-api.ts";

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403 });
  }
  const svc = serviceClient();
  const { data: integration } = await svc.from("api_integrations").select("*").eq("id", "the_odds_api").single();
  if (!integration?.enabled) {
    return Response.json({ status: "skipped", reason: "integration disabled" });
  }
  const provider = new TheOddsApiProvider(Deno.env.get("ODDS_API_KEY"));
  const report = await runOddsSync({
    provider,
    config: integration.config ?? {},
    rpc: async (fn, args) => {
      const { data, error } = await svc.rpc(fn, args);
      if (error) throw new Error(`${fn}: ${error.message}`);
      return data;
    },
  });
  return Response.json(report, { status: report.status === "error" ? 502 : 200 });
});
