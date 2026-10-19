process.env.ADMIN_PASSWORD = "test-password";
process.env.SESSION_SECRET = "x".repeat(40);
process.env.SITE_LANG = "sq";

import { test } from "node:test";
import assert from "node:assert/strict";

const { openDb, createRepo } = await import("../src/db.js");
const { createNewsroom } = await import("../src/newsroom.js");
const { createApp } = await import("../src/app.js");
const { draftFromLead } = await import("../src/ai.js");
const { slugify, renderMarkdown, parseSourcesText } = await import("../src/util.js");

const quiet = { info() {}, error() {} };
const fakeDraft = async (lead) => ({
  title: "Kuvendi miraton buxhetin për vitin 2027",
  summary: "Përmbledhje e shkurtër.",
  bodyMd: "Paragrafi i parë.\n\n<script>alert(1)</script>\n\n## Sfondi\n\nTeksti.",
  category: "politics",
  sources: [{ name: "Qeveria", url: "https://kryeministri.rks-gov.net" }],
  singleSource: false,
  editorNotes: "Verifiko shifrën.",
});

function setup(draft = fakeDraft) {
  const repo = createRepo(openDb(":memory:"));
  const newsroom = createNewsroom(repo, { draft, log: quiet });
  const server = createApp(repo, newsroom).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return { repo, newsroom, server, base };
}

async function login(base) {
  const res = await fetch(`${base}/admin/login`, { method: "POST", body: new URLSearchParams({ password: "test-password" }), redirect: "manual" });
  assert.equal(res.status, 302);
  return res.headers.get("set-cookie").split(";")[0];
}

const until = async (fn) => { for (let i = 0; i < 50 && !fn(); i++) await new Promise((r) => setTimeout(r, 10)); };

test("slugify handles Albanian letters", () => {
  assert.equal(slugify("Çështja e Ujëzimit në Prishtinë!"), "ceshtja-e-ujezimit-ne-prishtine");
});

test("markdown is sanitized", () => {
  const html = renderMarkdown("Hi <script>x</script> [l](javascript:alert(1)) [ok](https://a.com)");
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(html.includes('href="https://a.com"'));
});

test("parseSourcesText skips invalid lines", () => {
  assert.deepEqual(parseSourcesText("A | https://a.com\nbad line\nB | ftp://x"), [{ name: "A", url: "https://a.com" }]);
});

test("admin requires login", async () => {
  const { server, base } = setup();
  const res = await fetch(`${base}/admin`, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/admin/login");
  const bad = await fetch(`${base}/admin/login`, { method: "POST", body: new URLSearchParams({ password: "nope" }) });
  assert.equal(bad.status, 401);
  server.close();
});

test("lead -> AI draft -> publish -> public page", async () => {
  const { repo, server, base } = setup();
  const cookie = await login(base);
  const leadId = repo.addLead({ source: "voxkosova", title: "Origjinali", url: "https://voxkosova.com/x/" });
  assert.equal(repo.addLead({ source: "voxkosova", title: "dup", url: "https://voxkosova.com/x/" }), null);

  await fetch(`${base}/admin/leads/${leadId}/draft`, { method: "POST", headers: { cookie }, redirect: "manual" });
  await until(() => repo.getLead(leadId).status === "drafted");
  const lead = repo.getLead(leadId);
  assert.equal(lead.status, "drafted");
  const draft = repo.getArticle(lead.article_id);
  assert.equal(draft.status, "draft");
  // Original outlet is always credited.
  assert.equal(draft.sources[0].url, "https://voxkosova.com/x/");

  // Drafts are not public.
  assert.equal((await fetch(`${base}/article/${draft.slug}`)).status, 404);

  const form = new URLSearchParams({
    title: draft.title, summary: draft.summary, body_md: draft.body_md, category: draft.category,
    sources: draft.sources.map((s) => `${s.name} | ${s.url}`).join("\n"), image_url: "", editor_notes: "", action: "publish",
  });
  const pub = await fetch(`${base}/admin/articles/${draft.id}`, { method: "POST", headers: { cookie }, body: form, redirect: "manual" });
  assert.equal(pub.status, 302);

  const page = await (await fetch(`${base}/article/${draft.slug}`)).text();
  assert.ok(page.includes("Kuvendi miraton buxhetin"));
  assert.ok(page.includes("VoxKosova"));
  assert.ok(!page.includes("<script>alert"));
  assert.ok((await (await fetch(`${base}/`)).text()).includes(draft.title));
  assert.ok((await (await fetch(`${base}/c/politics`)).text()).includes(draft.title));
  assert.ok((await (await fetch(`${base}/sitemap.xml`)).text()).includes(draft.slug));
  assert.ok((await (await fetch(`${base}/feed.xml`)).text()).includes("<item>"));
  server.close();
});

test("failed draft is recorded on the lead", async () => {
  const { repo, newsroom, server } = setup(async () => { throw new Error("boom"); });
  const id = repo.addLead({ source: "tip", title: "t", url: "https://example.com/a" });
  await newsroom.enqueue(id);
  assert.equal(repo.getLead(id).status, "failed");
  assert.equal(repo.getLead(id).error, "boom");
  server.close();
});

test("cross-origin admin posts are rejected", async () => {
  const { server, base } = setup();
  const cookie = await login(base);
  const res = await fetch(`${base}/admin/poll`, { method: "POST", headers: { cookie, origin: "https://evil.example" } });
  assert.equal(res.status, 403);
  server.close();
});

test("draftFromLead runs the tool loop with web search and fallbacks", async () => {
  const calls = [];
  const replies = [
    { stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "q" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Done researching." }] },
    {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t1", name: "submit_article", input: {
        title: " Titull ", summary: "S", body_markdown: "Body", category: "bogus",
        sources: [{ name: "A", url: "https://a.com" }], single_source: true, editor_notes: "n",
      } }],
    },
  ];
  const client = { beta: { messages: { create: async (p) => { calls.push(structuredClone(p)); return replies.shift(); } } } };
  const d = await draftFromLead({ source: "voxkosova", title: "H", url: "https://v.com/1", excerpt: "e", note: "" }, client);

  assert.equal(d.title, "Titull");
  assert.equal(d.category, "news");
  assert.equal(d.singleSource, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].fallbacks, "default");
  assert.ok(calls[0].tools.some((t) => t.type === "web_search_20260209"));
  // pause_turn: resume without a nudge; end_turn without the tool: nudge.
  assert.equal(calls[1].messages.at(-1).role, "assistant");
  assert.equal(calls[2].messages.at(-1).role, "user");
});

test("draftFromLead surfaces refusals", async () => {
  const client = { beta: { messages: { create: async () => ({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] }) } } };
  await assert.rejects(draftFromLead({ source: "tip", title: "x", url: "https://x.com" }, client), /declined/);
});
