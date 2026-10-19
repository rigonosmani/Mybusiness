// Checks the sources once (and drafts new leads if AUTO_DRAFT=true), then exits.
// Run it from cron, e.g. cPanel "Cron Jobs", so polling keeps going while the web app sleeps.
import { config } from "./config.mjs";
import { openDb, createRepo } from "./db.mjs";
import { createNewsroom } from "./newsroom.mjs";
import { sourceStatus } from "./sources.mjs";

const repo = createRepo(openDb(config.dbPath));
const newsroom = createNewsroom(repo);
repo.failStuckLeads();
const ids = await newsroom.poll();
for (const [id, st] of Object.entries(sourceStatus)) console.log(`${st.ok ? "OK  " : "FAIL"} ${id}: ${st.message}`);
console.log(`${ids.length} new leads`);
await newsroom.drain();
