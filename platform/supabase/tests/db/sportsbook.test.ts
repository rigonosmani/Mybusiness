import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectError, key } from "./harness";

const CR = (n: number) => BigInt(n) * 100n;
let db: TestDb;
let owner: string, adminA: string, adminB: string, playerA1: string, playerB1: string;

function event(id: string, opts: { commence?: string; home?: number; draw?: number; away?: number; extra?: any[] } = {}) {
  return {
    sport_key: "soccer", sport_title: "Football", league_key: "soccer_test", league_title: "Test League",
    event_id: id, home_team: `Home ${id}`, away_team: `Away ${id}`,
    commence_time: opts.commence ?? new Date(Date.now() + 86_400_000).toISOString(),
    odds_updated_at: new Date().toISOString(),
    markets: [
      { market_key: "h2h", bookmaker_count: 5, outcomes: [
        { key: "home", label: "Home", price: opts.home ?? 2.0 },
        { key: "draw", label: "Draw", price: opts.draw ?? 3.4 },
        { key: "away", label: "Away", price: opts.away ?? 3.9 },
      ] },
      { market_key: "totals", line: 2.5, bookmaker_count: 5, outcomes: [
        { key: "over", label: "Over 2.5", point: 2.5, price: 1.9 },
        { key: "under", label: "Under 2.5", point: 2.5, price: 1.95 },
      ] },
      ...(opts.extra ?? []),
    ],
  };
}

async function outcome(eventId: string, market: string, key: string) {
  const [o] = await db.sql(
    `select o.id, o.offered_odds from market_outcomes o join betting_markets m on m.id = o.market_id
     join fixtures f on f.id = m.fixture_id where f.provider_event_id = $1 and m.market_key = $2 and o.outcome_key = $3`,
    [eventId, market, key],
  );
  return o as { id: string; offered_odds: string };
}

const placeSingle = (player: string, outcomeId: string, odds: string, stake: bigint, k = key()) =>
  db.user(player, `select place_bets($1::jsonb, $2) r`, [
    JSON.stringify({ mode: "singles", stake: stake.toString(), selections: [{ outcome_id: outcomeId, odds }] }), k,
  ]);

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.bootstrapSuperAdmin(CR(1000));
  adminA = await db.provision(owner, "admin", "admin_a");
  adminB = await db.provision(owner, "admin", "admin_b");
  playerA1 = await db.provision(adminA, "player", "player_a1");
  playerB1 = await db.provision(adminB, "player", "player_b1");
  await db.user(owner, `select allocate_credits($1, $2, null, $3)`, [adminA, CR(100).toString(), key()]);
  await db.user(owner, `select allocate_credits($1, $2, null, $3)`, [adminB, CR(100).toString(), key()]);
  await db.user(adminA, `select transfer_to_player($1, $2, null, $3)`, [playerA1, CR(10).toString(), key()]);
  await db.user(adminB, `select transfer_to_player($1, $2, null, $3)`, [playerB1, CR(10).toString(), key()]);
  // Zero margin so provider odds of 2.00 are offered as 2.00.
  await db.user(owner, `select admin_update_setting('sportsbook.margin_bps', '0'::jsonb)`);
  await db.service(`select svc_upsert_odds('the_odds_api', $1::jsonb)`, [JSON.stringify([event("E1"), event("E2"), event("E3")])]);
});
afterAll(async () => db.destroy());

describe("odds ingestion & pricing", () => {
  it("stores fixtures, markets and outcomes from the provider", async () => {
    const [n] = await db.sql(`select count(*)::int n from fixtures`);
    expect(n.n).toBe(3);
    const o = await outcome("E1", "h2h", "home");
    expect(o.offered_odds).toBe("2.00");
  });

  it("applies the configured margin to offered odds and keeps source odds", async () => {
    await db.user(owner, `select admin_update_setting('sportsbook.margin_bps', '500'::jsonb)`);
    await db.service(`select svc_upsert_odds('the_odds_api', $1::jsonb)`, [JSON.stringify([event("M1", { home: 3.0 })])]);
    const [o] = await db.sql(
      `select o.source_odds, o.offered_odds from market_outcomes o join betting_markets m on m.id = o.market_id
       join fixtures f on f.id = m.fixture_id where f.provider_event_id = 'M1' and o.outcome_key = 'home' and m.market_key = 'h2h'`,
    );
    expect(o.source_odds).toBe("3.000");
    expect(o.offered_odds).toBe("2.90"); // 1 + 2.0 * 0.95
    await db.user(owner, `select admin_update_setting('sportsbook.margin_bps', '0'::jsonb)`);
  });

  it("suspends markets the provider stops offering instead of inventing them", async () => {
    const ev = event("E3");
    ev.markets = ev.markets.filter((m: any) => m.market_key === "h2h");
    await db.service(`select svc_upsert_odds('the_odds_api', $1::jsonb)`, [JSON.stringify([ev])]);
    const [m] = await db.sql(
      `select m.status from betting_markets m join fixtures f on f.id = m.fixture_id where f.provider_event_id = 'E3' and m.market_key = 'totals'`,
    );
    expect(m.status).toBe("suspended");
  });

  it("only the service role can ingest odds", async () => {
    await expectError(db.user(owner, `select svc_upsert_odds('x', '[]'::jsonb)`), /permission denied/);
  });
});

describe("Test D — sports bet", () => {
  it("2 Cr at 2.00 reduces balance by 2, a win pays 4, settlement is idempotent", async () => {
    const o = await outcome("E1", "h2h", "home");
    const before = await db.balance(playerA1);
    const [r] = await placeSingle(playerA1, o.id, "2.00", CR(2));
    expect(BigInt(r.r.balance)).toBe(before - CR(2));
    expect(await db.balance(playerA1)).toBe(before - CR(2));

    const [bet] = await db.sql(`select * from bets where id = $1`, [r.r.bets[0]]);
    expect(bet.potential_payout).toBe(CR(4).toString());
    expect(bet.total_odds).toBe("2.0000");

    const scores = JSON.stringify([{ event_id: "E1", completed: true, home_score: 2, away_score: 1 }]);
    await db.service(`select svc_update_scores('the_odds_api', $1::jsonb)`, [scores]);
    expect(await db.balance(playerA1)).toBe(before - CR(2) + CR(4));

    // Re-running settlement changes nothing.
    await db.service(`select svc_update_scores('the_odds_api', $1::jsonb)`, [scores]);
    const [fx] = await db.sql(`select id from fixtures where provider_event_id = 'E1'`);
    await db.service(`select svc_settle_fixture($1)`, [fx.id]);
    expect(await db.balance(playerA1)).toBe(before + CR(2));
    const [s] = await db.sql(`select count(*)::int n from bet_settlements where bet_id = $1`, [bet.id]);
    expect(s.n).toBe(1);
    const [b2] = await db.sql(`select status, payout from bets where id = $1`, [bet.id]);
    expect(b2).toEqual({ status: "won", payout: CR(4).toString() });
    const [rec] = await db.user(owner, `select reconcile_ledger() r`);
    expect(rec.r.ok).toBe(true);
  });

  it("losing and void outcomes", async () => {
    const away = await outcome("E2", "h2h", "away");
    const over = await outcome("E2", "totals", "over");
    const before = await db.balance(playerA1);
    await placeSingle(playerA1, away.id, away.offered_odds, 100n);
    const acc = await db.user(playerA1, `select place_bets($1::jsonb, $2) r`, [
      JSON.stringify({ mode: "singles", stake: "100", selections: [{ outcome_id: over.id, odds: over.offered_odds }] }), key(),
    ]);
    expect(acc[0].r.bets).toHaveLength(1);
    await db.service(`select svc_update_scores('the_odds_api', $1::jsonb)`, [
      JSON.stringify([{ event_id: "E2", completed: true, home_score: 2, away_score: 1 }]),
    ]);
    // away lost; over 2.5 with 3 goals won at 1.90
    expect(await db.balance(playerA1)).toBe(before - 200n + 190n);
  });

  it("an accumulator multiplies odds and settles when every leg is graded", async () => {
    await db.service(`select svc_upsert_odds('the_odds_api', $1::jsonb)`, [JSON.stringify([event("A1"), event("A2", { away: 2.5 })])]);
    const l1 = await outcome("A1", "h2h", "home");
    const l2 = await outcome("A2", "h2h", "away");
    const before = await db.balance(playerA1);
    const [r] = await db.user(playerA1, `select place_bets($1::jsonb, $2) r`, [
      JSON.stringify({ mode: "accumulator", stake: "100", selections: [
        { outcome_id: l1.id, odds: l1.offered_odds }, { outcome_id: l2.id, odds: l2.offered_odds }] }), key(),
    ]);
    const [bet] = await db.sql(`select total_odds, potential_payout from bets where id = $1`, [r.r.bets[0]]);
    expect(bet).toEqual({ total_odds: "5.0000", potential_payout: "500" });
    await db.service(`select svc_update_scores('the_odds_api', $1::jsonb)`, [JSON.stringify([{ event_id: "A1", completed: true, home_score: 1, away_score: 0 }])]);
    expect(await db.balance(playerA1)).toBe(before - 100n);
    await db.service(`select svc_update_scores('the_odds_api', $1::jsonb)`, [JSON.stringify([{ event_id: "A2", completed: true, home_score: 0, away_score: 3 }])]);
    expect(await db.balance(playerA1)).toBe(before + 400n);
  });

  it("rejects stale quotes, changed odds, insufficient balance and same-event accumulators", async () => {
    await db.service(`select svc_upsert_odds('the_odds_api', $1::jsonb)`, [JSON.stringify([event("V1")])]);
    const o = await outcome("V1", "h2h", "home");
    await expectError(placeSingle(playerA1, o.id, "2.10", 100n), "ODDS_CHANGED");
    await expectError(placeSingle(playerA1, o.id, "2.00", CR(10_000)), /INSUFFICIENT_FUNDS|STAKE_TOO_HIGH/);
    const d = await outcome("V1", "h2h", "draw");
    await expectError(db.user(playerA1, `select place_bets($1::jsonb, $2)`, [
      JSON.stringify({ mode: "accumulator", stake: "100", selections: [{ outcome_id: o.id, odds: "2.00" }, { outcome_id: d.id, odds: d.offered_odds }] }), key(),
    ]), "SAME_EVENT_IN_ACCUMULATOR");

    // Odds older than the pre-match freshness window are refused.
    await db.sql(`update betting_markets set last_odds_at = now() - interval '1 day' where fixture_id = (select id from fixtures where provider_event_id = 'V1')`);
    await expectError(placeSingle(playerA1, o.id, "2.00", 100n), "ODDS_STALE");
  });

  it("live events need fresh odds; suspended markets refuse bets", async () => {
    const live = event("L1", { commence: new Date(Date.now() - 600_000).toISOString() });
    await db.service(`select svc_upsert_odds('the_odds_api', $1::jsonb)`, [JSON.stringify([live])]);
    const o = await outcome("L1", "h2h", "home");
    const [f] = await db.sql(`select status from fixtures where provider_event_id = 'L1'`);
    expect(f.status).toBe("live");
    await placeSingle(playerA1, o.id, "2.00", 10n); // fresh: accepted
    await db.sql(`update betting_markets set last_odds_at = now() - interval '5 minutes' where fixture_id = (select id from fixtures where provider_event_id = 'L1')`);
    await expectError(placeSingle(playerA1, o.id, "2.00", 10n), "ODDS_STALE");
    const n = await db.service(`select svc_suspend_stale_markets() n`);
    expect(n[0].n).toBeGreaterThan(0);
    await expectError(placeSingle(playerA1, o.id, "2.00", 10n), "MARKET_SUSPENDED");
  });

  it("slip idempotency key prevents double placement", async () => {
    await db.service(`select svc_upsert_odds('the_odds_api', $1::jsonb)`, [JSON.stringify([event("I1")])]);
    const o = await outcome("I1", "h2h", "home");
    const k = key();
    const before = await db.balance(playerA1);
    const [r1] = await placeSingle(playerA1, o.id, "2.00", 50n, k);
    const [r2] = await placeSingle(playerA1, o.id, "2.00", 50n, k);
    expect(r2.r.replayed).toBe(true);
    expect(r2.r.slip_id).toBe(r1.r.slip_id);
    expect(await db.balance(playerA1)).toBe(before - 50n);
  });

  it("accepted bet terms cannot be changed afterwards", async () => {
    const [b] = await db.sql(`select id from bets where status = 'open' limit 1`);
    await expectError(db.sql(`update bets set total_odds = 100 where id = $1`, [b.id]), "BET_TERMS_IMMUTABLE");
    await expectError(db.sql(`update bet_selections set odds = 100 where bet_id = $1`, [b.id]), "BET_TERMS_IMMUTABLE");
  });

  it("Main Admin can cancel a fixture; all bets on it are refunded", async () => {
    await db.service(`select svc_upsert_odds('the_odds_api', $1::jsonb)`, [JSON.stringify([event("C1")])]);
    const o = await outcome("C1", "h2h", "home");
    const before = await db.balance(playerB1);
    await placeSingle(playerB1, o.id, "2.00", 300n);
    const [fx] = await db.sql(`select id from fixtures where provider_event_id = 'C1'`);
    await expectError(db.user(adminB, `select admin_cancel_fixture($1, 'x')`, [fx.id]), "FORBIDDEN");
    await db.user(owner, `select admin_cancel_fixture($1, 'abandoned')`, [fx.id]);
    expect(await db.balance(playerB1)).toBe(before);
    const [b] = await db.sql(`select status from bets where user_id = $1 order by placed_at desc limit 1`, [playerB1]);
    expect(b.status).toBe("void");
  });
});

describe("grading rules", () => {
  const grade = async (market: string, hasDraw: boolean, k: string, point: number | null, h: number, a: number) => {
    const [r] = await db.sql(`select app.grade_outcome($1, $2, $3, $4, $5, $6) g`, [market, hasDraw, k, point, h, a]);
    return r.g;
  };
  it("grades h2h, totals, spreads (incl. Asian quarter lines), btts, double chance", async () => {
    expect(await grade("h2h", true, "draw", null, 1, 1)).toBe("won");
    expect(await grade("h2h", false, "home", null, 100, 100)).toBe("void");
    expect(await grade("totals", false, "over", 2.5, 2, 1)).toBe("won");
    expect(await grade("totals", false, "under", 3, 2, 1)).toBe("void");
    expect(await grade("totals", false, "over", 2.75, 2, 1)).toBe("half_won");
    expect(await grade("totals", false, "over", 3.25, 2, 1)).toBe("half_lost");
    expect(await grade("spreads", false, "home", -1.5, 2, 1)).toBe("lost");
    expect(await grade("spreads", false, "away", 0.25, 1, 1)).toBe("half_won");
    expect(await grade("spreads", false, "home", -0.75, 2, 1)).toBe("half_won");
    expect(await grade("btts", false, "yes", null, 2, 0)).toBe("lost");
    expect(await grade("double_chance", false, "X2", null, 0, 0)).toBe("won");
    expect(await grade("period_winner", false, "home", null, 1, 0)).toBeNull();
  });
});

describe("Test F — sportsbook isolation", () => {
  it("bets are visible to the player and their own admin only", async () => {
    const mine = await db.user(playerA1, `select user_id from bets`);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((b) => b.user_id === playerA1)).toBe(true);
    const adminBView = await db.user(adminB, `select user_id from bets`);
    expect(adminBView.every((b) => b.user_id === playerB1)).toBe(true);
    expect(await db.user(owner, `select * from bets`)).toHaveLength(0);
    expect(await db.user(owner, `select * from bet_selections`)).toHaveLength(0);
    expect(await db.user(playerB1, `select * from bet_selections s join bets b on b.id = s.bet_id where b.user_id = $1`, [playerA1])).toHaveLength(0);
  });

  it("Main Admin overview is aggregate only", async () => {
    const [r] = await db.user(owner, `select super_admin_overview() r`);
    const text = JSON.stringify(r.r);
    expect(text).not.toContain(playerA1);
    expect(text).not.toContain("player_a1");
    expect(r.r.admins.total).toBe(2);
    expect(Number(r.r.sportsbook.open_bets)).toBeGreaterThanOrEqual(0);
  });

  it("secondary admin reports cover only their tenant", async () => {
    const [r] = await db.user(adminB, `select admin_overview() r`);
    expect(r.r.players.total).toBe(1);
    await expectError(db.user(adminB, `select admin_player_report($1)`, [playerA1]), "PLAYER_NOT_FOUND");
    const [ok] = await db.user(adminA, `select admin_player_report($1) r`, [playerA1]);
    expect(ok.r.profile.username).toBe("player_a1");
  });
});

describe("integration configuration", () => {
  it("rejects a pasted provider list instead of a settings object", async () => {
    await expectError(db.user(owner, `select admin_update_integration('the_odds_api', true, '[{"key": "soccer_epl"}]'::jsonb)`), "INVALID_CONFIG");
    await expectError(db.user(owner, `select admin_update_integration('the_odds_api', true, '{"sports": []}'::jsonb)`), "INVALID_CONFIG");
    await db.user(owner, `select admin_update_integration('the_odds_api', true, '{"sports": ["soccer_epl"], "markets": "h2h"}'::jsonb)`);
    const [s] = await db.sql(`select value from platform_settings where key = 'sportsbook.prematch_odds_max_age_seconds'`);
    expect(Number(s.value)).toBeGreaterThan(12 * 3600);
  });
});
