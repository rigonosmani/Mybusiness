import Parser from "rss-parser";
import { config } from "./config.mjs";
import { stripHtml, truncate } from "./util.mjs";

// Sites we watch for breaking stories. Only headline, link and the feed's short
// teaser are stored - as a tip for the editor, never shown on the public site.
export const SOURCES = [
  {
    id: "voxkosova",
    name: "VoxKosova",
    homepage: "https://voxkosova.com",
    feeds: ["https://voxkosova.com/feed/"],
  },
  {
    id: "nacionale",
    name: "Nacionale",
    homepage: "https://www.nacionale.com/en/int",
    // The site is behind a Cloudflare bot check; these work only if they allow feed readers.
    feeds: ["https://www.nacionale.com/en/int/feed", "https://www.nacionale.com/en/feed", "https://www.nacionale.com/feed"],
  },
];

const parser = new Parser();

// Last poll result per source, shown on the admin dashboard.
export const sourceStatus = Object.fromEntries(SOURCES.map((s) => [s.id, { ok: null, message: "not polled yet", at: null }]));

async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": config.userAgent, Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.5" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const blocked = res.headers.get("cf-mitigated") ? " (Cloudflare bot check)" : "";
    throw new Error(`HTTP ${res.status}${blocked}`);
  }
  return parser.parseString(await res.text());
}

export async function pollSource(source, repo) {
  const errors = [];
  for (const url of source.feeds) {
    try {
      const feed = await fetchFeed(url);
      const newIds = [];
      for (const item of feed.items || []) {
        if (!item.link || !item.title) continue;
        const id = repo.addLead({
          source: source.id,
          title: item.title.trim(),
          url: item.link.trim(),
          excerpt: truncate(stripHtml(item.contentSnippet || item.summary || item.content || ""), 400),
          publishedAt: item.isoDate || null,
        });
        if (id) newIds.push(id);
      }
      sourceStatus[source.id] = { ok: true, message: `${feed.items?.length || 0} items, ${newIds.length} new`, at: new Date().toISOString() };
      return newIds;
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
    }
  }
  sourceStatus[source.id] = { ok: false, message: errors.join("; "), at: new Date().toISOString() };
  return [];
}

export async function pollAll(repo) {
  const results = await Promise.all(SOURCES.map((s) => pollSource(s, repo)));
  return results.flat();
}

export const sourceName = (id) => SOURCES.find((s) => s.id === id)?.name || (id === "tip" ? "Tip" : id);
