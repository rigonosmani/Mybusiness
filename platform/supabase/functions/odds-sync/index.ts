/**
 * odds-sync — scheduled job (pg_cron + pg_net or any scheduler).
 * Requires header `x-cron-secret: $CRON_SECRET`. The Odds API key is taken from the
 * admin panel (encrypted) or the ODDS_API_KEY secret.
 */
import { serviceClient } from "../_shared/supabase.ts";
import { runConfiguredSync } from "../_shared/sports/run.ts";

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403 });
  }
  const report = await runConfiguredSync(serviceClient());
  return Response.json(report, { status: report.status === "error" ? 502 : 200 });
});
