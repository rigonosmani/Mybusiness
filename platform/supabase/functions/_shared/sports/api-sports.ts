/**
 * API-Sports (https://api-sports.io) adapter — scaffold.
 *
 * API-Sports offers separate APIs per sport (api-football, api-basketball, ...)
 * with fixtures, live scores and pre-match odds from listed bookmakers. Its free
 * plan is limited to ~100 requests/day per API and restricted seasons, and odds
 * are only available for some leagues. The endpoints and field mapping below
 * are documented so the adapter can be completed and tested against a real key;
 * until a key is configured every call throws ProviderNotConfiguredError, and
 * the platform simply does not show this provider's data.
 */
import type { NormalizedScore, OddsProvider } from "./types.ts";
import { ProviderNotConfiguredError } from "./types.ts";

interface ApiFootballFixture {
  fixture: { id: number; date: string; status: { short: string } };
  league: { id: number; name: string; country: string; season: number };
  teams: { home: { name: string }; away: { name: string } };
  goals: { home: number | null; away: number | null };
}

const FINISHED = new Set(["FT", "AET", "PEN"]);

/** Results mapping for /fixtures (used for settlement). Regular time ("FT") only grades full-time markets. */
export function normalizeApiFootballFixture(f: ApiFootballFixture): NormalizedScore {
  return {
    event_id: String(f.fixture.id),
    completed: FINISHED.has(f.fixture.status.short),
    home_score: f.goals.home,
    away_score: f.goals.away,
    last_update: null,
  };
}

export class ApiSportsProvider implements OddsProvider {
  readonly id = "api_sports";
  constructor(private readonly apiKey: string | undefined, private readonly fetchImpl: typeof fetch = fetch) {}

  private ensure() {
    if (!this.apiKey) throw new ProviderNotConfiguredError(this.id);
  }

  async listLeagues(): Promise<never> {
    this.ensure();
    throw new Error("api_sports: league listing not implemented yet — see docs/SPORTS_PROVIDERS.md");
  }

  async fetchOdds(): Promise<never> {
    this.ensure();
    throw new Error("api_sports: odds mapping not implemented yet — see docs/SPORTS_PROVIDERS.md");
  }

  async fetchScores(leagueKey: string) {
    this.ensure();
    // leagueKey format: "<leagueId>:<season>"
    const [league, season] = leagueKey.split(":");
    const res = await this.fetchImpl(`https://v3.football.api-sports.io/fixtures?league=${league}&season=${season}&last=50`, {
      headers: { "x-apisports-key": this.apiKey! },
    });
    if (!res.ok) throw new Error(`api_sports fixtures failed: ${res.status}`);
    const body = await res.json() as { response: ApiFootballFixture[] };
    const remaining = res.headers.get("x-ratelimit-requests-remaining");
    return {
      scores: body.response.map(normalizeApiFootballFixture),
      quota: { remaining: remaining === null ? null : Number(remaining), used: null },
    };
  }
}
