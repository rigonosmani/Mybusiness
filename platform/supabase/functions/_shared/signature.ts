/**
 * Provider callback authentication: HMAC-SHA256 over "<timestamp>.<raw body>"
 * with a shared secret, plus a timestamp window to block replays. Per-request
 * replay of an identical body inside the window is additionally neutralised by
 * the provider transaction id idempotency in svc_provider_wallet.
 */
const enc = new TextEncoder();

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifySignedRequest(opts: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowMs?: number;
  toleranceSeconds?: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!opts.secret) return { ok: false, reason: "not_configured" };
  if (!opts.timestamp || !opts.signature) return { ok: false, reason: "missing_headers" };
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad_timestamp" };
  const now = (opts.nowMs ?? Date.now()) / 1000;
  if (Math.abs(now - ts) > (opts.toleranceSeconds ?? 300)) return { ok: false, reason: "stale" };
  const expected = await hmacHex(opts.secret, `${opts.timestamp}.${opts.body}`);
  return timingSafeEqual(expected, opts.signature.toLowerCase()) ? { ok: true } : { ok: false, reason: "bad_signature" };
}
