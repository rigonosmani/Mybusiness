/**
 * live-engine — scheduled every minute (pg_cron + pg_net).
 * Requires header `x-cron-secret: $CRON_SECRET`. Re-prices in-play football from the
 * live-score source configured in the admin panel; does nothing when no match is live.
 */
import { serviceClient } from "../_shared/supabase.ts";
import { runConfiguredLive } from "../_shared/sports/live-run.ts";

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403 });
  }
  try {
    const report = await runConfiguredLive(serviceClient());
    return Response.json(report, { status: report.status === "error" ? 502 : 200 });
  } catch (e) {
    return Response.json({ status: "error", error: (e as Error).message }, { status: 500 });
  }
});
