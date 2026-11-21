/**
 * Provider-neutral sportsbook types. Every adapter turns its provider's payload
 * into these shapes, which map 1:1 onto public.svc_upsert_odds / svc_update_scores.
 * Adapters must never synthesise odds or markets the provider did not return.
 */

export type MarketKey =
  | "h2h" | "h2h_3way" | "double_chance" | "draw_no_bet" | "totals" | "spreads"
  | "btts" | "correct_score" | "period_winner";

export interface NormalizedOutcome {
  key: string; // home | away | draw | over | under | yes | no | 1X | X2 | 12 | score:H-A
  label: string;
  point?: number | null;
  price: number; // decimal odds from the provider (consensus across bookmakers)
}

export interface NormalizedMarket {
  market_key: MarketKey;
  period?: string;
  line?: number | null;
  bookmaker_count: number;
  outcomes: NormalizedOutcome[];
}

export interface NormalizedEvent {
  sport_key: string;
  sport_title: string;
  league_key: string;
  league_title: string;
  country?: string | null;
  has_outrights?: boolean;
  event_id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  odds_updated_at: string;
  markets: NormalizedMarket[];
}

export interface NormalizedScore {
  event_id: string;
  completed: boolean;
  home_score: number | null;
  away_score: number | null;
  last_update: string | null;
}

export interface ProviderLeague {
  key: string;
  title: string;
  group: string;
  active: boolean;
  has_outrights: boolean;
}

export interface QuotaInfo {
  remaining: number | null;
  used: number | null;
}

export interface OddsProvider {
  readonly id: string;
  listLeagues(): Promise<{ leagues: ProviderLeague[]; quota: QuotaInfo }>;
  fetchOdds(leagueKey: string, opts: { regions: string; markets: string }): Promise<{ events: NormalizedEvent[]; quota: QuotaInfo }>;
  fetchScores(leagueKey: string, daysFrom: number): Promise<{ scores: NormalizedScore[]; quota: QuotaInfo }>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`${provider} is not configured (missing API key)`);
  }
}
