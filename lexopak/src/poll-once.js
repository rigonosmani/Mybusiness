// Polls every source once and prints what it found. Handy for checking the feeds.
import { config } from "./config.js";
import { openDb, createRepo } from "./db.js";
import { pollAll, sourceStatus } from "./sources.js";

const repo = createRepo(openDb(config.dbPath));
const ids = await pollAll(repo);
for (const [id, st] of Object.entries(sourceStatus)) console.log(`${st.ok ? "OK  " : "FAIL"} ${id}: ${st.message}`);
console.log(`${ids.length} new leads stored in ${config.dbPath}`);
