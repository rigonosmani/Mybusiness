import { describe, expect, it, vi } from "vitest";
import { TheOddsApiProvider, median, normalizeEvent, normalizeScore, sportIdFromGroup, type OddsApiEvent } from "./the-odds-api.ts";
import { runOddsSync } from "./sync.ts";
import { ProviderNotConfiguredError } from "./types.ts";

const ev: OddsApiEvent = {
  id: "abc", sport_key: "soccer_epl", sport_title: "EPL", commence_time: "2026-12-01T15:00:00Z",
  home_team: "North FC", away_team: "South United",
  bookmakers: [
    { key: "b1", title: "B1", last_update: "2026-11-21T10:00:00Z", markets: [
      { key: "h2h", outcomes: [{ name: "North FC", price: 2.0 }, { name: "South United", price: 3.5 }, { name: "Draw", price: 3.3 }] },
      { key: "totals", outcomes: [{ name: "Over", price: 1.9, point: 2.5 }, { name: "Under", price: 1.95, point: 2.5 }] },
      { key: "spreads", outcomes: [{ name: "North FC", price: 1.95, point: -0.5 }, { name: "South United", price: 1.9, point: 0.5 }] },
    ] },
    { key: "b2", title: "B2", last_update: "2026-11-21T10:05:00Z", markets: [
      { key: "h2h", outcomes: [{ name: "North FC", price: 2.1 }, { name: "South United", price: 3.3 }, { name: "Draw", price: 3.4 }] },
      { key: "totals", outcomes: [{ name: "Over", price: 2.3, point: 3.0 }, { name: "Under", price: 1.6, point: 3.0 }] },
      { key: "outrights", outcomes: [{ name: "North FC", price: 9 }] },
    ] },
    { key: "b3", title: "B3", last_update: "2026-11-21T09:00:00Z", markets: [
      { key: "h2h", outcomes: [{ name: "North FC", price: 2.05 }, { name: "South United", price: 3.4 }, { name: "Draw", price: 3.35 }] },
      { key: "totals", outcomes: [{ name: "Over", price: 1.85 }] }, // no point → ignored
    ] },
  ],
};

describe("The Odds API normalisation", () => {
  it("aggregates bookmakers with the median price and keeps lines separate", () => {
    const n = normalizeEvent(ev, { title: "EPL", group: "Soccer" });
    expect(n.sport_key).toBe("football");
    expect(n.league_key).toBe("soccer_epl");
    expect(n.odds_updated_at).toBe("2026-11-21T10:05:00.000Z");
    const h2h = n.markets.find((m) => m.market_key === "h2h")!;
    expect(h2h.bookmaker_count).toBe(3);
    expect(h2h.outcomes.find((o) => o.key === "home")!.price).toBe(2.05);
    expect(h2h.outcomes.find((o) => o.key === "draw")!.price).toBe(3.35);
    const totals = n.markets.filter((m) => m.market_key === "totals").map((m) => m.line).sort();
    expect(totals).toEqual([2.5, 3]);
    const spread = n.markets.find((m) => m.market_key === "spreads")!;
    expect(spread.line).toBe(-0.5);
    expect(spread.outcomes.find((o) => o.key === "away")!.point).toBe(0.5);
    expect(n.markets.some((m) => (m.market_key as string) === "outrights")).toBe(false);
  });

  it("drops one-sided markets instead of guessing the missing side", () => {
    const one = { ...ev, bookmakers: [{ ...ev.bookmakers[0], markets: [{ key: "totals", outcomes: [{ name: "Over", price: 1.9, point: 2.5 }] }] }] };
    expect(normalizeEvent(one, { title: "EPL", group: "Soccer" }).markets).toHaveLength(0);
  });

  it("maps scores to home/away and ignores non-numeric scores", () => {
    expect(normalizeScore({ id: "abc", sport_key: "x", commence_time: "", completed: true, home_team: "A", away_team: "B",
      scores: [{ name: "B", score: "1" }, { name: "A", score: "3" }], last_update: null }))
      .toEqual({ event_id: "abc", completed: true, home_score: 3, away_score: 1, last_update: null });
    expect(normalizeScore({ id: "x", sport_key: "x", commence_time: "", completed: false, home_team: "A", away_team: "B",
      scores: null, last_update: null }).home_score).toBeNull();
  });

  it("helpers", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2])).toBe(1.5);
    expect(sportIdFromGroup("Ice Hockey")).toBe("ice_hockey");
    expect(sportIdFromGroup("Some New Sport")).toBe("some_new_sport");
  });

  it("calls the API with the key server-side and reads the quota headers", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      const body = url.includes("/odds") ? [ev] : [{ key: "soccer_epl", group: "Soccer", title: "EPL", description: "", active: true, has_outrights: false }];
      return new Response(JSON.stringify(body), { headers: { "x-requests-remaining": "480", "x-requests-used": "20" } });
    });
    const p = new TheOddsApiProvider("KEY", fetchMock as unknown as typeof fetch);
    const r = await p.fetchOdds("soccer_epl", { regions: "eu", markets: "h2h,totals" });
    expect(r.events).toHaveLength(1);
    expect(r.quota).toEqual({ remaining: 480, used: 20 });
    expect(calls[1]).toContain("oddsFormat=decimal");
    expect(calls[1]).toContain("markets=h2h%2Ctotals");
  });

  it("refuses to run without a key", async () => {
    await expect(new TheOddsApiProvider(undefined).listLeagues()).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });
});

describe("sync job", () => {
  const provider = {
    id: "the_odds_api",
    listLeagues: vi.fn(),
    fetchOdds: vi.fn(async () => ({ events: [normalizeEvent(ev, { title: "EPL", group: "Soccer" })], quota: { remaining: 100, used: 1 } })),
    fetchScores: vi.fn(async () => ({ scores: [], quota: { remaining: 99, used: 2 } })),
  };

  it("respects per-league intervals and the request budget", async () => {
    const calls: string[] = [];
    const rpc = vi.fn(async (fn: string) => {
      calls.push(fn);
      if (fn === "svc_last_sync") return { soccer_epl: new Date().toISOString() };
      if (fn === "svc_fixtures_awaiting_results") return ["basketball_nba"];
      if (fn === "svc_upsert_odds") return { fixtures: 1 };
      if (fn === "svc_update_scores") return { bets_settled: 2 };
      if (fn === "svc_suspend_stale_markets") return 0;
      return null;
    });
    const report = await runOddsSync({ provider, rpc, config: { sports: ["soccer_epl", "basketball_nba"] } });
    expect(report.leagues_synced).toEqual(["basketball_nba"]); // EPL synced moments ago
    expect(report.scores_checked).toEqual(["basketball_nba"]); // started NBA fixtures need results
    expect(report.bets_settled).toBe(2);
    expect(provider.fetchOdds).toHaveBeenCalledTimes(1);
    expect(calls).toContain("svc_suspend_stale_markets");
  });

  it("stops spending when the remaining quota is low", async () => {
    provider.fetchOdds.mockResolvedValueOnce({ events: [], quota: { remaining: 3, used: 497 } });
    const rpc = vi.fn(async (fn: string) => (fn === "svc_last_sync" ? {} : fn === "svc_fixtures_awaiting_results" ? [] : { fixtures: 0 }));
    const report = await runOddsSync({ provider, rpc, config: { sports: ["a", "b", "c"], min_requests_remaining: 10 } });
    expect(report.leagues_synced).toEqual(["a"]);
    expect(report.errors.filter((e) => e.startsWith("budget"))).toHaveLength(2);
  });

  it('"*" syncs every active, non-outright league the provider lists', async () => {
    const p = {
      ...provider,
      listLeagues: vi.fn(async () => ({ leagues: [
        { key: "soccer_a", title: "A", group: "Soccer", active: true, has_outrights: false },
        { key: "golf_winner", title: "G", group: "Golf", active: true, has_outrights: true },
        { key: "soccer_off", title: "B", group: "Soccer", active: false, has_outrights: false },
      ], quota: { remaining: null, used: null } })),
      fetchOdds: vi.fn(async () => ({ events: [], quota: { remaining: 400, used: 1 } })),
    };
    const rpc = vi.fn(async (fn: string) => (fn === "svc_last_sync" ? {} : fn === "svc_fixtures_awaiting_results" ? [] : { fixtures: 0 }));
    const report = await runOddsSync({ provider: p, rpc, config: { sports: ["*"] } });
    expect(report.leagues_synced).toEqual(["soccer_a"]);
  });

  it("reports 'skipped' when the provider is not configured", async () => {
    const p = new TheOddsApiProvider(undefined);
    const rpc = vi.fn(async (fn: string) => (fn === "svc_last_sync" ? {} : null));
    const report = await runOddsSync({ provider: p, rpc, config: { sports: ["soccer_epl"] } });
    expect(report.status).toBe("skipped");
  });
});
