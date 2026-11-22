/**
 * Mock casino aggregator for local testing of the licensed-provider flow.
 * NOT a real game: it implements the generic protocol in
 * supabase/functions/_shared/casino/generic-aggregator.ts so you can see launch,
 * debit/credit callbacks and balance changes end to end.
 *
 *   node e2e/mock-aggregator.mjs   (HTTPS on :9443 with a self-signed certificate)
 * Env: MOCK_API_KEY, MOCK_CALLBACK_SECRET, CALLBACK_URL
 */
import https from "node:https";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

const API_KEY = process.env.MOCK_API_KEY ?? "mock-api-key-123456";
const CALLBACK_SECRET = process.env.MOCK_CALLBACK_SECRET ?? "mock-callback-secret-654321";
const CALLBACK_URL = process.env.CALLBACK_URL ?? "http://localhost:54321/functions/v1/casino-provider-callback";
const dir = ".local-stack/mock-cert";
if (!existsSync(`${dir}/key.pem`)) {
  mkdirSync(dir, { recursive: true });
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/key.pem -out ${dir}/cert.pem -days 30 -subj /CN=localhost 2>/dev/null`);
}
const hmac = (secret, msg) => crypto.createHmac("sha256", secret).update(msg).digest("hex");
const sessions = new Map(); // token -> {game}
let txSeq = 0;

async function callback(token, action, round, amount) {
  const body = JSON.stringify({ token, action, transaction_id: `mock-${Date.now()}-${++txSeq}`, round_id: round, amount });
  const ts = String(Math.floor(Date.now() / 1000));
  const r = await fetch(CALLBACK_URL, { method: "POST", headers: { "content-type": "application/json", "x-provider-id": "licensed_aggregator", "x-timestamp": ts, "x-signature": hmac(CALLBACK_SECRET, `${ts}.${body}`) }, body });
  return r.json();
}

const readBody = (req) => new Promise((res) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => res(d)); });

https.createServer({ key: readFileSync(`${dir}/key.pem`), cert: readFileSync(`${dir}/cert.pem`) }, async (req, res) => {
  const url = new URL(req.url, "https://localhost:9443");
  if (req.method === "POST" && url.pathname === "/games/launch") {
    const raw = await readBody(req);
    const ok = req.headers["x-signature"] === hmac(API_KEY, `${req.headers["x-timestamp"]}.${raw}`);
    if (!ok) { res.writeHead(401); return res.end("bad signature"); }
    const b = JSON.parse(raw);
    sessions.set(b.session_token, { game: b.game_id });
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ url: `https://localhost:9443/play?token=${b.session_token}` }));
  }
  if (req.method === "POST" && url.pathname === "/spin") {
    const token = url.searchParams.get("token");
    if (!sessions.has(token)) { res.writeHead(404); return res.end(); }
    const round = `r-${Date.now()}`;
    const debit = await callback(token, "debit", round, 100);
    const win = url.searchParams.get("win") === "1" ? 250 : 0;
    const credit = debit.status === "ok" ? await callback(token, "credit", round, win) : debit;
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ debit, credit }));
  }
  if (url.pathname === "/play") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(`<!doctype html><body style="background:#111;color:#eee;font-family:sans-serif;text-align:center">
      <h2>MOCK PROVIDER GAME</h2><p id="b">-</p>
      <button id="lose" onclick="spin(0)">Spin 1 Cr (lose)</button> <button id="win" onclick="spin(1)">Spin 1 Cr (win 2.50)</button>
      <script>async function spin(w){const r=await fetch('/spin?token=${url.searchParams.get("token")}&win='+w,{method:'POST'});const j=await r.json();document.getElementById('b').textContent='balance '+(j.credit.balance??j.debit.error);}</script></body>`);
  }
  res.writeHead(404); res.end();
}).listen(9443, () => console.log("mock aggregator https://localhost:9443"));
