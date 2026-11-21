/**
 * Demo-credit amounts. The database stores integer "units": 1 Cr = 100 units.
 * All parsing/formatting here is string/BigInt based — never floating point.
 */
export const UNITS_PER_CREDIT = 100n;

export type Units = bigint | number | string | null | undefined;

export function toBigInt(v: Units): bigint {
  if (v === null || v === undefined || v === "") return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error("Unsafe integer amount");
    return BigInt(v);
  }
  if (!/^-?\d+$/.test(v)) throw new Error(`Invalid unit amount: ${v}`);
  return BigInt(v);
}

/** 12345 → "123.45" (with grouping). */
export function formatCredits(v: Units, opts: { grouping?: boolean; suffix?: boolean } = {}): string {
  const u = toBigInt(v);
  const neg = u < 0n;
  const abs = neg ? -u : u;
  const whole = (abs / UNITS_PER_CREDIT).toString();
  const frac = (abs % UNITS_PER_CREDIT).toString().padStart(2, "0");
  const grouped = opts.grouping === false ? whole : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${grouped}.${frac}${opts.suffix === false ? "" : " Cr"}`;
}

/** "12.5" / "12,50" / "1 000" → units as bigint. Returns null when invalid. */
export function parseCredits(input: string): bigint | null {
  const s = input.trim().replace(/\s/g, "").replace(/,(?=\d{1,2}$)/, ".").replace(/,/g, "");
  const m = /^(\d{1,12})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  return BigInt(m[1]) * UNITS_PER_CREDIT + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
}

/** Units → plain editable string "12.50". */
export function unitsToInput(v: Units): string {
  return formatCredits(v, { grouping: false, suffix: false });
}

/**
 * Potential return for decimal odds held as strings: floor(stake × Π odds).
 * Computed with scaled integers so it matches the database exactly.
 */
export function potentialReturn(stakeUnits: bigint, odds: string[]): bigint {
  let num = stakeUnits;
  let den = 1n;
  for (const o of odds) {
    const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(o);
    if (!m) return 0n;
    const frac = (m[2] ?? "").padEnd(4, "0");
    num *= BigInt(m[1]) * 10000n + BigInt(frac);
    den *= 10000n;
  }
  return num / den;
}

/** Product of decimal odds strings, rounded to 4 decimals (display only). */
export function totalOdds(odds: string[]): string {
  const r = potentialReturn(10000n, odds); // 1.0000 scaled
  return `${r / 10000n}.${(r % 10000n).toString().padStart(4, "0")}`.replace(/(\.\d\d)\d\d$/, "$1");
}
