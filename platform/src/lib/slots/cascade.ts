/**
 * "Cosmic Cascade" — 6×5 scatter-pays tumble slot. Byte-for-byte mirror of
 * app.cascade_* in the database (used to calibrate RTP by simulation and to let
 * players verify rounds). The server is authoritative.
 *
 * All weights are integers so that the comparison u32·total < acc·2³² is exact in
 * both JavaScript doubles and SQL bigint arithmetic.
 *
 * Rules: 8+ equal symbols anywhere pay; winners are removed, survivors fall,
 * new symbols drop in, repeat. 4+ scatters → free spins; in free spins
 * multiplier orbs land and, if the spin wins, multiply it by the sum of orbs on
 * the final grid. Cells are indexed c*rows + r with r = 0 at the top; new
 * symbols are drawn column by column, top to bottom.
 */
export interface CascadeSymbol { id: string; weight: number; fs_weight: number; pays: [number, number, number] }
export interface CascadeConfig {
  cols: number; rows: number; min_count: number;
  symbols: CascadeSymbol[];
  scatter: { id: string; weight: number; fs_weight: number; pays: Record<string, number>; trigger: number; spins: number; retrigger: number; extra: number };
  orb: { id: string; fs_weight: number; values: { v: number; w: number }[] };
  max_win: number; max_free_spins: number; max_tumbles: number; ev_raw: number;
}
export interface Cell { s: string; v?: number }
export interface Step { grid: Cell[]; winners: string[]; win: number }
export interface SpinResult { steps: Step[]; final: Cell[]; win: number; scatters: number; orbs: number; free: boolean }
export interface RoundResult { spins: SpinResult[]; raw: number; scatter_win: number; free_spins: number }

export function payFor(sym: CascadeSymbol, count: number) {
  return count >= 12 ? sym.pays[2] : count >= 10 ? sym.pays[1] : sym.pays[0];
}

function draw(cfg: CascadeConfig, free: boolean, next: () => number): Cell {
  const w = (x: { weight?: number; fs_weight: number }) => (free ? x.fs_weight : x.weight ?? 0);
  const total = cfg.symbols.reduce((a, s) => a + w(s), 0) + w(cfg.scatter) + (free ? cfg.orb.fs_weight : 0);
  const x = next() * total;
  let acc = 0;
  for (const s of cfg.symbols) { acc += w(s); if (x < acc) return { s: s.id }; }
  acc += w(cfg.scatter);
  if (x < acc || !free) return { s: cfg.scatter.id };
  const vt = cfg.orb.values.reduce((a, o) => a + o.w, 0);
  const y = next() * vt;
  let va = 0;
  for (const o of cfg.orb.values) { va += o.w; if (y < va) return { s: cfg.orb.id, v: o.v }; }
  return { s: cfg.orb.id, v: cfg.orb.values[cfg.orb.values.length - 1].v };
}

export function spin(cfg: CascadeConfig, free: boolean, next: () => number): SpinResult {
  const { cols, rows } = cfg;
  let grid: Cell[] = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) grid.push(draw(cfg, free, next));
  const steps: Step[] = [];
  let win = 0;
  for (let t = 0; t < cfg.max_tumbles; t++) {
    const counts = new Map<string, number>();
    for (const cell of grid) counts.set(cell.s, (counts.get(cell.s) ?? 0) + 1);
    const winners = cfg.symbols.filter((s) => (counts.get(s.id) ?? 0) >= cfg.min_count);
    if (!winners.length) break;
    const stepWin = winners.reduce((a, s) => a + payFor(s, counts.get(s.id)!), 0);
    win += stepWin;
    steps.push({ grid, winners: winners.map((s) => s.id), win: stepWin });
    const ids = new Set(winners.map((s) => s.id));
    const next_: Cell[] = [];
    for (let c = 0; c < cols; c++) {
      const kept = grid.slice(c * rows, c * rows + rows).filter((cell) => !ids.has(cell.s));
      const fresh: Cell[] = [];
      for (let i = 0; i < rows - kept.length; i++) fresh.push(draw(cfg, free, next));
      next_.push(...fresh, ...kept);
    }
    grid = next_;
  }
  const scatters = grid.filter((c) => c.s === cfg.scatter.id).length;
  const orbs = free ? grid.filter((c) => c.s === cfg.orb.id).reduce((a, c) => a + (c.v ?? 0), 0) : 0;
  if (free && win > 0 && orbs > 0) win *= orbs;
  return { steps, final: grid, win, scatters, orbs, free };
}

export function playRound(cfg: CascadeConfig, next: () => number): RoundResult {
  const base = spin(cfg, false, next);
  const spins = [base];
  let raw = base.win;
  let scatterWin = 0;
  if (base.scatters >= cfg.scatter.trigger) {
    scatterWin = cfg.scatter.pays[String(Math.min(base.scatters, 6))] ?? 0;
    raw += scatterWin;
    let left = cfg.scatter.spins;
    let played = 0;
    while (left > 0 && played < cfg.max_free_spins) {
      const s = spin(cfg, true, next);
      spins.push(s);
      raw += s.win;
      left--; played++;
      if (s.scatters >= cfg.scatter.retrigger) left += cfg.scatter.extra;
    }
  }
  return { spins, raw, scatter_win: scatterWin, free_spins: spins.length - 1 };
}

/** Pays are scaled so that the expected return equals 1 - edge. */
export function scaleFor(cfg: CascadeConfig, edgeBps: number) {
  return (1 - edgeBps / 10000) / cfg.ev_raw;
}

export const COSMIC_CASCADE: CascadeConfig = {
  cols: 6, rows: 5, min_count: 8,
  symbols: [
    { id: "nova", weight: 40, fs_weight: 40, pays: [10, 25, 50] },
    { id: "ringed", weight: 60, fs_weight: 60, pays: [2.5, 10, 25] },
    { id: "rocket", weight: 80, fs_weight: 80, pays: [2, 5, 15] },
    { id: "helmet", weight: 90, fs_weight: 90, pays: [1.5, 2, 12] },
    { id: "gem_red", weight: 110, fs_weight: 110, pays: [1, 1.5, 10] },
    { id: "gem_violet", weight: 120, fs_weight: 120, pays: [0.8, 1.2, 8] },
    { id: "gem_green", weight: 130, fs_weight: 130, pays: [0.5, 1, 5] },
    { id: "gem_blue", weight: 140, fs_weight: 140, pays: [0.4, 0.9, 4] },
    { id: "gem_amber", weight: 150, fs_weight: 150, pays: [0.25, 0.75, 2] },
  ],
  scatter: { id: "blackhole", weight: 18, fs_weight: 22, pays: { "4": 3, "5": 5, "6": 100 }, trigger: 4, spins: 10, retrigger: 3, extra: 5 },
  orb: { id: "orb", fs_weight: 32, values: [{ v: 2, w: 40 }, { v: 3, w: 22 }, { v: 5, w: 15 }, { v: 10, w: 12 }, { v: 25, w: 7 }, { v: 50, w: 3 }, { v: 100, w: 1 }] },
  max_win: 5000, max_free_spins: 50, max_tumbles: 50,
  // Expected raw return per spin from a 4,000,000-spin simulation (±0.00137, 1σ). See scripts/simulate-cascade.ts.
  ev_raw: 0.32684,
};
