import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, CATEGORIES } from "./config.js";
import { t } from "./i18n.js";
import { SOURCES, sourceStatus, sourceName } from "./sources.js";
import { renderMarkdown, uniqueSlug, parseSourcesText, isHttpUrl, escapeXml, truncate } from "./util.js";
import { requireAdmin, sameOrigin, checkPassword, setLoginCookie, clearLoginCookie, loginAllowed, recordFailure } from "./auth.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE_SIZE = 20;

export function createApp(repo, newsroom) {
  const app = express();
  const strings = t(config.lang);

  app.set("view engine", "ejs");
  app.set("views", path.join(here, "..", "views"));
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.static(path.join(here, "..", "public"), { maxAge: "1d" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use(sameOrigin);
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "strict-origin-when-cross-origin");
    Object.assign(res.locals, {
      config,
      s: strings,
      categories: CATEGORIES,
      sourceName,
      fmtDate: (iso) =>
        iso ? new Date(iso).toLocaleString(config.lang === "sq" ? "sq-AL" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Belgrade" }) : "",
      canonical: config.siteUrl + req.path,
      meta: {},
    });
    next();
  });

  // ---------- Public site ----------

  app.get("/", (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const articles = repo.listPublished({ limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE });
    res.render("home", { articles: articles.slice(0, PAGE_SIZE), page, hasMore: articles.length > PAGE_SIZE, category: null });
  });

  app.get("/c/:category", (req, res, next) => {
    const { category } = req.params;
    if (!CATEGORIES.includes(category)) return next();
    const page = Math.max(1, Number(req.query.page) || 1);
    const articles = repo.listPublished({ category, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE });
    res.render("home", { articles: articles.slice(0, PAGE_SIZE), page, hasMore: articles.length > PAGE_SIZE, category });
  });

  app.get("/article/:slug", (req, res, next) => {
    const article = repo.getPublishedBySlug(req.params.slug);
    if (!article) return next();
    res.render("article", { article, bodyHtml: renderMarkdown(article.body_md), meta: { description: article.summary, image: article.image_url, type: "article" } });
  });

  app.get("/about", (req, res) => res.render("about"));

  app.get("/robots.txt", (req, res) => {
    res.type("text/plain").send(`User-agent: *\nDisallow: /admin\nSitemap: ${config.siteUrl}/sitemap.xml\n`);
  });

  app.get("/sitemap.xml", (req, res) => {
    const urls = repo
      .listPublished({ limit: 5000 })
      .map((a) => `<url><loc>${config.siteUrl}/article/${a.slug}</loc><lastmod>${a.updated_at}</lastmod></url>`);
    res.type("application/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${config.siteUrl}/</loc></url>${urls.join("")}</urlset>`
    );
  });

  app.get("/feed.xml", (req, res) => {
    const items = repo.listPublished({ limit: 50 }).map(
      (a) => `<item><title>${escapeXml(a.title)}</title><link>${config.siteUrl}/article/${a.slug}</link><guid>${config.siteUrl}/article/${a.slug}</guid><pubDate>${new Date(a.published_at).toUTCString()}</pubDate><description>${escapeXml(a.summary)}</description></item>`
    );
    res.type("application/rss+xml").send(
      `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(config.siteName)}</title><link>${config.siteUrl}</link><description>${escapeXml(strings.tagline)}</description><language>${config.lang}</language>${items.join("")}</channel></rss>`
    );
  });

  // ---------- Admin ----------

  app.get("/admin/login", (req, res) => res.render("admin/login", { error: null }));

  app.post("/admin/login", (req, res) => {
    if (!loginAllowed(req.ip)) return res.status(429).render("admin/login", { error: "Too many attempts. Try again in 15 minutes." });
    if (!checkPassword(req.body.password || "")) {
      recordFailure(req.ip);
      return res.status(401).render("admin/login", { error: "Wrong password." });
    }
    setLoginCookie(res, req.secure);
    res.redirect("/admin");
  });

  app.post("/admin/logout", (req, res) => {
    clearLoginCookie(res);
    res.redirect("/admin/login");
  });

  app.use("/admin", requireAdmin);

  app.get("/admin", (req, res) => {
    const status = ["new", "failed", "drafting", "dismissed", "drafted"].includes(req.query.status) ? req.query.status : "new";
    res.render("admin/dashboard", {
      status,
      leads: repo.listLeads(status, 150),
      counts: repo.leadCounts(),
      drafts: repo.listArticles("draft", 100),
      published: repo.listArticles("published", 30),
      sources: SOURCES.map((s) => ({ ...s, status: sourceStatus[s.id] })),
      busy: newsroom.isBusy(),
      queued: newsroom.queueLength(),
      notice: req.query.notice || null,
      truncate,
    });
  });

  app.post("/admin/poll", async (req, res) => {
    const ids = await newsroom.poll();
    res.redirect(`/admin?notice=${encodeURIComponent(`${ids.length} new leads`)}`);
  });

  app.post("/admin/leads/:id/draft", (req, res) => {
    const lead = repo.getLead(Number(req.params.id));
    if (lead && lead.status !== "drafting" && lead.status !== "drafted") newsroom.enqueue(lead.id);
    res.redirect(`/admin?notice=${encodeURIComponent("Drafting started - refresh in a minute or two.")}`);
  });

  app.post("/admin/leads/:id/dismiss", (req, res) => {
    repo.setLeadStatus(Number(req.params.id), "dismissed");
    res.redirect(req.get("referer") || "/admin");
  });

  app.post("/admin/tips", (req, res) => {
    const url = (req.body.url || "").trim();
    if (!isHttpUrl(url)) return res.redirect(`/admin?notice=${encodeURIComponent("Tip needs a valid link.")}`);
    const id = repo.addLead({
      source: "tip",
      title: (req.body.title || "").trim() || url,
      url,
      note: (req.body.note || "").trim(),
    });
    if (!id) return res.redirect(`/admin?notice=${encodeURIComponent("That link is already in the list.")}`);
    if (req.body.draftNow) newsroom.enqueue(id);
    res.redirect(`/admin?notice=${encodeURIComponent(req.body.draftNow ? "Tip added, drafting started." : "Tip added.")}`);
  });

  const formToArticle = (body) => ({
    title: (body.title || "").trim(),
    summary: (body.summary || "").trim(),
    bodyMd: (body.body_md || "").trim(),
    category: CATEGORIES.includes(body.category) ? body.category : "news",
    sources: parseSourcesText(body.sources),
    imageUrl: isHttpUrl(body.image_url) ? body.image_url.trim() : "",
    editorNotes: (body.editor_notes || "").trim(),
  });

  app.get("/admin/articles/new", (req, res) => res.render("admin/edit", { article: null, lead: null, error: null }));

  app.post("/admin/articles/new", (req, res) => {
    const a = formToArticle(req.body);
    if (!a.title || !a.bodyMd) return res.render("admin/edit", { article: null, lead: null, error: "Title and body are required." });
    const id = repo.createArticle({ ...a, slug: uniqueSlug(a.title, repo.slugExists) });
    res.redirect(`/admin/articles/${id}`);
  });

  app.get("/admin/articles/:id", (req, res, next) => {
    const article = repo.getArticle(Number(req.params.id));
    if (!article) return next();
    res.render("admin/edit", { article, lead: article.lead_id ? repo.getLead(article.lead_id) : null, error: null });
  });

  app.post("/admin/articles/:id", (req, res, next) => {
    const id = Number(req.params.id);
    const article = repo.getArticle(id);
    if (!article) return next();
    const action = req.body.action;
    if (action === "delete") {
      repo.deleteArticle(id);
      return res.redirect(`/admin?notice=${encodeURIComponent("Article deleted.")}`);
    }
    const a = formToArticle(req.body);
    if (!a.title || !a.bodyMd) {
      return res.render("admin/edit", { article, lead: article.lead_id ? repo.getLead(article.lead_id) : null, error: "Title and body are required." });
    }
    repo.updateArticle(id, a);
    if (action === "publish") repo.publishArticle(id);
    if (action === "unpublish") repo.unpublishArticle(id);
    if (action === "publish") return res.redirect(`/article/${article.slug}`);
    res.redirect(`/admin/articles/${id}?saved=1`);
  });

  app.use((req, res) => res.status(404).render("404"));

  return app;
}
