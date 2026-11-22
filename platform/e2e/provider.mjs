/**
 * E2E for the licensed-provider flow, using e2e/mock-aggregator.mjs:
 * Main Admin enters keys in the panel → configures + activates provider → imports a game
 * → player opens it → mock provider debits/credits Kometa credits through signed callbacks.
 * Prereqs: local stack (DENO_EXTRA_FLAGS=--unsafely-ignore-certificate-errors=localhost),
 * `node e2e/mock-aggregator.mjs`, app running, Playwright installed.
 */
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const assert = (c, m) => { if (!c) throw new Error("ASSERTION FAILED: " + m); console.log("✓", m); };
const credits = (s) => Number(s.replace(/[^\d.]/g, ""));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const login = async (u, p) => {
  await ctx.clearCookies();
  await page.goto(`${BASE}/login`);
  await page.fill("#u", u); await page.fill("#p", p);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.waitForLoadState("networkidle");
};

try {
  await login("owner", "Owner-Passw0rd");
  await page.goto(`${BASE}/super/games`);
  const card = page.locator("div.rounded-lg", { hasText: "Licensed slot aggregator" }).first();
  await card.waitFor();
  const keyForms = card.locator("form");
  await keyForms.nth(0).locator("input").fill("mock-api-key-123456");
  await keyForms.nth(0).getByRole("button").first().click();
  await page.waitForSelector("text=Çelësi u ruajt");
  await keyForms.nth(1).locator("input").fill("mock-callback-secret-654321");
  await keyForms.nth(1).getByRole("button").first().click();
  await page.waitForTimeout(1200);
  assert((await card.innerText()).includes("••••3456") && (await card.innerText()).includes("••••4321"), "keys stored; panel shows only the last 4 characters");
  await card.locator("select").selectOption("active");
  await card.locator("input[placeholder='https://api.provider.com']").fill("https://localhost:9443");
  await card.locator("textarea").first().fill('{"operator_id": "kometa-local"}');
  await card.getByRole("button", { name: "Ruaj", exact: true }).click();
  await page.waitForSelector("text=U ruajt.");
  await card.locator("textarea").nth(1).fill('[{"external_game_id": "mock_slot", "name": "Mock Provider Slot", "category": "slots", "rtp": 96.5}]');
  await card.getByRole("button", { name: "Importo" }).click();
  await page.waitForSelector("text=Lojërat u importuan");
  assert(true, "provider activated and catalogue imported from the panel");

  await login("player_a1", "Demo-Passw0rd");
  const pill = async () => credits(await page.locator("header a[href='/wallet']").filter({ hasText: "Cr" }).innerText());
  await page.goto(`${BASE}/casino/category/slots`);
  await page.waitForSelector("text=Mock Provider Slot");
  const before = await pill();
  await page.goto(`${BASE}/casino/play/licensed_aggregator_mock_slot`);
  const frame = page.frameLocator("#provider-frame");
  await frame.locator("#win").click();
  await frame.locator("text=balance").waitFor();
  await frame.locator("#lose").click();
  await page.waitForTimeout(5000);
  const after = await pill();
  assert(Math.abs(after - (before - 1 + 2.5 - 1)) < 1e-9, `provider game moved Kometa credits: ${before} → ${after}`);
  await page.screenshot({ path: ".local-stack/provider-game.png" });
} finally {
  await browser.close();
}
