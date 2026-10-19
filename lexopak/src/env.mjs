// Loads .env when present (cPanel and plain `node` runs have no --env-file flag).
import fs from "node:fs";

if (fs.existsSync(".env")) process.loadEnvFile(".env");
