/**
 * Free live-score sources for the Kometa live odds engine. Each adapter returns the
 * same LiveMatch shape. One request returns every match currently in play, so a
 * free daily quota goes a long way.
 *
 *   api_sports    — API-Football (https://www.api-football.com), header x-apisports-key
 *   football_data — football-data.org v4, header X-Auth-Token
 */
import type { QuotaInfo } from "./types.ts";

export type LivePhase = "1H" | "HT" | "2H" | "FT" | "OTHER";

export interface LiveMatch {
  source_id: string;
  home: string;
  away: string;
  kickoff: string;       // ISO
  phase: LivePhase;
  minute: number | null; // match clock if the source provides it
  home_goals: number;
  away_goals: number;
  /** Regular-time result, only when phase === "FT". */
  final?: { home: number; away: number } | null;
}

export interface LiveSource {
  readonly id: "api_sports" | "football_data";
  fetchLive(): Promise<{ matches: LiveMatch[]; quota: QuotaInfo }>;
  /** Look up specific matches (e.g. ones that just left the live list) to read final scores. */
  fetchByIds?(ids: string[]): Promise<{ matches: LiveMatch[]; quota: QuotaInfo }>;
}

// ---------------------------------------------------------------- API-Football
interface AfFixture {
  fixture: { id: number; date: string; status: { short: string; elapsed: number | null } };
  teams: { home: { name: string }; away: { name: string } };
  goals: { home: number | null; away: number | null };
  score?: { fulltime?: { home: number | null; away: number | null } };
}

const AF_PHASE: Record<string, LivePhase> = { "1H": "1H", HT: "HT", "2H": "2H", FT: "FT" };

export function normalizeAfFixture(f: AfFixture): LiveMatch {
  const phase = AF_PHASE[f.fixture.status.short] ?? "OTHER";
  const ft = f.score?.fulltime;
  return {
    source_id: String(f.fixture.id),
    home: f.teams.home.name,
    away: f.teams.away.name,
    kickoff: new Date(f.fixture.date).toISOString(),
    phase,
    minute: f.fixture.status.elapsed ?? null,
    home_goals: f.goals.home ?? 0,
    away_goals: f.goals.away ?? 0,
    final: phase === "FT" && ft && ft.home !== null && ft.away !== null ? { home: ft.home!, away: ft.away! } : null,
  };
}

/** API-Football reports plan/key problems in an `errors` field with HTTP 200. */
function afError(errors: unknown): string | null {
  if (!errors) return null;
  if (Array.isArray(errors)) return errors.length ? errors.map(String).join("; ") : null;
  if (typeof errors === "object") {
    const v = Object.entries(errors as Record<string, unknown>).map(([k, x]) => `${k}: ${x}`);
    return v.length ? v.join("; ") : null;
  }
  return String(errors);
}

export class ApiFootballLive implements LiveSource {
  readonly id = "api_sports" as const;
  constructor(private readonly key: string, private readonly fetchImpl: typeof fetch = fetch) {}

  fetchLive() {
    return this.get("fixtures?live=all");
  }

  fetchByIds(ids: string[]) {
    return this.get(`fixtures?ids=${ids.slice(0, 20).map((x) => encodeURIComponent(x)).join("-")}`);
  }

  private async get(path: string) {
    const res = await this.fetchImpl(`https://v3.football.api-sports.io/${path}`, {
      headers: { "x-apisports-key": this.key },
    });
    if (!res.ok) throw new Error(`API-Football HTTP ${res.status}`);
    const body = await res.json() as { errors?: unknown; response?: AfFixture[] };
    const err = afError(body.errors);
    if (err) throw new Error(`API-Football: ${err}`);
    const rem = res.headers.get("x-ratelimit-requests-remaining");
    return {
      matches: (body.response ?? []).map(normalizeAfFixture),
      quota: { remaining: rem === null ? null : Number(rem), used: null },
    };
  }
}

// ------------------------------------------------------------ football-data.org
interface FdMatch {
  id: number; utcDate: string; status: string; minute?: number | string | null;
  homeTeam: { name: string; shortName?: string }; awayTeam: { name: string; shortName?: string };
  score: {
    duration?: string;
    fullTime: { home: number | null; away: number | null };
    regularTime?: { home: number | null; away: number | null } | null;
  };
}

export function normalizeFdMatch(m: FdMatch, now = Date.now()): LiveMatch {
  const phase: LivePhase = m.status === "PAUSED" ? "HT" : m.status === "FINISHED" ? "FT" : m.status === "IN_PLAY" ? "1H" : "OTHER";
  let minute = m.minute === undefined || m.minute === null || m.minute === "" ? null : parseInt(String(m.minute), 10);
  if (Number.isNaN(minute as number)) minute = null;
  // No match clock on the free tier: estimate it from kick-off (15 min half-time break).
  if (phase === "1H" && minute === null) {
    const elapsed = (now - Date.parse(m.utcDate)) / 60_000;
    minute = elapsed <= 47 ? Math.max(1, Math.floor(elapsed)) : Math.min(95, Math.max(46, Math.floor(elapsed - 15)));
  }
  const p: LivePhase = phase === "1H" && (minute ?? 0) > 45 ? "2H" : phase;
  const regular = m.score.duration && m.score.duration !== "REGULAR" ? m.score.regularTime : m.score.fullTime;
  return {
    source_id: String(m.id),
    home: m.homeTeam.name,
    away: m.awayTeam.name,
    kickoff: new Date(m.utcDate).toISOString(),
    phase: p,
    minute: p === "HT" ? 45 : minute,
    home_goals: m.score.fullTime.home ?? 0,
    away_goals: m.score.fullTime.away ?? 0,
    final: p === "FT" && regular && regular.home !== null && regular.away !== null ? { home: regular.home!, away: regular.away! } : null,
  };
}

export class FootballDataLive implements LiveSource {
  readonly id = "football_data" as const;
  constructor(private readonly key: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async fetchLive() {
    // Without a date filter v4 returns today's matches (all statuses) in one request.
    const res = await this.fetchImpl("https://api.football-data.org/v4/matches", { headers: { "X-Auth-Token": this.key } });
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`football-data.org HTTP ${res.status}${msg ? `: ${msg.slice(0, 160)}` : ""}`);
    }
    const body = await res.json() as { matches?: FdMatch[] };
    const now = Date.now();
    const rem = res.headers.get("x-requests-available-minute");
    return {
      matches: (body.matches ?? []).filter((m) => ["IN_PLAY", "PAUSED", "FINISHED"].includes(m.status)).map((m) => normalizeFdMatch(m, now)),
      quota: { remaining: rem === null ? null : Number(rem), used: null },
    };
  }
}
