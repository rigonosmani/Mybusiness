import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectError, key } from "./harness";
import { floats, outcomes, sha256Hex, shuffle } from "../../../src/lib/fairness";

let db: TestDb;
let owner: string, adminA: string, adminB: string, p1: string, p2: string;
const play = (sql: string, params: unknown[] = [], who = () => p1) =>
  db.user(who(), `select ${sql} r`, params).then((rows) => rows[0].r);

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.bootstrapSuperAdmin(10_000_000n);
  adminA = await db.provision(owner, "admin", "admin_a");
  adminB = await db.provision(owner, "admin", "admin_b");
  p1 = await db.provision(adminA, "player", "player_a1");
  p2 = await db.provision(adminB, "player", "player_b1");
  await db.user(owner, `select allocate_credits($1, 2000000, null, $2)`, [adminA, key()]);
  await db.user(owner, `select allocate_credits($1, 2000000, null, $2)`, [adminB, key()]);
  await db.user(adminA, `select transfer_to_player($1, 1000000, null, $2)`, [p1, key()]);
  await db.user(adminB, `select transfer_to_player($1, 1000000, null, $2)`, [p2, key()]);
});
afterAll(async () => db.destroy());

describe("instant games settle atomically", () => {
  it("dice debits the stake and pays stake × multiplier", async () => {
    const before = await db.balance(p1);
    const r = await play(`play_dice(1000, 50.00, 'under', null)`);
    expect(r.status).toMatch(/won|lost/);
    expect(Number(r.state.payout_multiplier)).toBeCloseTo(1.98, 4); // (1 - 1%) / 0.5
    const expected = r.state.win ? before - 1000n + 1980n : before - 1000n;
    expect(await db.balance(p1)).toBe(expected);
    expect(BigInt(r.balance)).toBe(expected);
  });

  it("all instant games produce results and keep the ledger balanced", async () => {
    await play(`play_limbo(100, 2.5, null)`);
    await play(`play_coinflip(100, 'heads', null)`);
    await play(`play_roulette('[{"type":"red","amount":100},{"type":"straight","value":17,"amount":50}]'::jsonb, null)`);
    await play(`play_plinko(100, 16, 'high', null)`);
    await play(`play_keno(100, array[1,2,3,4,5], null)`);
    await play(`play_baccarat('{"banker":100,"tie":10}'::jsonb, null)`);
    await play(`play_slot('slot_neon_orchard', 100, null)`);
    await play(`play_slot('slot_astro_gems', 100, null)`);
    const [rec] = await db.user(owner, `select reconcile_ledger() r`);
    expect(rec.r.ok).toBe(true);
  });

  it("rejects invalid parameters before touching the wallet", async () => {
    const before = await db.balance(p1);
    await expectError(play(`play_dice(100, 99.5, 'under', null)`), "INVALID_PARAMS");
    await expectError(play(`play_limbo(100, 1.0, null)`), "INVALID_PARAMS");
    await expectError(play(`play_keno(100, array[1,1,2], null)`), "INVALID_PARAMS");
    await expectError(play(`play_plinko(100, 9, 'low', null)`), "INVALID_PARAMS");
    await expectError(play(`play_dice(0, 50, 'under', null)`), "STAKE_TOO_LOW");
    await expectError(play(`play_dice(999999999, 50, 'under', null)`), "STAKE_TOO_HIGH");
    expect(await db.balance(p1)).toBe(before);
  });

  it("game round idempotency key replays instead of playing twice", async () => {
    const k = key();
    const before = await db.balance(p1);
    const a = await play(`play_dice(100, 50, 'over', $1)`, [k]);
    const b = await play(`play_dice(100, 50, 'over', $1)`, [k]);
    expect(b.round_id).toBe(a.round_id);
    const delta = a.status === "won" ? BigInt(a.payout) - 100n : -100n;
    expect(await db.balance(p1)).toBe(before + delta);
  });

  it("cannot bet more than the balance", async () => {
    const poor = await db.provision(adminA, "player", "poor_player");
    await expectError(db.user(poor, `select play_dice(100, 50, 'under', null)`), "INSUFFICIENT_FUNDS");
  });
});

describe("stateful games", () => {
  it("mines: reveal until bust or cash out; mine positions stay hidden until the end", async () => {
    const r = await play(`mines_start(100, 3, null)`);
    expect(JSON.stringify(r)).not.toContain('"mines":[');
    await expectError(play(`mines_start(100, 3, null)`), "ACTIVE_ROUND_EXISTS");
    // Players cannot read round secrets.
    await expectError(db.user(p1, `select * from app.round_secrets`), /permission denied/);
    let cur = r;
    for (let tile = 0; tile < 25 && cur.status === "active"; tile++) {
      cur = await play(`mines_reveal($1, $2)`, [r.round_id, tile]);
      if (cur.status === "active" && cur.state.revealed.length === 2) {
        expect(Number(cur.state.multiplier)).toBeCloseTo(0.98 * (25 / 22) * (24 / 21), 3);
        cur = await play(`mines_cashout($1)`, [r.round_id]);
      }
    }
    expect(cur.status).not.toBe("active");
    expect(cur.state.mines).toHaveLength(3);
    // Another player cannot act on this round.
    await expectError(db.user(p2, `select mines_reveal($1, 0)`, [r.round_id]), "ROUND_NOT_FOUND");
  });

  it("hi-lo, blackjack and video poker run to completion", async () => {
    let h = await play(`hilo_start(100, null)`);
    for (let i = 0; i < 30 && h.status === "active"; i++) {
      const cards = h.state.cards;
      const rank = (cards[cards.length - 1] % 13) + 1;
      h = await play(`hilo_guess($1, $2)`, [h.round_id, rank <= 7 ? "higher" : "lower"]);
      if (h.status === "active" && i >= 1) h = await play(`hilo_cashout($1)`, [h.round_id]);
    }
    expect(h.status).not.toBe("active");

    let bj = await play(`blackjack_start(100, null)`);
    while (bj.status === "active") {
      bj = await play(`blackjack_action($1, $2)`, [bj.round_id, bj.state.player_value < 17 ? "hit" : "stand"]);
    }
    expect(["won", "lost", "push"]).toContain(bj.status);

    const vp = await play(`videopoker_deal(100, null)`);
    const done = await play(`videopoker_draw($1, array[true,true,false,false,false])`, [vp.round_id]);
    expect(done.state.hand).toHaveLength(5);
    expect(done.state.hand.slice(0, 2)).toEqual(vp.state.hand.slice(0, 2));
  });

  it("blackjack double debits a second stake", async () => {
    for (let i = 0; i < 20; i++) {
      const before = await db.balance(p1);
      const bj = await play(`blackjack_start(100, null)`);
      if (bj.status !== "active") continue;
      const r = await play(`blackjack_action($1, 'double')`, [bj.round_id]);
      expect(r.stake).toBe(200);
      expect(await db.balance(p1)).toBe(before - 200n + BigInt(r.payout));
      return;
    }
  });

  it("crash: cash-out is evaluated with the server clock", async () => {
    const r = await play(`crash_start(100, null, null)`);
    expect(r.state.started_at).toBeTruthy();
    const out = await play(`crash_cashout($1)`, [r.round_id]);
    expect(out.status).not.toBe("active");
    // Cashing out immediately can only pay ~1.00× (or the round already crashed at 1.00).
    expect(Number(out.multiplier)).toBeLessThanOrEqual(1.01);
    // Auto cash-out at 1.01: resolves as soon as the server clock reaches it.
    const auto = await play(`crash_start(100, 1.01, null)`);
    await new Promise((res) => setTimeout(res, 300));
    const st = await play(`crash_status($1)`, [auto.round_id]);
    expect(st.status).not.toBe("active");
    if (st.status === "won") expect(Number(st.multiplier)).toBe(1.01);
  });
});

describe("Test E — house edge", () => {
  it("only the Main Admin can change it, within the allowed range", async () => {
    await expectError(db.user(adminA, `select admin_set_house_edge('dice', 300)`), "FORBIDDEN");
    await expectError(db.user(p1, `select admin_set_house_edge('dice', 300)`), "FORBIDDEN");
    await expectError(db.user(owner, `select admin_set_house_edge('dice', 5000)`), "EDGE_OUT_OF_RANGE");
    await expectError(db.user(owner, `select admin_set_house_edge('roulette', 100)`), "EDGE_NOT_CONFIGURABLE");
    await expectError(db.user(p1, `update house_edge_settings set edge_bps = 0`), /permission denied/);
  });

  it("a change applies to future rounds only", async () => {
    const before = await play(`play_dice(100, 50, 'under', null)`);
    expect(before.edge_bps).toBe(100);
    const [snapshot] = await db.sql(`select * from game_rounds where id = $1`, [before.round_id]);

    await db.user(owner, `select admin_set_house_edge('dice', 300)`);
    const after = await play(`play_dice(100, 50, 'under', null)`);
    expect(after.edge_bps).toBe(300);
    expect(Number(after.state.payout_multiplier)).toBeCloseTo(1.94, 4);

    const [unchanged] = await db.sql(`select * from game_rounds where id = $1`, [before.round_id]);
    expect(unchanged).toEqual(snapshot);
    // Completed rounds cannot be rewritten, even by the database owner.
    await expectError(db.sql(`update game_rounds set payout = 0 where id = $1`, [before.round_id]), "ROUND_FINALIZED");
    const [hist] = await db.sql(`select old_bps, new_bps from house_edge_history where game_id = 'dice'`);
    expect(hist).toEqual({ old_bps: 100, new_bps: 300 });
    await db.user(owner, `select admin_set_house_edge('dice', 100)`);
  });

  it("an open sports bet keeps its accepted odds when margin changes", async () => {
    // Covered in sportsbook tests via BET_TERMS_IMMUTABLE; here: margin is a separate setting.
    await expectError(db.user(adminA, `select admin_update_setting('sportsbook.margin_bps', '100'::jsonb)`), "FORBIDDEN");
    await expectError(db.user(owner, `select admin_update_setting('real_money_enabled', 'true'::jsonb)`), "SETTING_LOCKED");
    await expectError(db.sql(`update platform_settings set value = 'true' where key = 'real_money_enabled'`), /real_money_disabled/);
  });

  it("game tables are scaled to exactly 1 - edge", async () => {
    const [p] = await db.sql(`
      select sum(app.choose(16, k - 1) / power(2::numeric, 16) * t[k]) ev
      from (select app.plinko_table(16, 'high', 0.02) t) x, generate_series(1, 17) k`);
    expect(Number(p.ev)).toBeGreaterThan(0.979);
    expect(Number(p.ev)).toBeLessThanOrEqual(0.98);
    const [k] = await db.sql(`
      select sum(app.choose(10, h) * app.choose(30, 6 - h) / app.choose(40, 6) * t[h + 1]) ev
      from (select app.keno_table(6, 0.02) t) x, generate_series(0, 6) h`);
    expect(Number(k.ev)).toBeGreaterThan(0.979);
    expect(Number(k.ev)).toBeLessThanOrEqual(0.98);
    const [m] = await db.sql(`select app.mines_multiplier(3, 1, 0.01) m`);
    expect(Number(m.m)).toBeCloseTo(0.99 * 25 / 22, 4);
    const [s] = await db.sql(`
      select sum(power((s->>'weight')::numeric / 100, 3) * (s->>'pay')::numeric) * app.slot_scale(c.config, 0.04) rtp
      from game_configurations c, jsonb_array_elements(c.config->'symbols') s where c.game_id = 'slot_neon_orchard' group by c.config`);
    expect(Number(s.rtp)).toBeCloseTo(0.96, 6);
  });

  it("disabled games cannot be played", async () => {
    await db.user(owner, `select admin_set_game_enabled('coinflip', false)`);
    await expectError(play(`play_coinflip(100, 'heads', null)`), "GAME_UNAVAILABLE");
    await db.user(owner, `select admin_set_game_enabled('coinflip', true)`);
  });
});

describe("provably fair", () => {
  it("rounds can be verified after rotating the seed pair", async () => {
    const fair = await play(`get_fairness()`);
    const dice = await play(`play_dice(100, 50, 'under', null)`);
    const keno = await play(`play_keno(100, array[3,7,11], null)`);
    const plinko = await play(`play_plinko(100, 12, 'medium', null)`);
    const mines = await play(`mines_start(100, 5, null)`);
    const minesEnd = await play(`mines_reveal($1, 12)`, [mines.round_id]);
    const finalMines = minesEnd.status === "active" ? await play(`mines_cashout($1)`, [mines.round_id]) : minesEnd;
    expect(dice.server_seed_hash).toBe(fair.active.server_seed_hash);

    const rot = await play(`rotate_seed('my-new-seed')`);
    const serverSeed = rot.previous.server_seed;
    expect(await sha256Hex(serverSeed)).toBe(fair.active.server_seed_hash);
    expect(rot.active.client_seed).toBe("my-new-seed");

    const seed = (n: number) => ({ serverSeed, clientSeed: dice.client_seed, nonce: n });
    expect(outcomes.dice(await floats(seed(dice.nonce), 1))).toBe(Number(dice.state.roll));
    expect(outcomes.keno(await floats(seed(keno.nonce), 10))).toEqual(keno.state.drawn);
    expect(outcomes.plinko(await floats(seed(plinko.nonce), 12), 12).bucket).toBe(plinko.state.bucket);
    expect(outcomes.mines(await floats(seed(mines.nonce), 5), 5)).toEqual(finalMines.state.mines);
    // Nonces increase by one per round.
    expect([dice.nonce, keno.nonce, plinko.nonce, mines.nonce]).toEqual([dice.nonce, dice.nonce + 1, dice.nonce + 2, dice.nonce + 3]);
  });

  it("the TS float stream matches app.pf_float exactly", async () => {
    const rows = await db.sql(`select i, app.pf_float('srv', 'cli', 7, i) f from generate_series(0, 19) i`);
    const fs = await floats({ serverSeed: "srv", clientSeed: "cli", nonce: 7 }, 20);
    expect(rows.map((r) => r.f)).toEqual(fs);
    expect(new Set(shuffle(fs, 40, 10)).size).toBe(10);
  });

  it("server seeds are never readable before rotation", async () => {
    await expectError(db.user(p1, `select * from app.seed_secrets`), /permission denied/);
    const own = await db.user(p1, `select revealed_server_seed from fairness_seeds where status = 'active'`);
    expect(own[0].revealed_server_seed).toBeNull();
    expect(await db.user(p1, `select * from fairness_seeds where user_id = $1`, [p2])).toHaveLength(0);
  });

  it("seed cannot rotate while a round is in progress", async () => {
    const r = await play(`hilo_start(100, null)`);
    await expectError(play(`rotate_seed(null)`), "ACTIVE_ROUND_EXISTS");
    await play(`hilo_guess($1, 'skip')`, [r.round_id]);
  });
});

describe("Test F — casino isolation", () => {
  it("rounds are visible to the player and their admin only", async () => {
    expect((await db.user(p2, `select user_id from game_rounds`)).every((r) => r.user_id === p2)).toBe(true);
    expect((await db.user(adminB, `select user_id from game_results`)).every((r) => r.user_id === p2)).toBe(true);
    expect(await db.user(owner, `select * from game_rounds`)).toHaveLength(0);
    expect(await db.user(owner, `select * from game_results`)).toHaveLength(0);
    const [ov] = await db.user(owner, `select super_admin_overview() r`);
    expect(ov.r.games.length).toBeGreaterThan(0);
    expect(JSON.stringify(ov.r)).not.toContain(p1);
  });

  it("limits and self-exclusion are enforced server-side", async () => {
    await db.user(p2, `select set_my_limits(null, null, 50)`);
    await expectError(db.user(p2, `select play_dice(100, 50, 'under', null)`), "LIMIT_MAX_STAKE");
    // Raising a limit is delayed by the cooling-off period.
    const [r] = await db.user(p2, `select set_my_limits(null, null, 500) r`);
    expect(r.r.pending).toBe(true);
    await expectError(db.user(p2, `select play_dice(100, 50, 'under', null)`), "LIMIT_MAX_STAKE");
    await db.user(p2, `select request_self_exclusion(1)`);
    await expectError(db.user(p2, `select play_dice(10, 50, 'under', null)`), "SELF_EXCLUDED");
  });
});

describe("licensed provider wallet callbacks", () => {
  it("refuse to launch while the provider is not configured", async () => {
    await db.sql(`insert into casino_games (id, provider_id, name, category, enabled, external_game_id) values ('ext_demo', 'licensed_aggregator', 'External', 'slots', true, 'X-1')`);
    await expectError(play(`casino_create_session('ext_demo')`), "PROVIDER_NOT_CONFIGURED");
  });

  it("debit / credit / rollback are idempotent per provider transaction id", async () => {
    await db.sql(`update casino_providers set status = 'active' where id = 'licensed_aggregator'`);
    const s = await play(`casino_create_session('ext_demo')`);
    const before = await db.balance(p1);
    const call = (action: string, tx: string, amount: number, ref: string | null = null) =>
      db.service(`select svc_provider_wallet('licensed_aggregator', $1, $2, $3, 'R-1', $4, $5) r`, [s.launch_token, action, tx, amount, ref]);
    await call("debit", "T1", 500);
    await call("debit", "T1", 500); // duplicate
    expect(await db.balance(p1)).toBe(before - 500n);
    await call("credit", "T2", 1200);
    expect(await db.balance(p1)).toBe(before + 700n);
    await call("debit", "T3", 100);
    await call("rollback", "T4", 0, "T3");
    await call("rollback", "T4", 0, "T3");
    expect(await db.balance(p1)).toBe(before + 700n);
    await expectError(db.service(`select svc_provider_wallet('licensed_aggregator', 'bad-token', 'debit', 'T9', 'R-1', 1, null)`), "SESSION_INVALID");
    await expectError(db.user(p1, `select svc_provider_wallet('licensed_aggregator', $1, 'credit', 'T10', 'R-1', 99999, null)`, [s.launch_token]), /permission denied/);
    await db.sql(`update casino_providers set status = 'not_configured' where id = 'licensed_aggregator'`);
  });
});

describe("provider configuration from the admin panel", () => {
  const KEY = "k".repeat(40);
  it("only the Main Admin can store secrets; values are encrypted and never readable by users", async () => {
    await expectError(db.service(`select svc_set_integration_secret($1, 'aal1', 'the_odds_api', 'api_key', 'abc12345', $2)`, [adminA, KEY]), "FORBIDDEN");
    await expectError(db.service(`select svc_set_integration_secret($1, 'aal1', 'the_odds_api', 'api_key', 'abc12345', 'short')`, [owner]), "SECRETS_KEY_NOT_CONFIGURED");
    const [r] = await db.service(`select svc_set_integration_secret($1, 'aal1', 'the_odds_api', 'api_key', 'my-odds-key-9876', $2) r`, [owner, KEY]);
    expect(r.r).toEqual({ configured: true, last4: "9876" });
    const [raw] = await db.sql(`select convert_from(ciphertext, 'latin1') c from app.integration_secrets where integration_id = 'the_odds_api'`);
    expect(raw.c).not.toContain("my-odds-key");
    const [dec] = await db.service(`select svc_get_integration_secret('the_odds_api', 'api_key', $1) v`, [KEY]);
    expect(dec.v).toBe("my-odds-key-9876");
    await expectError(db.user(owner, `select svc_get_integration_secret('the_odds_api', 'api_key', $1)`, [KEY]), /permission denied/);
    const [st] = await db.user(owner, `select integration_secret_status() s`);
    expect(JSON.stringify(st.s)).not.toContain("my-odds-key");
    await expectError(db.user(adminA, `select integration_secret_status()`), "FORBIDDEN");
    const audit = await db.sql(`select details::text d from audit_logs where action = 'integration.secret_set'`);
    expect(audit.every((a) => !a.d.includes("my-odds-key"))).toBe(true);
  });

  it("an aggregator can only be activated once URL and secrets are configured", async () => {
    await expectError(db.user(owner, `select admin_update_provider('licensed_aggregator', 'active', 'https://api.aggregator.example', null, '{"operator_id":"op1"}')`), "PROVIDER_INCOMPLETE");
    await expectError(db.user(owner, `select admin_update_provider('licensed_aggregator', 'disabled', null, null, '{"api_key":"x"}')`), "SECRETS_NOT_ALLOWED");
    await expectError(db.user(owner, `select admin_update_provider('licensed_aggregator', 'disabled', 'http://insecure.example', null, null)`), "INVALID_URL");
    await db.service(`select svc_set_integration_secret($1, 'aal1', 'licensed_aggregator', 'api_key', 'agg-key-1111', $2)`, [owner, KEY]);
    await db.service(`select svc_set_integration_secret($1, 'aal1', 'licensed_aggregator', 'callback_secret', 'cb-secret-2222', $2)`, [owner, KEY]);
    await db.user(owner, `select admin_update_provider('licensed_aggregator', 'active', 'https://api.aggregator.example', 'LIC-1', '{"operator_id":"op1"}')`);
    await expectError(db.user(adminA, `select admin_update_provider('licensed_aggregator', 'disabled', null, null, null)`), "FORBIDDEN");
  });

  it("imports the provider catalogue and launches a session with wallet context", async () => {
    const [r] = await db.user(owner, `select admin_import_games('licensed_aggregator', $1::jsonb) r`, [JSON.stringify([
      { external_game_id: "vs20demo", name: "Demo Title", category: "slots", thumbnail: "https://cdn.example/x.png", rtp: 96.5 },
      { external_game_id: "live-bj-1", name: "Live Table", category: "live" },
    ])]);
    expect(r.r.imported).toBe(2);
    await expectError(db.user(owner, `select admin_import_games('licensed_aggregator', '[{"external_game_id":"a","name":"b","thumbnail":"http://x"}]'::jsonb)`), "INVALID_URL");
    const s = await play(`casino_create_session('licensed_aggregator_vs20demo')`);
    const [ctx] = await db.service(`select svc_launch_context($1) c`, [s.session_id]);
    expect(ctx.c.external_game_id).toBe("vs20demo");
    expect(ctx.c.api_base_url).toBe("https://api.aggregator.example");
    const [bal] = await db.service(`select svc_provider_balance('licensed_aggregator', $1) b`, [s.launch_token]);
    expect(BigInt(bal.b.balance)).toBe(await db.balance(p1));
    await db.sql(`update casino_providers set status = 'not_configured' where id = 'licensed_aggregator'`);
  });
});
