/**
 * Odds/results synchronisation job. Pure logic with injected dependencies so
 * it can be unit-tested; the `odds-sync` Edge Function wires in the real
 * provider and a service-role Supabase client.
 *
 * Free API tiers are tiny (The Odds API free plan: 500 credits/month), so the
 * job is budget-aware:
 *   * each league's odds are fetched at most every `odds_interval_minutes`
 *   * scores are only requested for leagues with started, unfinished fixtures
 *   * the job stops when the remaining quota falls below `min_requests_remaining`
 */
import type { OddsProvider } from "./types.ts";
import { ProviderNotConfiguredError } from "./types.ts";

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export interface SyncConfig {
  sports: string[];
  regions: string;
  markets: string;
  odds_interval_minutes: number;
  scores_interval_minutes: number;
  days_from: number;
  min_requests_remaining: number;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  sports: ["soccer_epl", "basketball_nba"],
  regions: "eu",
  markets: "h2h,totals",
  odds_interval_minutes: 720,
  scores_interval_minutes: 60,
  days_from: 2,
  min_requests_remaining: 25,
};

export interface SyncReport {
  status: "ok" | "skipped" | "error";
  leagues_synced: string[];
  scores_checked: string[];
  fixtures: number;
  bets_settled: number;
  suspended: number;
  requests_remaining: number | null;
  errors: string[];
}

export async function runOddsSync(opts: {
  provider: OddsProvider;
  rpc: Rpc;
  config: Partial<SyncConfig>;
  now?: Date;
}): Promise<SyncReport> {
  const cfg: SyncConfig = { ...DEFAULT_SYNC_CONFIG, ...opts.config };
  const now = opts.now ?? new Date();
  const report: SyncReport = {
    status: "ok", leagues_synced: [], scores_checked: [], fixtures: 0, bets_settled: 0, suspended: 0,
    requests_remaining: null, errors: [],
  };
  const integration = opts.provider.id;
  const budgetOk = () => report.requests_remaining === null || report.requests_remaining > cfg.min_requests_remaining;

  const log = (job: string, status: string, items: number, error: string | null, details: Record<string, unknown>) =>
    opts.rpc("svc_record_sync", {
      p_integration: integration, p_job: job, p_status: status, p_items: items,
      p_requests_remaining: report.requests_remaining, p_requests_used: null, p_error: error, p_details: details,
    });

  try {
    // "*" = every active league the provider lists (listing is free); outright-only markets are skipped.
    let leagues = cfg.sports;
    if (leagues.includes("*")) {
      const listed = await opts.provider.listLeagues();
      leagues = listed.leagues.filter((l) => l.active && !l.has_outrights).map((l) => l.key);
    }
    const lastOdds = (await opts.rpc("svc_last_sync", { p_integration: integration, p_job: "odds" })) as Record<string, string>;
    for (const league of leagues) {
      const last = lastOdds?.[league] ? Date.parse(lastOdds[league]) : 0;
      if (now.getTime() - last < cfg.odds_interval_minutes * 60_000) continue;
      if (!budgetOk()) {
        report.errors.push(`budget: skipped odds for ${league}`);
        continue;
      }
      try {
        const { events, quota } = await opts.provider.fetchOdds(league, { regions: cfg.regions, markets: cfg.markets });
        if (quota.remaining !== null) report.requests_remaining = quota.remaining;
        const r = (await opts.rpc("svc_upsert_odds", { p_provider: integration, p_events: events })) as { fixtures: number };
        report.fixtures += r?.fixtures ?? 0;
        report.leagues_synced.push(league);
        await log("odds", "ok", events.length, null, { sport: league });
      } catch (e) {
        if (e instanceof ProviderNotConfiguredError) throw e;
        report.errors.push(`${league}: ${(e as Error).message}`);
        await log("odds", "error", 0, (e as Error).message, { sport: league });
      }
    }

    const lastScores = (await opts.rpc("svc_last_sync", { p_integration: integration, p_job: "scores" })) as Record<string, string>;
    const awaiting = ((await opts.rpc("svc_fixtures_awaiting_results", { p_provider: integration })) as string[]) ?? [];
    for (const league of awaiting) {
      const last = lastScores?.[league] ? Date.parse(lastScores[league]) : 0;
      if (now.getTime() - last < cfg.scores_interval_minutes * 60_000) continue;
      if (!budgetOk()) {
        report.errors.push(`budget: skipped scores for ${league}`);
        continue;
      }
      try {
        const { scores, quota } = await opts.provider.fetchScores(league, cfg.days_from);
        if (quota.remaining !== null) report.requests_remaining = quota.remaining;
        const r = (await opts.rpc("svc_update_scores", { p_provider: integration, p_scores: scores })) as { bets_settled: number };
        report.bets_settled += r?.bets_settled ?? 0;
        report.scores_checked.push(league);
        await log("scores", "ok", scores.length, null, { sport: league });
      } catch (e) {
        if (e instanceof ProviderNotConfiguredError) throw e;
        report.errors.push(`${league} scores: ${(e as Error).message}`);
        await log("scores", "error", 0, (e as Error).message, { sport: league });
      }
    }

    report.suspended = ((await opts.rpc("svc_suspend_stale_markets", {})) as number) ?? 0;
    if (report.errors.length && !report.leagues_synced.length && !report.scores_checked.length) report.status = "error";
    await log("run", report.status === "error" ? "error" : "ok", report.fixtures, report.errors.join("; ") || null, {
      leagues: report.leagues_synced, scores: report.scores_checked,
    });
  } catch (e) {
    report.status = e instanceof ProviderNotConfiguredError ? "skipped" : "error";
    report.errors.push((e as Error).message);
    await log("run", report.status, 0, (e as Error).message, {}).catch(() => {});
  }
  return report;
}
