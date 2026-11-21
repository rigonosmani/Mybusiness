/**
 * End-to-end smoke test through the real UI (Albanian locale).
 * Prerequisites: scripts/local-stack.sh up, `npm run build && npm start`, and Playwright
 * (`npm i -D playwright && npx playwright install chromium`).
 *
 * Covers: Test B (credit chain via dashboards), Test C (overdraw blocked), Edge
 * Function account creation, Test D (sports bet + settlement), a casino round,
 * provably-fair verification, role isolation and mobile layout.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
const API = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const assert = (cond, msg) => { if (!cond) throw new Error("ASSERTION FAILED: " + msg); console.log("✓", msg); };
const credits = (s) => Number(s.replace(/[^\d.]/g, ""));
const svc = (fn, body) => fetch(`${API}/rest/v1/rpc/${fn}`, {
  method: "POST", headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const login = async (u, p) => {
  await ctx.clearCookies();
  await page.goto(`${BASE}/login`);
  await page.fill("#u", u); await page.fill("#p", p);
  await page.click("button[type=submit]");
  await page.waitForLoadState("networkidle");
};
const pill = async (href) => { const l = page.locator(`header a[href='${href}']`); await l.filter({ hasText: "Cr" }).waitFor(); return l.innerText(); };

try {
  // --- Main Administrator ---------------------------------------------------
  await login("owner", "Owner-Passw0rd");
  await page.waitForURL("**/super");
  const ownerStart = credits(await pill("/super"));
  await page.goto(`${BASE}/super/admins`);
  const rowA = page.locator("tr", { hasText: "@admin_a" });
  await rowA.getByRole("button", { name: /Ndaj kredite/ }).click();
  await page.fill("input[inputmode=decimal]", "100");
  await page.getByRole("dialog").getByRole("button", { name: /Ndaj kredite/ }).click();
  await page.waitForSelector("text=Transferimi u krye.");
  await page.waitForTimeout(500);
  assert(credits(await pill("/super")) === ownerStart - 100, "Main Admin balance decreased by 100 Cr");
  const unique = `admin_${Date.now().toString(36)}`;
  await page.getByRole("button", { name: /Krijo administrator/ }).first().click();
  const d = page.getByRole("dialog");
  await d.locator("input").nth(0).fill(unique); await d.locator("input").nth(1).fill("E2E Admin"); await d.locator("input").nth(2).fill("E2e-Admin-pass1");
  await d.getByRole("button", { name: "Ruaj" }).click();
  await page.waitForSelector(`text=@${unique}`);
  assert(true, "administrator created through the admin-users Edge Function");
  assert(!(await page.content()).includes("@player_a1"), "Main Admin account management lists no players");

  // --- Secondary administrator ---------------------------------------------
  await login("admin_a", "Demo-Passw0rd");
  await page.waitForURL("**/admin");
  const adminStart = credits(await pill("/admin"));
  await page.goto(`${BASE}/admin/players`);
  const rowP = page.locator("tr", { hasText: "@player_a1" });
  const playerStart = credits(await rowP.locator("td").nth(2).innerText());
  await rowP.getByRole("button", { name: /Transfero/ }).click();
  await page.fill("input[inputmode=decimal]", "10");
  await page.getByRole("dialog").getByRole("button", { name: /Transfero/ }).click();
  await page.waitForSelector("text=Transferimi u krye.");
  await page.waitForTimeout(500);
  assert(credits(await pill("/admin")) === adminStart - 10, "admin balance decreased by 10 Cr");
  assert(credits(await rowP.locator("td").nth(2).innerText()) === playerStart + 10, "player balance increased by 10 Cr");
  await rowP.getByRole("button", { name: /Transfero/ }).click();
  await page.fill("input[inputmode=decimal]", String(adminStart + 50));
  assert(await page.getByRole("dialog").getByRole("button", { name: /Transfero/ }).isDisabled(), "transfer above balance cannot be submitted");
  await page.keyboard.press("Escape");
  assert(!(await page.content()).includes("@player_b1"), "admin A cannot see admin B's player");

  // --- Player: sports bet (Test D) -----------------------------------------
  const commence = new Date(Date.now() + 86_400_000).toISOString();
  const eventId = `e2e-${Date.now()}`;
  await svc("svc_upsert_odds", { p_provider: "the_odds_api", p_events: [{
    sport_key: "football", sport_title: "Soccer", league_key: "soccer_e2e", league_title: "E2E League", event_id: eventId,
    home_team: "Home E2E", away_team: "Away E2E", commence_time: commence, odds_updated_at: new Date().toISOString(),
    markets: [{ market_key: "h2h", bookmaker_count: 3, outcomes: [
      { key: "home", label: "Home E2E", price: 2.0527 }, { key: "draw", label: "Draw", price: 3.3 }, { key: "away", label: "Away E2E", price: 3.6 }] }],
  }] });
  await login("player_a1", "Demo-Passw0rd");
  await page.goto(`${BASE}/sports`);
  await page.waitForSelector("text=Home E2E");
  const before = credits(await pill("/wallet"));
  await page.locator("div", { hasText: "Home E2E" }).locator("button", { hasText: "2.00" }).first().click();
  const slip = page.locator("aside").last();
  await slip.locator("input").fill("2");
  await slip.getByRole("button", { name: "Vendos bastin" }).click();
  await page.waitForSelector("text=Basti u vendos.");
  await page.waitForTimeout(500);
  assert(credits(await pill("/wallet")) === before - 2, "2 Cr stake debited");
  const settled = await svc("svc_update_scores", { p_provider: "the_odds_api", p_scores: [{ event_id: eventId, completed: true, home_score: 2, away_score: 0 }] });
  await svc("svc_update_scores", { p_provider: "the_odds_api", p_scores: [{ event_id: eventId, completed: true, home_score: 2, away_score: 0 }] });
  await page.reload(); await page.waitForTimeout(800);
  assert(settled.bets_settled === 1 && credits(await pill("/wallet")) === before + 2, "winning bet at 2.00 paid 4 Cr exactly once");

  // --- Player: casino + fairness --------------------------------------------
  await page.goto(`${BASE}/casino/play/dice`);
  const b2 = credits(await pill("/wallet"));
  await page.locator("main input[inputmode=decimal]").first().fill("1");
  await page.getByRole("button", { name: "Hidh" }).click();
  await page.waitForTimeout(1200);
  const after = credits(await pill("/wallet"));
  assert(after === b2 - 1 || Math.abs(after - (b2 + 0.98)) < 1e-9, "dice round settled at stake × multiplier");
  await page.goto(`${BASE}/history`);
  await page.locator("a", { hasText: "Verifiko" }).first().click();
  await page.waitForURL("**/fairness**");
  await page.getByRole("button", { name: "Ndërro çiftin e farave" }).click();
  await page.waitForTimeout(1000);
  await page.reload(); await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Llogarit" }).click();
  await page.waitForSelector("text=Hash-i përputhet");
  assert(true, "revealed server seed matches its pre-committed SHA-256 hash");
  await page.goto(`${BASE}/super`); await page.waitForLoadState("networkidle");
  assert(!page.url().includes("/super"), "player is redirected away from the Main Admin area");

  // --- Mobile ---------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  for (const p of ["/", "/casino", "/sports"]) {
    await page.goto(BASE + p); await page.waitForTimeout(500);
    assert(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), `no horizontal scroll on ${p} at 390px`);
  }
  assert(errors.length === 0, `no uncaught page errors (${errors.join("; ")})`);
} finally {
  await browser.close();
}
