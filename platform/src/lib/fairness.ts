/**
 * Provably-fair verification — a byte-for-byte re-implementation of the
 * database functions app.pf_float, app.pf_shuffle and each game's outcome
 * mapping. Runs in the browser (WebCrypto) so players can verify any round
 * once its server seed has been revealed by rotating the seed pair.
 *
 * This module is for VERIFICATION ONLY. Authoritative results are always
 * produced by the server.
 */

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

async function hmacSha256(key: string, message: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
}

export interface SeedPair {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

/** Floats 0..count-1 of a round: 8 floats per HMAC block, 4 bytes each. */
export async function floats(seed: SeedPair, count: number): Promise<number[]> {
  const out: number[] = [];
  for (let round = 0; out.length < count; round++) {
    const h = await hmacSha256(seed.serverSeed, `${seed.clientSeed}:${seed.nonce}:${round}`);
    for (let off = 0; off < 32 && out.length < count; off += 4) {
      out.push(h[off] / 256 + h[off + 1] / 256 ** 2 + h[off + 2] / 256 ** 3 + h[off + 3] / 256 ** 4);
    }
  }
  return out;
}

/** Fisher–Yates: first `count` values of a shuffled 0..n-1 using floats[offset..]. */
export function shuffle(fs: number[], n: number, count: number, offset = 0): number[] {
  const pool = Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(fs[offset + i] * (n - i));
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

// Decimal helpers mirroring the SQL numeric arithmetic (2 decimals, floor).
const floor2 = (x: number) => Math.floor(x * 100 + 1e-9) / 100;

export const outcomes = {
  dice: (fs: number[]) => Math.floor(fs[0] * 10000) / 100,
  /** Limbo / Crash point. `edgeBps` from the round record. */
  limbo: (fs: number[], edgeBps: number, cap = 1_000_000) =>
    Math.min(cap, Math.max(1, floor2((1 - edgeBps / 10000) / (1 - fs[0])))),
  crash: (fs: number[], edgeBps: number) => outcomes.limbo(fs, edgeBps, 1000),
  coinflip: (fs: number[]) => (fs[0] < 0.5 ? "heads" : "tails"),
  roulette: (fs: number[]) => Math.floor(fs[0] * 37),
  plinko: (fs: number[], rows: number) => {
    const path = fs.slice(0, rows).map((f) => (f >= 0.5 ? 1 : 0));
    return { path, bucket: path.reduce((a: number, b) => a + b, 0) };
  },
  keno: (fs: number[]) => shuffle(fs, 40, 10).map((x) => x + 1),
  mines: (fs: number[], mines: number) => shuffle(fs, 25, mines),
  card: (fs: number[], i: number) => Math.floor(fs[i] * 52),
  videopoker: (fs: number[]) => shuffle(fs, 52, 10),
  slotGrid: (fs: number[], symbols: { id: string; weight: number }[]) => {
    const total = symbols.reduce((a, s) => a + s.weight, 0);
    return fs.slice(0, 9).map((f) => {
      const x = f * total;
      let acc = 0;
      for (const s of symbols) {
        acc += s.weight;
        if (x < acc) return s.id;
      }
      return symbols[symbols.length - 1].id;
    });
  },
};

/** How many floats each game consumes (upper bound for stateful games). */
export const floatsNeeded: Record<string, number> = {
  dice: 1, limbo: 1, crash: 1, coinflip: 1, roulette: 1, plinko: 16, keno: 10, mines: 24,
  hilo: 64, blackjack: 32, baccarat: 6, videopoker: 10, slot: 9,
};

export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export const SUITS = ["♠", "♥", "♦", "♣"] as const;
export function cardLabel(card: number): { rank: string; suit: string; red: boolean } {
  const suit = Math.floor(card / 13);
  return { rank: RANKS[card % 13], suit: SUITS[suit], red: suit === 1 || suit === 2 };
}
