#!/usr/bin/env bash
# Build and (re)start Kometa on the server. Run as the app user after every update:
#   bash ~/app/platform/deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.production ] || { echo "Missing .env.production (see deploy/env.production.example)"; exit 1; }
git pull --ff-only
npm ci
NEXT_OUTPUT=standalone npm run build           # NEXT_PUBLIC_* values are read from .env.production
cp -r public .next/standalone/ 2>/dev/null || true
mkdir -p .next/standalone/.next && cp -r .next/static .next/standalone/.next/
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save
echo "✔ Deployed. Logs: pm2 logs kometa"
