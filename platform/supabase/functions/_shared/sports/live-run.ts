import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";
import { integrationSecret } from "../secrets.ts";
import { runLiveEngine, type LiveReport } from "./live.ts";
import { ApiFootballLive, FootballDataLive, type LiveSource } from "./live-sources.ts";

/** Picks the live-score source whose key was entered in the admin panel. */
async function configuredSource(svc: SupabaseClient, wanted: string): Promise<LiveSource | null> {
  if (wanted === "auto" || wanted === "api_sports") {
    const k = await integrationSecret(svc, "api_sports", "api_key", "API_FOOTBALL_KEY");
    if (k) return new ApiFootballLive(k);
  }
  if (wanted === "auto" || wanted === "football_data") {
    const k = await integrationSecret(svc, "football_data", "api_key", "FOOTBALL_DATA_KEY");
    if (k) return new FootballDataLive(k);
  }
  return null;
}

export async function runConfiguredLive(svc: SupabaseClient, opts: { forcePoll?: boolean } = {}): Promise<LiveReport | { status: "skipped"; reason: string }> {
  const { data: integration } = await svc.from("api_integrations").select("*").eq("id", "live_engine").single();
  if (!integration?.enabled) return { status: "skipped", reason: "Kometa Live is disabled" };
  const config = (integration.config ?? {}) as Record<string, unknown>;
  const source = await configuredSource(svc, String(config.source ?? "auto"));
  return runLiveEngine({
    source,
    config: config as never,
    forcePoll: opts.forcePoll,
    rpc: async (fn, args) => {
      const { data, error } = await svc.rpc(fn, args);
      if (error) throw new Error(`${fn}: ${error.message}`);
      return data;
    },
  });
}
