/** Monte-Carlo calibration of Cosmic Cascade: prints ev_raw and game statistics. */
import { randomBytes } from "node:crypto";
import { COSMIC_CASCADE, playRound } from "../src/lib/slots/cascade";

const N = Number(process.argv[2] ?? 2_000_000);
let buf = randomBytes(0), pos = 0;
const next = () => {
  if (pos + 4 > buf.length) { buf = randomBytes(1 << 16); pos = 0; }
  const v = buf.readUInt32BE(pos); pos += 4;
  return v / 4294967296;
};
let sum = 0, sumSq = 0, hits = 0, features = 0, featureSum = 0, max = 0, capped = 0;
for (let i = 0; i < N; i++) {
  const r = playRound(COSMIC_CASCADE, next);
  sum += r.raw; sumSq += r.raw * r.raw;
  if (r.raw > 0) hits++;
  if (r.free_spins > 0) { features++; featureSum += r.raw; }
  if (r.raw > max) max = r.raw;
}
const ev = sum / N, sd = Math.sqrt(sumSq / N - ev * ev);
console.log(JSON.stringify({
  spins: N, ev_raw: +ev.toFixed(5), stderr: +(sd / Math.sqrt(N)).toFixed(5), sd: +sd.toFixed(2),
  hit_rate: +(hits / N).toFixed(4), feature_every: Math.round(N / Math.max(features, 1)),
  feature_avg_raw: +(featureSum / Math.max(features, 1)).toFixed(2), feature_share: +(featureSum / sum).toFixed(3), max_raw: +max.toFixed(2),
}));
