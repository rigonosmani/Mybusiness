import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Node 22.13+ has SQLite built in; older Node versions (common on cPanel) use better-sqlite3.
function openSqlite(file) {
  try {
    const { DatabaseSync } = require("node:sqlite");
    return new DatabaseSync(file);
  } catch {
    const Database = require("better-sqlite3");
    return new Database(file);
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  excerpt TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  -- new | drafting | drafted | dismissed | failed
  status TEXT NOT NULL DEFAULT 'new',
  drafting_at TEXT,
  error TEXT,
  article_id INTEGER
);
CREATE INDEX IF NOT EXISTS leads_status ON leads(status, fetched_at);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'news',
  sources_json TEXT NOT NULL DEFAULT '[]',
  image_url TEXT NOT NULL DEFAULT '',
  editor_notes TEXT NOT NULL DEFAULT '',
  single_source INTEGER NOT NULL DEFAULT 0,
  -- draft | published
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS articles_pub ON articles(status, published_at);
`;

export function openDb(dbPath) {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openSqlite(dbPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

const now = () => new Date().toISOString();

export function createRepo(db) {
  const rowToArticle = (r) => r && { ...r, sources: JSON.parse(r.sources_json), single_source: !!r.single_source };

  return {
    // Returns true when the lead is new (URL not seen before).
    addLead({ source, title, url, excerpt = "", note = "", publishedAt = null }) {
      const res = db
        .prepare(
          `INSERT OR IGNORE INTO leads (source, title, url, excerpt, note, published_at, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(source, title, url, excerpt, note, publishedAt, now());
      return res.changes > 0 ? Number(res.lastInsertRowid) : null;
    },
    getLead: (id) => db.prepare("SELECT * FROM leads WHERE id = ?").get(id),
    listLeads(status, limit = 100) {
      if (status) {
        return db.prepare("SELECT * FROM leads WHERE status = ? ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT ?").all(status, limit);
      }
      return db.prepare("SELECT * FROM leads ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT ?").all(limit);
    },
    leadCounts() {
      const rows = db.prepare("SELECT status, COUNT(*) AS n FROM leads GROUP BY status").all();
      return Object.fromEntries(rows.map((r) => [r.status, r.n]));
    },
    setLeadStatus(id, status, error = null) {
      db.prepare("UPDATE leads SET status = ?, error = ?, drafting_at = ? WHERE id = ?").run(status, error, status === "drafting" ? now() : null, id);
    },
    // Drafts take a few minutes; anything "drafting" for over 30 minutes was cut off by a restart.
    failStuckLeads() {
      const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
      db.prepare("UPDATE leads SET status = 'failed', error = 'Interrupted - try again.' WHERE status = 'drafting' AND (drafting_at IS NULL OR drafting_at < ?)").run(cutoff);
    },

    createArticle(a) {
      const res = db
        .prepare(
          `INSERT INTO articles (lead_id, slug, title, summary, body_md, category, sources_json,
             image_url, editor_notes, single_source, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
        )
        .run(
          a.leadId ?? null,
          a.slug,
          a.title,
          a.summary,
          a.bodyMd,
          a.category,
          JSON.stringify(a.sources || []),
          a.imageUrl || "",
          a.editorNotes || "",
          a.singleSource ? 1 : 0,
          now(),
          now()
        );
      const id = Number(res.lastInsertRowid);
      if (a.leadId) db.prepare("UPDATE leads SET status = 'drafted', error = NULL, article_id = ? WHERE id = ?").run(id, a.leadId);
      return id;
    },
    updateArticle(id, a) {
      db.prepare(
        `UPDATE articles SET title = ?, summary = ?, body_md = ?, category = ?, sources_json = ?,
           image_url = ?, editor_notes = ?, updated_at = ? WHERE id = ?`
      ).run(a.title, a.summary, a.bodyMd, a.category, JSON.stringify(a.sources || []), a.imageUrl || "", a.editorNotes || "", now(), id);
    },
    publishArticle(id) {
      db.prepare("UPDATE articles SET status = 'published', published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?").run(now(), now(), id);
    },
    unpublishArticle(id) {
      db.prepare("UPDATE articles SET status = 'draft', updated_at = ? WHERE id = ?").run(now(), id);
    },
    deleteArticle(id) {
      db.prepare("UPDATE leads SET status = 'dismissed', article_id = NULL WHERE article_id = ?").run(id);
      db.prepare("DELETE FROM articles WHERE id = ?").run(id);
    },
    getArticle: (id) => rowToArticle(db.prepare("SELECT * FROM articles WHERE id = ?").get(id)),
    getPublishedBySlug: (slug) =>
      rowToArticle(db.prepare("SELECT * FROM articles WHERE slug = ? AND status = 'published'").get(slug)),
    slugExists: (slug) => !!db.prepare("SELECT 1 FROM articles WHERE slug = ?").get(slug),
    listArticles(status, limit = 100) {
      return db.prepare("SELECT * FROM articles WHERE status = ? ORDER BY COALESCE(published_at, updated_at) DESC LIMIT ?").all(status, limit).map(rowToArticle);
    },
    listPublished({ category = null, limit = 30, offset = 0 } = {}) {
      const rows = category
        ? db.prepare("SELECT * FROM articles WHERE status = 'published' AND category = ? ORDER BY published_at DESC LIMIT ? OFFSET ?").all(category, limit, offset)
        : db.prepare("SELECT * FROM articles WHERE status = 'published' ORDER BY published_at DESC LIMIT ? OFFSET ?").all(limit, offset);
      return rows.map(rowToArticle);
    },
  };
}
