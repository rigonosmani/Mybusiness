import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectError, key } from "./harness";

let db: TestDb;
let owner: string, admin: string, p1: string;
const play = (sql: string, params: unknown[] = []) => db.user(p1, `select ${sql} r`, params).then((rows) => rows[0].r);

/** Force the crash point and the flight time of a round (test only). */
async function rig(round: string, point: number, secondsAgo: number) {
  await db.sql(`update app.round_secrets set secret = jsonb_build_object('crash_point', $2::numeric) where round_id = $1`, [round, point]);
  await db.sql(`update game_rounds set state = jsonb_set(state, '{started_at}', to_jsonb(clock_timestamp() - make_interval(secs => $2))) where id = $1`, [round, secondsAgo]);
}
const multAt = (s: number) => Math.floor(Math.exp(0.08 * s) * 100) / 100;

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.bootstrapSuperAdmin(10_000_000n);
  admin = await db.provision(owner, "admin", "admin_j");
  p1 = await db.provision(admin, "player", "player_j");
  await db.user(owner, `select allocate_credits($1, 2000000, null, $2)`, [admin, key()]);
  await db.user(admin, `select transfer_to_player($1, 1000000, null, $2)`, [p1, key()]);
});
afterAll(async () => db.destroy());

describe("Kometa Jet", () => {
  it("two bets: one cashed manually, one lost at the crash", async () => {
    const before = await db.balance(p1);
    const r = await play(`jet_start('[{"stake":1000},{"stake":500}]'::jsonb, $1)`, [key()]);
    expect(r.stake).toBe(1500);
    expect(r.state.cashed).toEqual([null, null]);
    await expectError(play(`jet_start('[{"stake":100}]'::jsonb, $1)`, [key()]), "ACTIVE_ROUND_EXISTS");
    await rig(r.round_id, 5, 10); // flying at ~2.22×
    const c = await play(`jet_cashout($1, 0)`, [r.round_id]);
    expect(c.status).toBe("active");
    const m0 = Number(c.state.cashed[0]);
    expect(m0).toBeGreaterThanOrEqual(multAt(10));
    expect(m0).toBeLessThan(2.4);
    await rig(r.round_id, 5, 30); // past 5× → crashed
    const done = await play(`jet_status($1)`, [r.round_id]);
    expect(done.status).toBe("won");
    expect(done.state.cashed[1]).toBeNull();
    expect(done.payout).toBe(Math.floor(1000 * m0));
    expect(await db.balance(p1)).toBe(before - 1500n + BigInt(done.payout));
  });

  it("auto cash-out pays exactly the target when reached before the crash", async () => {
    const r = await play(`jet_start('[{"stake":1000,"auto":1.5},{"stake":1000,"auto":3}]'::jsonb, $1)`, [key()]);
    await rig(r.round_id, 2.0, 20); // 4.95× now, crash at 2.0 → bet1 auto 1.5 ✓, bet2 auto 3 ✗
    const done = await play(`jet_status($1)`, [r.round_id]);
    expect(done.state.cashed).toEqual([1.5, null]);
    expect(done.payout).toBe(1500);
    expect(done.status).toBe("lost");
  });

  it("validates bets", async () => {
    await expectError(play(`jet_start('[]'::jsonb, $1)`, [key()]), "INVALID_PARAMS");
    await expectError(play(`jet_start('[{"stake":100},{"stake":100},{"stake":100}]'::jsonb, $1)`, [key()]), "INVALID_PARAMS");
    await expectError(play(`jet_start('[{"stake":100,"auto":1}]'::jsonb, $1)`, [key()]), "INVALID_PARAMS");
    await expectError(play(`jet_start('[{"stake":1}]'::jsonb, $1)`, [key()]), "STAKE_TOO_LOW");
  });
});

describe("Hot Fruits 5", () => {
  it("has the closed-form RTP and a scaled paytable", async () => {
    const [{ ev }] = await db.sql(`select app.lines_ev(config) ev from game_configurations where game_id = 'slot_hot_fruits'`);
    expect(Number(ev)).toBeCloseTo(0.281222, 5);
    const pt = await play(`lines_paytable('slot_hot_fruits')`);
    expect(Number(pt.rtp)).toBe(96);
    const seven = pt.symbols.find((s: { id: string }) => s.id === "seven");
    expect(Number(seven.pays["5"])).toBeCloseTo(1000 * 0.96 / Number(ev), 2);
  });

  it("spins settle atomically and wins match the grid", async () => {
    let total = 0n;
    for (let i = 0; i < 25; i++) {
      const before = await db.balance(p1);
      const r = await play(`play_lines('slot_hot_fruits', 100, $1)`, [key()]);
      expect(r.state.grid).toHaveLength(15);
      const sum = r.state.wins.reduce((a: number, w: { multiplier: number }) => a + Number(w.multiplier), 0);
      expect(r.payout > 0).toBe(r.state.wins.length > 0);
      expect(Math.abs(r.payout - 100 * sum)).toBeLessThanOrEqual(1);
      for (const w of r.state.wins.filter((x: { line: number | null }) => x.line !== null)) {
        expect(w.count).toBeGreaterThanOrEqual(w.symbol === "cherry" ? 2 : 3);
      }
      expect(await db.balance(p1)).toBe(before - 100n + BigInt(r.payout));
      total += BigInt(r.payout);
    }
    await expectError(play(`play_slot('slot_hot_fruits', 100, $1)`, [key()]), "GAME_UNAVAILABLE");
    await expectError(play(`play_lines('slot_cosmic_cascade', 100, $1)`, [key()]), "GAME_UNAVAILABLE");
  });
});
