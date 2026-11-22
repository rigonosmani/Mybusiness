import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";
import { integrationSecret } from "../secrets.ts";
import { runOddsSync, type SyncReport } from "./sync.ts";
import { TheOddsApiProvider } from "./the-odds-api.ts";

/** Runs the odds/results sync for The Odds API using DB config + panel/env key. */
export async function runConfiguredSync(svc: SupabaseClient, opts: { force?: boolean } = {}): Promise<SyncReport | { status: "skipped"; reason: string }> {
  const { data: integration } = await svc.from("api_integrations").select("*").eq("id", "the_odds_api").single();
  if (!integration?.enabled) return { status: "skipped", reason: "integration disabled" };
  const key = await integrationSecret(svc, "the_odds_api", "api_key", "ODDS_API_KEY");
  const config = { ...(integration.config ?? {}) };
  if (opts.force) {
    config.odds_interval_minutes = 0;
    config.scores_interval_minutes = 0;
  }
  return runOddsSync({
    provider: new TheOddsApiProvider(key),
    config,
    rpc: async (fn, args) => {
      const { data, error } = await svc.rpc(fn, args);
      if (error) throw new Error(`${fn}: ${error.message}`);
      return data;
    },
  });
}
