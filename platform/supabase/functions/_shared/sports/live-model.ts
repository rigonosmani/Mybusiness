/**
 * Kometa live odds model (football).
 *
 * 1. Before kick-off we have consensus odds from the odds provider. We remove the
 *    bookmaker margin and fit two Poisson goal rates (home λh, away λa) that
 *    reproduce those probabilities — the standard "independent Poisson" model.
 * 2. In play, the goals still to come are Poisson(λ · remaining share of the match),
 *    added to the current score. That gives 1X2 and Over/Under probabilities for any
 *    minute and score. The platform margin is applied later, in the database.
 *
 * Pure functions only: no I/O, deterministic, unit-tested.
 */

export interface Rates { lh: number; la: number }

export interface Prematch {
  home: number; draw: number; away: number;      // decimal odds (with bookmaker margin)
  total?: { line: number; over: number; under: number } | null;
}

const MAX_GOALS = 12;

function poisson(lambda: number): number[] {
  const p = new Array<number>(MAX_GOALS + 1);
  p[0] = Math.exp(-lambda);
  for (let k = 1; k <= MAX_GOALS; k++) p[k] = (p[k - 1] * lambda) / k;
  return p;
}

/** Probabilities of the final result given remaining goal rates and the current score. */
export function outcomeProbs(rh: number, ra: number, hg: number, ag: number) {
  const ph = poisson(Math.max(rh, 0));
  const pa = poisson(Math.max(ra, 0));
  let home = 0, draw = 0, away = 0;
  const totals = new Array<number>(2 * MAX_GOALS + 1).fill(0); // distribution of REMAINING total goals
  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      const p = ph[i] * pa[j];
      const d = hg + i - (ag + j);
      if (d > 0) home += p; else if (d < 0) away += p; else draw += p;
      totals[i + j] += p;
    }
  }
  const s = home + draw + away;
  const current = hg + ag;
  /** P(final total goals > line) for a half-goal line. */
  const over = (line: number) => {
    let under = 0;
    for (let k = 0; k < totals.length; k++) if (current + k < line) under += totals[k];
    return Math.min(1, Math.max(0, 1 - under / s));
  };
  return { home: home / s, draw: draw / s, away: away / s, over, expectedRemaining: rh + ra };
}

/** Remove the bookmaker margin proportionally. */
export function fairProbs(odds: number[]): number[] {
  const inv = odds.map((o) => 1 / o);
  const s = inv.reduce((a, b) => a + b, 0);
  return inv.map((x) => x / s);
}

/** Fit Poisson goal rates to pre-match 1X2 (and Over/Under when available). */
export function fitRates(m: Prematch): Rates {
  const [qh, , qa] = fairProbs([m.home, m.draw, m.away]);
  const qo = m.total ? fairProbs([m.total.over, m.total.under])[0] : null;
  const err = (lh: number, la: number) => {
    const r = outcomeProbs(lh, la, 0, 0);
    let e = (r.home - qh) ** 2 + (r.away - qa) ** 2;
    if (qo !== null && m.total) e += (r.over(m.total.line) - qo) ** 2;
    return e;
  };
  // Coarse grid over (total goals, supremacy), then refine around the best point.
  let best = { t: 2.6, s: 0, e: Infinity };
  const search = (t0: number, t1: number, s0: number, s1: number, step: number) => {
    for (let t = t0; t <= t1 + 1e-9; t += step) {
      for (let s = s0; s <= s1 + 1e-9; s += step) {
        const lh = (t + s) / 2, la = (t - s) / 2;
        if (lh < 0.05 || la < 0.05) continue;
        const e = err(lh, la);
        if (e < best.e) best = { t, s, e };
      }
    }
  };
  search(0.6, 6, -4, 4, 0.1);
  const b = best;
  search(b.t - 0.1, b.t + 0.1, b.s - 0.1, b.s + 0.1, 0.01);
  return { lh: round4((best.t + best.s) / 2), la: round4((best.t - best.s) / 2) };
}

const round4 = (x: number) => Math.round(x * 10000) / 10000;

/** Share of the match's goal expectation still to come at a given minute (with stoppage time). */
export function remainingShare(minute: number, matchLength = 93): number {
  return Math.min(1, Math.max(0, (matchLength - minute) / matchLength));
}

export interface LiveMarket {
  market_key: "h2h" | "totals";
  line: number | null;
  outcomes: { key: string; label: string; point: number | null; prob: number }[];
}

/**
 * Live markets for a fixture: 1X2 plus Over/Under lines. Always offers the line
 * closest to 50/50, plus any extra lines that are still undecided.
 */
export function liveMarkets(opts: {
  rates: Rates; minute: number; homeGoals: number; awayGoals: number;
  homeLabel: string; awayLabel: string; extraLines?: number[];
}): LiveMarket[] {
  const share = remainingShare(opts.minute);
  const r = outcomeProbs(opts.rates.lh * share, opts.rates.la * share, opts.homeGoals, opts.awayGoals);
  const markets: LiveMarket[] = [{
    market_key: "h2h", line: null, outcomes: [
      { key: "home", label: opts.homeLabel, point: null, prob: r.home },
      { key: "draw", label: "Draw", point: null, prob: r.draw },
      { key: "away", label: opts.awayLabel, point: null, prob: r.away },
    ],
  }];
  const current = opts.homeGoals + opts.awayGoals;
  let main = current + 0.5;
  for (let line = current + 0.5; line <= current + 6.5; line += 1) {
    if (Math.abs(r.over(line) - 0.5) < Math.abs(r.over(main) - 0.5)) main = line;
  }
  const lines = new Set<number>([main, ...(opts.extraLines ?? [])]);
  for (const line of [...lines].sort((a, b) => a - b)) {
    if (line <= current || !Number.isFinite(line) || line % 1 !== 0.5) continue; // decided or non-half lines are not priced live
    const over = r.over(line);
    markets.push({
      market_key: "totals", line, outcomes: [
        { key: "over", label: "Over", point: line, prob: over },
        { key: "under", label: "Under", point: line, prob: 1 - over },
      ],
    });
  }
  return markets;
}

// ---------------------------------------------------------------------------
// Team-name matching between the odds provider and the live-score source.
// ---------------------------------------------------------------------------
const NOISE = new Set(["fc", "afc", "cf", "sc", "ac", "as", "ss", "us", "cd", "ud", "sd", "fk", "sk", "if", "bk", "club",
  "de", "the", "calcio", "sv", "vfb", "vfl", "tsg", "rc", "rcd", "ca"]);

export function nameTokens(name: string): string[] {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\butd\b/g, "united").split(/\s+/)
    .filter((t) => t.length > 1 && !NOISE.has(t));
}

/** 0..1 similarity between two team names. */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.length || !tb.length) {
    // Names made only of noise words ("Real Sociedad" keeps "sociedad", but e.g. "AC" alone does not).
    return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  }
  const ja = ta.join(""), jb = tb.join("");
  if (ja === jb) return 1;
  let hit = 0;
  for (const x of ta) if (tb.some((y) => y === x || (x.length >= 4 && y.length >= 4 && (y.startsWith(x) || x.startsWith(y))))) hit++;
  return hit / Math.max(ta.length, tb.length);
}

/** Both teams must match and kick-off times must be close. */
export function isSameMatch(
  a: { home: string; away: string; kickoff: string },
  b: { home: string; away: string; kickoff: string },
  maxMinutesApart = 30,
): boolean {
  const dt = Math.abs(Date.parse(a.kickoff) - Date.parse(b.kickoff)) / 60_000;
  if (!(dt <= maxMinutesApart)) return false;
  return nameSimilarity(a.home, b.home) >= 0.5 && nameSimilarity(a.away, b.away) >= 0.5;
}
