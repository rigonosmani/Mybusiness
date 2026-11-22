"use client";
import { supabaseBrowser } from "./supabase/client";

export interface Outcome { id: string; outcome_key: string; label: string; point: number | null; offered_odds: number | string; status: string; result: string }
export interface Market { id: string; market_key: string; line: number | null; status: string; last_odds_at: string | null; bookmaker_count: number; market_outcomes: Outcome[] }
export interface Fixture {
  id: string; home_team: string; away_team: string; commence_time: string; status: string;
  home_score: number | null; away_score: number | null; last_odds_at: string | null;
  live_minute?: number | null; live_period?: string | null; live_updated_at?: string | null; live_suspended_until?: string | null;
  leagues: { id: string; name: string; sport_id: string };
  betting_markets: Market[];
}

const FIXTURE_SELECT = `id, home_team, away_team, commence_time, status, home_score, away_score, last_odds_at,
  live_minute, live_period, live_updated_at, live_suspended_until,
  leagues!inner(id, name, sport_id),
  betting_markets(id, market_key, line, status, last_odds_at, bookmaker_count,
    market_outcomes(id, outcome_key, label, point, offered_odds, status, result))`;

export async function fetchFixtures(opts: { live?: boolean; sport?: string; league?: string; q?: string; limit?: number }) {
  const sb = supabaseBrowser();
  let q = sb.from("fixtures").select(FIXTURE_SELECT).order("commence_time").limit(opts.limit ?? 200);
  if (opts.live) q = q.eq("status", "live");
  else q = q.eq("status", "scheduled").gt("commence_time", new Date().toISOString());
  if (opts.sport) q = q.eq("leagues.sport_id", opts.sport);
  if (opts.league) q = q.eq("league_id", opts.league);
  if (opts.q) {
    const term = opts.q.replace(/[%,()]/g, " ").trim();
    q = q.or(`home_team.ilike.%${term}%,away_team.ilike.%${term}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as Fixture[];
}

export async function fetchFixture(id: string) {
  const { data, error } = await supabaseBrowser().from("fixtures").select(FIXTURE_SELECT).eq("id", id).single();
  if (error) throw error;
  return data as unknown as Fixture;
}

export async function fetchSportsTree() {
  const sb = supabaseBrowser();
  const [{ data: sports }, { data: leagues }] = await Promise.all([
    sb.from("sports").select("id, name, sort_order").eq("active", true).order("sort_order"),
    sb.from("leagues").select("id, name, sport_id, country").eq("active", true).order("name"),
  ]);
  return { sports: sports ?? [], leagues: leagues ?? [] };
}

export async function fetchFreshness() {
  const { data } = await supabaseBrowser().from("platform_settings").select("key, value")
    .in("key", ["sportsbook.prematch_odds_max_age_seconds", "sportsbook.live_odds_max_age_seconds", "sportsbook.live_betting_enabled"]);
  const get = (k: string) => data?.find((r) => r.key === k)?.value;
  return {
    prematch: Number(get("sportsbook.prematch_odds_max_age_seconds") ?? 46800),
    live: Number(get("sportsbook.live_odds_max_age_seconds") ?? 30),
    liveEnabled: get("sportsbook.live_betting_enabled") !== false,
  };
}

export function isFresh(m: Market, fixture: Fixture, fr: { prematch: number; live: number }, now = Date.now()) {
  if (!m.last_odds_at) return false;
  const age = (now - Date.parse(m.last_odds_at)) / 1000;
  return fixture.status === "live" ? age <= fr.live : age <= fr.prematch;
}

export const outcomeOrder = ["home", "draw", "away", "over", "under", "yes", "no", "1X", "X2", "12"];

/** Match clock shown to players: the source minute moved forward since it was observed. */
export function liveClock(f: Pick<Fixture, "live_minute" | "live_period" | "live_updated_at">, now = Date.now()): string | null {
  if (f.live_period === "HT") return "HT";
  if (f.live_minute == null || !f.live_updated_at || (f.live_period !== "1H" && f.live_period !== "2H")) return null;
  const m = Math.floor(f.live_minute + Math.max(0, (now - Date.parse(f.live_updated_at)) / 60_000));
  const cap = f.live_period === "1H" ? 45 : 90;
  return m > cap ? `${cap}+'` : `${m}'`;
}
