import { describe, expect, it, vi } from "vitest";
import { fairProbs, fitRates, isSameMatch, liveMarkets, nameSimilarity, outcomeProbs, remainingShare } from "./live-model.ts";
import { estimateMinute, findMatch, runLiveEngine, type LiveTarget } from "./live.ts";
import { normalizeAfFixture, normalizeFdMatch, type LiveMatch, type LiveSource } from "./live-sources.ts";

describe("live model", () => {
  it("fits Poisson rates that reproduce the pre-match market", () => {
    const pre = { home: 2.0, draw: 3.5, away: 4.0, total: { line: 2.5, over: 1.9, under: 1.95 } };
    const r = fitRates(pre);
    const p = outcomeProbs(r.lh, r.la, 0, 0);
    const [qh, qd, qa] = fairProbs([2.0, 3.5, 4.0]);
    expect(Math.abs(p.home - qh)).toBeLessThan(0.02);
    expect(Math.abs(p.draw - qd)).toBeLessThan(0.03);
    expect(Math.abs(p.away - qa)).toBeLessThan(0.02);
    expect(r.lh).toBeGreaterThan(r.la);
  });

  it("probabilities sum to one and move with score and clock", () => {
    const rates = { lh: 1.5, la: 1.1 };
    const at = (min: number, h: number, a: number) => {
      const s = remainingShare(min);
      return outcomeProbs(rates.lh * s, rates.la * s, h, a);
    };
    const k = at(0, 0, 0);
    expect(k.home + k.draw + k.away).toBeCloseTo(1, 9);
    expect(at(70, 1, 0).home).toBeGreaterThan(0.7);          // leading late
    expect(at(70, 1, 0).home).toBeGreaterThan(at(20, 1, 0).home);
    expect(at(85, 0, 0).draw).toBeGreaterThan(0.6);           // goalless late → draw likely
    expect(at(93, 2, 1).home).toBeCloseTo(1, 6);              // full time
    expect(at(60, 2, 1).over(2.5)).toBe(1);                   // already 3 goals
  });

  it("offers 1X2 and a balanced Over/Under line, never decided lines", () => {
    const m = liveMarkets({ rates: { lh: 1.4, la: 1.2 }, minute: 60, homeGoals: 2, awayGoals: 1, homeLabel: "A", awayLabel: "B", extraLines: [2.5, 4.5] });
    expect(m[0].market_key).toBe("h2h");
    const lines = m.filter((x) => x.market_key === "totals").map((x) => x.line);
    expect(lines).not.toContain(2.5);
    expect(lines).toContain(3.5);
    expect(lines).toContain(4.5);
    for (const x of m) expect(x.outcomes.reduce((s, o) => s + o.prob, 0)).toBeCloseTo(1, 6);
  });

  it("matches team names across providers", () => {
    expect(nameSimilarity("Bayern Munich", "Bayern München")).toBeGreaterThanOrEqual(0.5);
    expect(nameSimilarity("Paris Saint Germain", "Paris Saint-Germain FC")).toBe(1);
    expect(nameSimilarity("Atlético Madrid", "Atletico Madrid")).toBe(1);
    expect(nameSimilarity("Man Utd", "Manchester United")).toBeLessThan(1);
    expect(nameSimilarity("Arsenal", "Chelsea")).toBe(0);
    const ko = "2026-11-22T15:00:00Z";
    expect(isSameMatch({ home: "Arsenal", away: "Chelsea", kickoff: ko }, { home: "Arsenal FC", away: "Chelsea FC", kickoff: "2026-11-22T15:05:00Z" })).toBe(true);
    expect(isSameMatch({ home: "Arsenal", away: "Chelsea", kickoff: ko }, { home: "Arsenal", away: "Chelsea", kickoff: "2026-11-22T18:00:00Z" })).toBe(false);
    expect(isSameMatch({ home: "Arsenal", away: "Chelsea", kickoff: ko }, { home: "Chelsea", away: "Arsenal", kickoff: ko })).toBe(false);
  });
});

describe("live sources", () => {
  it("normalises API-Football and football-data.org", () => {
    const af = normalizeAfFixture({ fixture: { id: 7, date: "2026-11-22T15:00:00+00:00", status: { short: "2H", elapsed: 63 } },
      teams: { home: { name: "A" }, away: { name: "B" } }, goals: { home: 1, away: 0 } });
    expect(af).toMatchObject({ source_id: "7", phase: "2H", minute: 63, home_goals: 1, away_goals: 0 });
    const ft = normalizeAfFixture({ fixture: { id: 8, date: "2026-11-22T15:00:00Z", status: { short: "FT", elapsed: 90 } },
      teams: { home: { name: "A" }, away: { name: "B" } }, goals: { home: 2, away: 2 }, score: { fulltime: { home: 2, away: 2 } } });
    expect(ft.final).toEqual({ home: 2, away: 2 });
    const now = Date.parse("2026-11-22T16:20:00Z");
    const fd = normalizeFdMatch({ id: 9, utcDate: "2026-11-22T15:00:00Z", status: "IN_PLAY",
      homeTeam: { name: "A" }, awayTeam: { name: "B" }, score: { fullTime: { home: 0, away: 1 } } }, now);
    expect(fd.phase).toBe("2H");
    expect(fd.minute).toBe(65); // 80 min since kick-off − 15 min break
  });

  it("estimates the clock between polls", () => {
    const now = new Date("2026-11-22T16:00:00Z");
    expect(estimateMinute("2H", 60, "2026-11-22T15:57:00Z", now)).toBe(63);
    expect(estimateMinute("1H", 44, "2026-11-22T15:50:00Z", now)).toBe(47);
    expect(estimateMinute("HT", 45, "2026-11-22T15:50:00Z", now)).toBe(45);
  });
});

describe("live engine", () => {
  const now = new Date("2026-11-22T16:00:00Z");
  const target = (o: Partial<LiveTarget> = {}): LiveTarget => ({
    fixture_id: "f1", provider: "the_odds_api", provider_event_id: "e1", home_team: "North FC", away_team: "South United",
    commence_time: "2026-11-22T15:00:00Z", home_score: null, away_score: null, live_minute: null, live_period: null,
    live_source_id: null, live_updated_at: null, live_model: null,
    h2h: { home: 2.1, draw: 3.4, away: 3.6 }, totals: [{ line: 2.5, over: 1.9, under: 1.95 }], ...o,
  });
  const match = (o: Partial<LiveMatch> = {}): LiveMatch => ({ source_id: "s1", home: "North", away: "South Utd", kickoff: "2026-11-22T15:00:00Z", phase: "2H", minute: 55, home_goals: 1, away_goals: 0, ...o });
  const rpcFor = (targets: LiveTarget[], lastPoll?: string) => {
    const calls: Record<string, unknown[]> = {};
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      (calls[fn] ??= []).push(args);
      if (fn === "svc_live_targets") return targets;
      if (fn === "svc_last_sync") return lastPoll ? { live: lastPoll } : {};
      if (fn === "svc_update_scores") return { updated: 1 };
      return { ok: true };
    });
    return { rpc, calls };
  };

  it("does nothing (no API request) when no football match is live", async () => {
    const source: LiveSource = { id: "api_sports", fetchLive: vi.fn() };
    const { rpc } = rpcFor([]);
    const r = await runLiveEngine({ rpc, source, now });
    expect(r.status).toBe("idle");
    expect(source.fetchLive).not.toHaveBeenCalled();
  });

  it("polls, matches by team names and prices the fixture", async () => {
    const source: LiveSource = { id: "api_sports", fetchLive: vi.fn(async () => ({ matches: [match()], quota: { remaining: 90, used: null } })) };
    const { rpc, calls } = rpcFor([target()]);
    const r = await runLiveEngine({ rpc, source, now });
    expect(r).toMatchObject({ polled: true, matched: 1, priced: 1, requests_remaining: 90 });
    const item = (calls.svc_apply_live[0] as { p_items: Record<string, unknown>[] }).p_items[0];
    expect(item).toMatchObject({ observed: true, home_score: 1, away_score: 0, minute: 55, period: "2H", source_id: "s1", suspend: false });
    expect(item.model).toBeTruthy();
    const h2h = (item.markets as { market_key: string; outcomes: { key: string; prob: number }[] }[])[0];
    expect(h2h.outcomes.find((o) => o.key === "home")!.prob).toBeGreaterThan(0.6);
  });

  it("re-prices between polls without calling the API, moving the clock", async () => {
    const source: LiveSource = { id: "api_sports", fetchLive: vi.fn() };
    const t = target({ home_score: 0, away_score: 0, live_minute: 50, live_period: "2H", live_source_id: "s1",
      live_updated_at: "2026-11-22T15:58:00Z", live_model: { lh: 1.4, la: 1.1 } });
    const { rpc, calls } = rpcFor([t], "2026-11-22T15:58:00Z");
    const r = await runLiveEngine({ rpc, source, now });
    expect(source.fetchLive).not.toHaveBeenCalled();
    expect(r.priced).toBe(1);
    const item = (calls.svc_apply_live[0] as { p_items: Record<string, unknown>[] }).p_items[0];
    expect(item.observed).toBe(false);
  });

  it("suspends near the end, on stale scores and when not in play; settles at full time", async () => {
    const base = { live_source_id: "s1", live_model: { lh: 1.4, la: 1.1 }, home_score: 1, away_score: 1 };
    const targets = [
      target({ ...base, fixture_id: "late", live_minute: 89, live_period: "2H", live_updated_at: "2026-11-22T15:59:30Z" }),
      target({ ...base, fixture_id: "stale", live_minute: 30, live_period: "1H", live_updated_at: "2026-11-22T15:30:00Z" }),
    ];
    const { rpc, calls } = rpcFor(targets, "2026-11-22T15:59:00Z");
    const r = await runLiveEngine({ rpc, source: null, now });
    const items = (calls.svc_apply_live[0] as { p_items: { fixture_id: string; suspend: boolean; reason: string }[] }).p_items;
    expect(items.find((i) => i.fixture_id === "late")).toMatchObject({ suspend: true, reason: "closing" });
    expect(items.find((i) => i.fixture_id === "stale")).toMatchObject({ suspend: true, reason: "score_stale" });
    expect(r.suspended).toBe(2);

    const src: LiveSource = { id: "api_sports", fetchLive: vi.fn(async () => ({ matches: [match({ phase: "FT", minute: 90, home_goals: 2, away_goals: 1, final: { home: 2, away: 1 } })], quota: { remaining: 50, used: null } })) };
    const fin = rpcFor([target({ ...base, live_minute: 85, live_period: "2H", live_updated_at: "2026-11-22T15:55:00Z" })]);
    const r2 = await runLiveEngine({ rpc: fin.rpc, source: src, now });
    expect(fin.calls.svc_update_scores[0]).toMatchObject({ p_provider: "the_odds_api", p_scores: [{ event_id: "e1", completed: true, home_score: 2, away_score: 1 }] });
    expect(r2.finished).toBe(1);
  });

  it("asks for final scores of linked matches that left the live list", async () => {
    const src: LiveSource = {
      id: "api_sports",
      fetchLive: vi.fn(async () => ({ matches: [], quota: { remaining: 50, used: null } })),
      fetchByIds: vi.fn(async () => ({ matches: [match({ phase: "FT", home_goals: 0, away_goals: 0, final: { home: 0, away: 0 } })], quota: { remaining: 49, used: null } })),
    };
    const t = target({ live_source_id: "s1", live_model: { lh: 1, la: 1 }, home_score: 0, away_score: 0, live_minute: 86, live_period: "2H", live_updated_at: "2026-11-22T15:55:00Z" });
    const { rpc, calls } = rpcFor([t]);
    await runLiveEngine({ rpc, source: src, now });
    expect(src.fetchByIds).toHaveBeenCalledWith(["s1"]);
    expect(calls.svc_update_scores).toHaveLength(1);
  });

  it("findMatch prefers an existing link", () => {
    const t = target({ live_source_id: "s2" });
    expect(findMatch(t, [match(), match({ source_id: "s2", home: "X", away: "Y" })])!.source_id).toBe("s2");
  });
});
