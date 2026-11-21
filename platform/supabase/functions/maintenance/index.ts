/** maintenance — scheduled: suspicious-activity detection, stale-market suspension. */
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  const svc = serviceClient();
  const alerts = await svc.rpc("svc_detect_suspicious_activity");
  const suspended = await svc.rpc("svc_suspend_stale_markets");
  return Response.json({ alerts: alerts.data, suspended: suspended.data, errors: [alerts.error?.message, suspended.error?.message].filter(Boolean) });
});
