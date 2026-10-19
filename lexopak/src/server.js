import { config } from "./config.js";
import { openDb, createRepo } from "./db.js";
import { createNewsroom } from "./newsroom.js";
import { createApp } from "./app.js";

if (!config.adminPassword || config.sessionSecret.length < 32) {
  console.error("Set ADMIN_PASSWORD and SESSION_SECRET (at least 32 characters) in .env - see .env.example");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("ANTHROPIC_API_KEY is not set - the listener will run but AI drafting will fail.");
}

const repo = createRepo(openDb(config.dbPath));
const newsroom = createNewsroom(repo);
const app = createApp(repo, newsroom);

app.listen(config.port, () => {
  console.log(`${config.siteName} running on http://localhost:${config.port} (admin: /admin)`);
  console.log(config.pollMinutes ? `Polling sources every ${config.pollMinutes} min, auto-draft ${config.autoDraft ? "ON" : "OFF"}` : "Built-in polling off (POLL_MINUTES=0) - run src/cron.js from cron");
  newsroom.start();
});
