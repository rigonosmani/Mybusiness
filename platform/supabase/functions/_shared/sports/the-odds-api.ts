/**
 * The Odds API v4 adapter (https://the-odds-api.com/liveapi/guides/v4/).
 *
 *  GET /v4/sports                                   — free, lists leagues ("sport keys")
 *  GET /v4/sports/{sport}/odds?regions=&markets=    — costs (#markets × #regions) credits
 *  GET /v4/sports/{sport}/scores?daysFrom=1..3      — costs 1 (2 with daysFrom)
 * Usage is reported in the x-requests-remaining / x-requests-used headers.
 *
 * Odds are aggregated across the returned bookmakers by taking the MEDIAN price
 * per outcome (and per line for spreads/totals). Nothing is derived that the
 * provider did not return.
 */
import type {
  MarketKey, NormalizedEvent, NormalizedMarket, NormalizedOutcome, NormalizedScore, OddsProvider,
  ProviderLeague, QuotaInfo,
} from "./types.ts";
import { ProviderNotConfiguredError } from "./types.ts";

export interface OddsApiOutcome { name: string; price: number; point?: number }
export interface OddsApiMarket { key: string; last_update?: string; outcomes: OddsApiOutcome[] }
export interface OddsApiBookmaker { key: string; title: string; last_update: string; markets: OddsApiMarket[] }
export interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}
export interface OddsApiScore {
  id: string;
  sport_key: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: { name: string; score: string }[] | null;
  last_update: string | null;
}
export interface OddsApiSport {
  key: string; group: string; title: string; description: string; active: boolean; has_outrights: boolean;
}

/** Stable sport ids for provider "group" names. */
export function sportIdFromGroup(group: string): string {
  const map: Record<string, string> = {
    "Soccer": "football", "Basketball": "basketball", "Tennis": "tennis", "American Football": "american_football",
    "Baseball": "baseball", "Ice Hockey": "ice_hockey", "Volleyball": "volleyball", "Handball": "handball",
    "Cricket": "cricket", "Rugby League": "rugby", "Rugby Union": "rugby", "Mixed Martial Arts": "mma",
    "Boxing": "boxing", "Table Tennis": "table_tennis", "Esports": "esports", "Aussie Rules": "aussie_rules",
    "Golf": "golf", "Lacrosse": "lacrosse", "Politics": "politics",
  };
  return map[group] ?? group.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48);
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const v = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  return Math.round(v * 1000) / 1000;
}

function outcomeKey(market: string, o: OddsApiOutcome, ev: OddsApiEvent): string | null {
  if (market === "totals") return o.name.toLowerCase() === "over" ? "over" : o.name.toLowerCase() === "under" ? "under" : null;
  if (market === "btts") return o.name.toLowerCase() === "yes" ? "yes" : o.name.toLowerCase() === "no" ? "no" : null;
  if (o.name === ev.home_team) return "home";
  if (o.name === ev.away_team) return "away";
  if (o.name.toLowerCase() === "draw") return "draw";
  return null;
}

const SUPPORTED: Record<string, MarketKey> = {
  h2h: "h2h", spreads: "spreads", totals: "totals", btts: "btts", draw_no_bet: "draw_no_bet", h2h_3_way: "h2h_3way",
};

/** Aggregate one event across bookmakers into normalized markets. */
export function normalizeEvent(ev: OddsApiEvent, league: { title: string; group: string; has_outrights?: boolean }): NormalizedEvent {
  // bucket: marketKey|line -> outcomeKey -> {label, point, prices[]}
  const buckets = new Map<string, { market: MarketKey; line: number | null; books: Set<string>;
    outcomes: Map<string, { label: string; point: number | null; prices: number[] }> }>();
  let latest = 0;

  for (const bm of ev.bookmakers ?? []) {
    latest = Math.max(latest, Date.parse(bm.last_update) || 0);
    for (const m of bm.markets ?? []) {
      const mk = SUPPORTED[m.key];
      if (!mk) continue;
      // Line: totals use the outcome point; spreads use the home team's handicap.
      let line: number | null = null;
      if (mk === "totals") line = m.outcomes.find((o) => typeof o.point === "number")?.point ?? null;
      if (mk === "spreads") line = m.outcomes.find((o) => o.name === ev.home_team)?.point ?? null;
      if ((mk === "totals" || mk === "spreads") && line === null) continue;
      const id = `${mk}|${line ?? ""}`;
      let b = buckets.get(id);
      if (!b) {
        b = { market: mk, line, books: new Set(), outcomes: new Map() };
        buckets.set(id, b);
      }
      b.books.add(bm.key);
      for (const o of m.outcomes) {
        const key = outcomeKey(m.key, o, ev);
        if (!key || !(o.price > 1)) continue;
        let oc = b.outcomes.get(key);
        if (!oc) {
          const label = key === "over" || key === "under" ? `${o.name} ${o.point}` :
            mk === "spreads" ? `${o.name} ${o.point! > 0 ? "+" : ""}${o.point}` : o.name;
          oc = { label, point: typeof o.point === "number" ? o.point : null, prices: [] };
          b.outcomes.set(key, oc);
        }
        oc.prices.push(o.price);
      }
    }
  }

  const markets: NormalizedMarket[] = [];
  for (const b of buckets.values()) {
    const outcomes: NormalizedOutcome[] = [...b.outcomes.entries()].map(([key, v]) => ({
      key, label: v.label, point: v.point, price: median(v.prices),
    }));
    // A market is only offered when all of its sides are present.
    const needs = b.market === "totals" ? ["over", "under"] : b.market === "btts" ? ["yes", "no"] : ["home", "away"];
    if (!needs.every((k) => outcomes.some((o) => o.key === k))) continue;
    markets.push({ market_key: b.market, line: b.line, bookmaker_count: b.books.size, outcomes });
  }

  return {
    sport_key: sportIdFromGroup(league.group),
    sport_title: league.group,
    league_key: ev.sport_key,
    league_title: league.title || ev.sport_title,
    has_outrights: league.has_outrights ?? false,
    event_id: ev.id,
    home_team: ev.home_team,
    away_team: ev.away_team,
    commence_time: ev.commence_time,
    odds_updated_at: new Date(latest || Date.now()).toISOString(),
    markets,
  };
}

export function normalizeScore(s: OddsApiScore): NormalizedScore {
  const find = (team: string) => {
    const v = s.scores?.find((x) => x.name === team)?.score;
    const n = v === undefined || v === null || v === "" ? NaN : Number(v);
    return Number.isInteger(n) ? n : null;
  };
  return {
    event_id: s.id,
    completed: !!s.completed,
    home_score: find(s.home_team),
    away_score: find(s.away_team),
    last_update: s.last_update,
  };
}

function quota(res: Response): QuotaInfo {
  const num = (h: string) => {
    const v = res.headers.get(h);
    return v === null ? null : Number(v);
  };
  return { remaining: num("x-requests-remaining"), used: num("x-requests-used") };
}

export class TheOddsApiProvider implements OddsProvider {
  readonly id = "the_odds_api";
  private leagueCache: Map<string, OddsApiSport> | null = null;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = "https://api.the-odds-api.com/v4",
  ) {}

  private async get(path: string, params: Record<string, string>) {
    if (!this.apiKey) throw new ProviderNotConfiguredError(this.id);
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("apiKey", this.apiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await this.fetchImpl(url.toString(), { headers: { accept: "application/json" } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`The Odds API ${path} failed: ${res.status} ${body.slice(0, 200)}`);
    }
    return { body: await res.json(), quota: quota(res) };
  }

  async listLeagues() {
    const { body, quota } = await this.get("/sports", {});
    const sports = body as OddsApiSport[];
    this.leagueCache = new Map(sports.map((s) => [s.key, s]));
    return {
      leagues: sports.map((s) => ({ key: s.key, title: s.title, group: s.group, active: s.active, has_outrights: s.has_outrights })),
      quota,
    };
  }

  async fetchOdds(leagueKey: string, opts: { regions: string; markets: string }) {
    if (!this.leagueCache) await this.listLeagues();
    const league = this.leagueCache!.get(leagueKey);
    if (!league) return { events: [], quota: { remaining: null, used: null } };
    const { body, quota } = await this.get(`/sports/${encodeURIComponent(leagueKey)}/odds`, {
      regions: opts.regions, markets: opts.markets, oddsFormat: "decimal", dateFormat: "iso",
    });
    const events = (body as OddsApiEvent[]).map((e) => normalizeEvent(e, league)).filter((e) => e.markets.length > 0);
    return { events, quota };
  }

  async fetchScores(leagueKey: string, daysFrom: number) {
    const { body, quota } = await this.get(`/sports/${encodeURIComponent(leagueKey)}/scores`, {
      daysFrom: String(Math.min(3, Math.max(1, daysFrom))), dateFormat: "iso",
    });
    return { scores: (body as OddsApiScore[]).map(normalizeScore), quota };
  }
}
