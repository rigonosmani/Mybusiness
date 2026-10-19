import "./env.mjs";

// All settings come from environment variables (see .env.example).
export const config = {
  port: Number(process.env.PORT || 3000),
  siteUrl: (process.env.SITE_URL || "https://lexopak.com").replace(/\/$/, ""),
  siteName: process.env.SITE_NAME || "Lexopak",
  // "sq" (Albanian) or "en" (English): language of the site UI and of AI drafts.
  lang: process.env.SITE_LANG === "en" ? "en" : "sq",
  dbPath: process.env.DB_PATH || "./data/lexopak.db",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  sessionSecret: process.env.SESSION_SECRET || "",
  // 0 turns off the built-in timer (use the cron script instead, e.g. on cPanel).
  pollMinutes: Math.max(0, Number(process.env.POLL_MINUTES ?? 5)),
  // When true, every new lead is drafted automatically (drafts still need an editor to publish).
  autoDraft: process.env.AUTO_DRAFT === "true",
  model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
  maxWebSearches: Number(process.env.MAX_WEB_SEARCHES || 5),
  userAgent: "LexopakBot/1.0 (+https://lexopak.com/about)",
};

export const CATEGORIES = ["news", "politics", "economy", "world", "sport", "culture", "tech"];
