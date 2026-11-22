/**
 * Kometa live odds engine — runs every minute.
 *
 *  * Polls a free live-score source only every `poll_minutes` and only while our
 *    football fixtures are in play, so a 100-requests/day plan is enough.
 *  * Re-prices 1X2 and Over/Under every run from the Poisson model (live-model.ts),
 *    moving the match clock forward between polls.
 *  * Suspends a fixture when: a goal was just detected (cool-down), the score data is
 *    too old, the match is near its end, or the match is not in normal play.
 *  * Full-time results reported by the source are passed to the normal settlement.
 */
import { fitRates, isSameMatch, liveMarkets, nameSimilarity, type LiveMarket, type Rates } from "./live-model.ts";
import type { LiveMatch, LivePhase, LiveSource } from "./live-sources.ts";
import type { Rpc } from "./sync.ts";

export interface LiveConfig {
  poll_minutes: number;
  close_minute: number;
  goal_cooldown_seconds: number;
  max_score_age_minutes: number;
  min_requests_remaining: number;
}

export const DEFAULT_LIVE_CONFIG: LiveConfig = {
  poll_minutes: 5,
  close_minute: 88,
  goal_cooldown_seconds: 90,
  max_score_age_minutes: 15,
  min_requests_remaining: 3,
};

export interface LiveTarget {
  fixture_id: string;
  provider: string;
  provider_event_id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  home_score: number | null;
  away_score: number | null;
  live_minute: number | null;
  live_period: LivePhase | null;
  live_source_id: string | null;
  live_updated_at: string | null;
  live_model: Rates | null;
  h2h: { home: number; draw: number; away: number } | null;
  totals: { line: number; over: number; under: number }[];
}

export interface LiveItem {
  fixture_id: string;
  observed: boolean;
  home_score?: number;
  away_score?: number;
  minute?: number | null;
  period?: LivePhase;
  source?: string;
  source_id?: string;
  model?: Rates | null;
  suspend: boolean;
  reason?: string;
  markets: (Omit<LiveMarket, "outcomes"> & { outcomes: LiveMarket["outcomes"] })[];
}

export interface LiveReport {
  status: "idle" | "ok" | "error" | "skipped";
  polled: boolean;
  targets: number;
  matched: number;
  priced: number;
  suspended: number;
  finished: number;
  requests_remaining: number | null;
  errors: string[];
}

/** Current match minute, moving the clock forward since the last observation. */
export function estimateMinute(period: LivePhase | null, minute: number | null, observedAt: string | null, now: Date): number | null {
  if (minute === null || !observedAt) return null;
  if (period === "HT") return 45;
  const elapsed = Math.max(0, (now.getTime() - Date.parse(observedAt)) / 60_000);
  if (period === "1H") return Math.min(47, minute + elapsed);
  if (period === "2H") return Math.min(95, minute + elapsed);
  return minute;
}

/** Pick the source match for a target: same id if already linked, else best name+kick-off match. */
export function findMatch(t: LiveTarget, matches: LiveMatch[]): LiveMatch | undefined {
  if (t.live_source_id) {
    const m = matches.find((x) => x.source_id === t.live_source_id);
    if (m) return m;
  }
  const a = { home: t.home_team, away: t.away_team, kickoff: t.commence_time };
  let best: { m: LiveMatch; s: number } | undefined;
  for (const m of matches) {
    if (!isSameMatch(a, { home: m.home, away: m.away, kickoff: m.kickoff })) continue;
    const s = nameSimilarity(t.home_team, m.home) + nameSimilarity(t.away_team, m.away);
    if (!best || s > best.s) best = { m, s };
  }
  return best?.m;
}

function prematchTotal(totals: LiveTarget["totals"]) {
  const valid = totals.filter((x) => x.over > 1 && x.under > 1 && x.line % 1 === 0.5);
  valid.sort((a, b) => Math.abs(a.line - 2.5) - Math.abs(b.line - 2.5));
  return valid[0] ?? null;
}

export async function runLiveEngine(opts: {
  rpc: Rpc;
  source: LiveSource | null;
  config?: Partial<LiveConfig>;
  now?: Date;
  forcePoll?: boolean;
}): Promise<LiveReport> {
  const cfg: LiveConfig = { ...DEFAULT_LIVE_CONFIG, ...(opts.config ?? {}) };
  const now = opts.now ?? new Date();
  const report: LiveReport = { status: "ok", polled: false, targets: 0, matched: 0, priced: 0, suspended: 0, finished: 0, requests_remaining: null, errors: [] };

  const targets = ((await opts.rpc("svc_live_targets", {})) as LiveTarget[]) ?? [];
  report.targets = targets.length;
  if (!targets.length) {
    report.status = "idle";
    return report;
  }

  // ---- 1. Poll the live-score source when due.
  const fresh = new Map<string, LiveMatch>();
  if (opts.source) {
    const last = ((await opts.rpc("svc_last_sync", { p_integration: "live_engine", p_job: "poll" })) as Record<string, string>)?.live;
    const due = opts.forcePoll || !last || now.getTime() - Date.parse(last) >= cfg.poll_minutes * 60_000 - 5_000;
    if (due) {
      try {
        const { matches, quota } = await opts.source.fetchLive();
        report.polled = true;
        if (quota.remaining !== null) report.requests_remaining = quota.remaining;
        for (const t of targets) {
          const m = findMatch(t, matches);
          if (m) fresh.set(t.fixture_id, m);
        }
        // Linked matches that left the live list near the end: ask for their final score.
        const gone = targets.filter((t) => t.live_source_id && !fresh.has(t.fixture_id)
          && (estimateMinute(t.live_period, t.live_minute, t.live_updated_at, now) ?? 0) >= 80);
        if (gone.length && opts.source.fetchByIds
            && (report.requests_remaining === null || report.requests_remaining > cfg.min_requests_remaining)) {
          const r = await opts.source.fetchByIds(gone.map((t) => t.live_source_id!));
          if (r.quota.remaining !== null) report.requests_remaining = r.quota.remaining;
          for (const t of gone) {
            const m = r.matches.find((x) => x.source_id === t.live_source_id);
            if (m) fresh.set(t.fixture_id, m);
          }
        }
        report.matched = fresh.size;
        await opts.rpc("svc_record_sync", {
          p_integration: "live_engine", p_job: "poll", p_status: "ok", p_items: fresh.size,
          p_requests_remaining: report.requests_remaining, p_requests_used: null, p_error: null,
          p_details: { sport: "live", source: opts.source.id, live_matches: matches.length, matched: fresh.size, targets: targets.length },
        });
      } catch (e) {
        report.errors.push((e as Error).message);
        await opts.rpc("svc_record_sync", {
          p_integration: "live_engine", p_job: "poll", p_status: "error", p_items: 0,
          p_requests_remaining: null, p_requests_used: null, p_error: (e as Error).message, p_details: { source: opts.source.id },
        }).catch(() => {});
      }
    }
  }

  // ---- 2. Price every fixture we have live data for.
  const items: LiveItem[] = [];
  const finals = new Map<string, { event_id: string; completed: boolean; home_score: number; away_score: number; last_update: null }[]>();
  for (const t of targets) {
    const m = fresh.get(t.fixture_id);
    const period: LivePhase | null = m ? m.phase : t.live_period;
    const hg = m ? m.home_goals : t.home_score;
    const ag = m ? m.away_goals : t.away_score;
    const observedAt = m ? now.toISOString() : t.live_updated_at;
    const baseMinute = m ? (m.phase === "HT" ? 45 : m.minute) : t.live_minute;
    if (!period || hg === null || ag === null || !observedAt) continue; // never matched: no live data, no odds

    const item: LiveItem = { fixture_id: t.fixture_id, observed: !!m, suspend: false, markets: [] };
    if (m) Object.assign(item, { home_score: hg, away_score: ag, minute: baseMinute, period, source: opts.source?.id, source_id: m.source_id });

    let model = t.live_model;
    if (!model && t.h2h && t.h2h.home > 1 && t.h2h.draw > 1 && t.h2h.away > 1) {
      model = fitRates({ ...t.h2h, total: prematchTotal(t.totals) });
      item.model = model;
    }

    const minute = estimateMinute(period, baseMinute, observedAt, now);
    const ageMin = (now.getTime() - Date.parse(observedAt)) / 60_000;
    if (period === "FT") {
      item.suspend = true; item.reason = "finished";
      if (m?.final) {
        const list = finals.get(t.provider) ?? [];
        list.push({ event_id: t.provider_event_id, completed: true, home_score: m.final.home, away_score: m.final.away, last_update: null });
        finals.set(t.provider, list);
      }
    } else if (period === "OTHER") { item.suspend = true; item.reason = "not_in_play"; }
    else if (!model) { item.suspend = true; item.reason = "no_prematch_odds"; }
    else if (minute === null) { item.suspend = true; item.reason = "no_clock"; }
    else if (ageMin > cfg.max_score_age_minutes) { item.suspend = true; item.reason = "score_stale"; }
    else if (minute >= cfg.close_minute) { item.suspend = true; item.reason = "closing"; }

    if (!item.suspend && model && minute !== null) {
      item.markets = liveMarkets({
        rates: model, minute, homeGoals: hg, awayGoals: ag,
        homeLabel: t.home_team, awayLabel: t.away_team,
        extraLines: t.totals.map((x) => x.line),
      });
      report.priced++;
    } else report.suspended++;
    items.push(item);
  }

  if (items.length) {
    await opts.rpc("svc_apply_live", { p_items: items, p_goal_cooldown_seconds: cfg.goal_cooldown_seconds });
  }
  for (const [provider, scores] of finals) {
    const r = (await opts.rpc("svc_update_scores", { p_provider: provider, p_scores: scores })) as { updated: number };
    report.finished += r?.updated ?? 0;
  }
  if (report.errors.length && !report.priced) report.status = "error";
  return report;
}
