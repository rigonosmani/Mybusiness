import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectError, key } from "./harness";

const CR = (n: number) => BigInt(n) * 100n;
let db: TestDb;
let owner: string, admin: string, player: string;

const kickoff = () => new Date(Date.now() - 50 * 60_000).toISOString();
const ev = (id: string) => ({
  sport_key: "football", sport_title: "Football", league_key: "soccer_live_test", league_title: "Live League",
  event_id: id, home_team: `Home ${id}`, away_team: `Away ${id}`, commence_time: kickoff(),
  odds_updated_at: new Date(Date.now() - 60 * 60_000).toISOString(),
  markets: [
    { market_key: "h2h", bookmaker_count: 5, outcomes: [
      { key: "home", label: `Home ${id}`, price: 2.0 }, { key: "draw", label: "Draw", price: 3.4 }, { key: "away", label: `Away ${id}`, price: 3.9 }] },
    { market_key: "totals", line: 2.5, bookmaker_count: 5, outcomes: [
      { key: "over", label: "Over", point: 2.5, price: 1.9 }, { key: "under", label: "Under", point: 2.5, price: 1.95 }] },
    { market_key: "btts", bookmaker_count: 5, outcomes: [{ key: "yes", label: "Yes", price: 1.8 }, { key: "no", label: "No", price: 2.0 }] },
  ],
});

const fixtureId = async (e: string) => (await db.sql(`select id from fixtures where provider_event_id = $1`, [e]))[0].id as string;
const item = (fixture: string, o: Record<string, unknown> = {}) => ({
  fixture_id: fixture, observed: true, home_score: 0, away_score: 0, minute: 50, period: "2H", source: "api_sports", source_id: "s1",
  model: { lh: 1.4, la: 1.1 }, suspend: false,
  markets: [
    { market_key: "h2h", line: null, outcomes: [
      { key: "home", label: "H", point: null, prob: 0.4 }, { key: "draw", label: "Draw", point: null, prob: 0.35 }, { key: "away", label: "A", point: null, prob: 0.25 }] },
    { market_key: "totals", line: 1.5, outcomes: [
      { key: "over", label: "Over", point: 1.5, prob: 0.45 }, { key: "under", label: "Under", point: 1.5, prob: 0.55 }] },
  ],
  ...o,
});
const apply = (items: unknown[]) => db.service(`select svc_apply_live($1::jsonb, 90) r`, [JSON.stringify(items)]);
const markets = async (f: string) =>
  db.sql(`select m.market_key, m.line, m.status, m.source, o.outcome_key, o.offered_odds, o.source_odds, o.id outcome_id
          from betting_markets m join market_outcomes o on o.market_id = m.id where m.fixture_id = $1 order by 1, 2, 5`, [f]);

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.bootstrapSuperAdmin(CR(1000));
  admin = await db.provision(owner, "admin", "admin_live");
  player = await db.provision(admin, "player", "player_live");
  await db.user(owner, `select allocate_credits($1, $2, null, $3)`, [admin, CR(100).toString(), key()]);
  await db.user(admin, `select transfer_to_player($1, $2, null, $3)`, [player, CR(10).toString(), key()]);
  await db.service(`select svc_upsert_odds('the_odds_api', $1::jsonb)`, [JSON.stringify([ev("L1"), ev("L2")])]);
});
afterAll(async () => db.destroy());

describe("Kometa Live", () => {
  it("lists live football fixtures with their pre-match odds", async () => {
    const [{ r }] = await db.service(`select svc_live_targets() r`);
    const t = (r as any[]).find((x) => x.provider_event_id === "L1");
    expect(t.h2h).toEqual({ home: 2, draw: 3.4, away: 3.9 });
    expect(t.totals[0]).toMatchObject({ line: 2.5, over: 1.9, under: 1.95 });
  });

  it("applies live prices with the live margin, suspends unpriced markets, accepts bets", async () => {
    const f = await fixtureId("L1");
    await apply([item(f)]);
    const rows = await markets(f);
    const home = rows.find((x) => x.market_key === "h2h" && x.outcome_key === "home")!;
    expect(Number(home.source_odds)).toBe(2.5);
    expect(Number(home.offered_odds)).toBe(2.38); // 1 + 1.5 × (1 − 8%)
    expect(rows.find((x) => x.market_key === "totals" && Number(x.line) === 1.5)!.status).toBe("open");
    expect(rows.find((x) => x.market_key === "totals" && Number(x.line) === 2.5)!.status).toBe("suspended");
    expect(rows.find((x) => x.market_key === "btts")!.status).toBe("suspended");
    const [fx] = await db.sql(`select home_score, live_minute, live_period, live_source_id, live_model from fixtures where id = $1`, [f]);
    expect(fx).toMatchObject({ home_score: 0, live_minute: 50, live_period: "2H", live_source_id: "s1" });

    const r = await db.user(player, `select place_bets($1::jsonb, $2) r`, [
      JSON.stringify({ mode: "singles", stake: "1000", selections: [{ outcome_id: home.outcome_id, odds: home.offered_odds }] }), key()]);
    expect(r[0].r.bets).toHaveLength(1);
    const [sel] = await db.sql(`select was_live from bet_selections where outcome_id = $1`, [home.outcome_id]);
    expect(sel.was_live).toBe(true);
  });

  it("pauses betting after a goal and resumes after the cool-down", async () => {
    const f = await fixtureId("L1");
    await apply([item(f, { home_score: 1 })]);
    const rows = await markets(f);
    expect(rows.every((x) => x.status === "suspended")).toBe(true);
    const home = rows.find((x) => x.market_key === "h2h" && x.outcome_key === "home")!;
    await expectError(db.user(player, `select place_bets($1::jsonb, $2) r`, [
      JSON.stringify({ mode: "singles", stake: "1000", selections: [{ outcome_id: home.outcome_id, odds: home.offered_odds }] }), key()]), "MARKET_SUSPENDED");
    // Between polls (not observed) it stays paused while the cool-down runs.
    await apply([item(f, { observed: false, home_score: 1 })]);
    expect((await markets(f)).every((x) => x.status === "suspended")).toBe(true);
    await db.sql(`update fixtures set live_suspended_until = now() - interval '1 second' where id = $1`, [f]);
    await apply([item(f, { observed: false })]);
    expect((await markets(f)).find((x) => x.market_key === "h2h")!.status).toBe("open");
  });

  it("suspends on request and refuses extreme probabilities", async () => {
    const f = await fixtureId("L2");
    await apply([item(f, { markets: [{ market_key: "h2h", line: null, outcomes: [
      { key: "home", label: "H", point: null, prob: 0.985 }, { key: "draw", label: "Draw", point: null, prob: 0.01 }, { key: "away", label: "A", point: null, prob: 0.005 }] }] })]);
    const rows = await markets(f);
    expect(rows.filter((x) => x.market_key === "h2h").map((x) => x.outcome_key).sort()).toEqual(["away", "draw", "home"]);
    const [{ n }] = await db.sql(`select count(*)::int n from market_outcomes o join betting_markets m on m.id = o.market_id
      where m.fixture_id = $1 and m.market_key = 'h2h' and o.status = 'open'`, [f]);
    expect(n).toBe(0);
    await apply([item(f, { suspend: true, markets: [] })]);
    expect((await markets(f)).every((x) => x.status === "suspended")).toBe(true);
  });

  it("is service-role only", async () => {
    await expectError(db.user(player, `select svc_apply_live('[]'::jsonb, 90)`), "permission denied");
    await expectError(db.user(owner, `select svc_live_targets()`), "permission denied");
  });
});
