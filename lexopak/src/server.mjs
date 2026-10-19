import { config } from "./config.mjs";
import { openDb, createRepo } from "./db.mjs";
import { createNewsroom } from "./newsroom.mjs";
import { createApp } from "./app.mjs";
import { adminConfigured } from "./auth.mjs";

// The public site still runs without these; only the newsroom login is disabled.
if (!adminConfigured()) {
  console.error("Set ADMIN_PASSWORD and SESSION_SECRET (at least 32 characters) to enable /admin - see .env.example");
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("ANTHROPIC_API_KEY is not set - the listener will run but AI drafting will fail.");
}

const repo = createRepo(openDb(config.dbPath));
const newsroom = createNewsroom(repo);
const app = createApp(repo, newsroom);

app.listen(config.port, () => {
  console.log(`${config.siteName} running on http://localhost:${config.port} (admin: /admin)`);
  console.log(config.pollMinutes ? `Polling sources every ${config.pollMinutes} min, auto-draft ${config.autoDraft ? "ON" : "OFF"}` : "Built-in polling off (POLL_MINUTES=0) - run src/cron.mjs from cron");
  newsroom.start();
});
