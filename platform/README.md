# Kometa — demo sportsbook & casino platform

Full-stack sportsbook and casino with a three-level administrator hierarchy, an
atomic double-entry credit ledger and provably-fair original games.

> **Demo credits only.** Credits (Cr) have no monetary value and cannot be bought,
> sold, redeemed or transferred outside the platform. Real-money play is disabled
> by database constraints (`real_money_disabled`, `no_real_money_yet`), not by a
> settings toggle. See [docs/SECURITY.md](docs/SECURITY.md#compliance-gate).

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, shadcn-style Radix components, Lucide icons, Recharts, TanStack Query, Zustand |
| Backend | Supabase PostgreSQL (all money and game logic in `SECURITY DEFINER` functions), Supabase Auth (+TOTP MFA), RLS, Realtime, Edge Functions (Deno) |
| Sports data | The Odds API (implemented), API-Sports (adapter scaffolded) |
| Language | Albanian (default), English |

## What is in here

```
platform/
├─ supabase/
│  ├─ migrations/      schema, RLS, ledger, sportsbook, casino engine, games, reports, privilege allowlist
│  ├─ functions/       admin-users · odds-sync · casino-provider-callback · maintenance (+ _shared adapters)
│  ├─ tests/db/        84 tests run against real PostgreSQL (hierarchy, credits, RLS, bets, games, privileges)
│  ├─ seed.sql, config.toml
├─ src/app/            (player) site · /admin secondary admin · /super main admin · /login · /mfa
├─ src/components/     UI kit, shells, bet slip, casino catalog, 14 game UIs, admin dialogs/charts
├─ src/lib/            money (BigInt), i18n (sq/en), provably-fair verifier, data access
├─ scripts/            bootstrap.ts (Main Admin + demo accounts), local-stack.sh (Docker-free E2E backend)
├─ e2e/smoke.mjs       Playwright smoke test through the real UI
└─ docs/               architecture, games math, providers, security, deployment
```

## Quick start (hosted Supabase)

1. Create a Supabase project. In **Auth → Providers → Email** disable sign-ups (accounts are created by administrators). Enable **MFA (TOTP)**.
2. Link and push the database:
   ```bash
   npm i -g supabase
   supabase link --project-ref <ref>
   supabase db push            # applies supabase/migrations
   ```
3. Deploy Edge Functions and set their secrets:
   ```bash
   supabase functions deploy admin-users admin-integrations odds-sync casino-launch casino-provider-callback maintenance
   supabase secrets set AUTH_EMAIL_DOMAIN=accounts.kometa.local ALLOWED_ORIGINS=https://your-domain \
                        CRON_SECRET=$(openssl rand -hex 32) INTEGRATION_SECRETS_KEY=$(openssl rand -hex 32)
   ```
4. Configure the app: `cp .env.example .env.local` and fill in URL, anon key, service-role key (used **only** by the bootstrap script on your machine).
5. Create the Main Administrator: `npm install && npm run bootstrap` (set `BOOTSTRAP_DEMO_ACCOUNTS=true` to also create `admin_a`, `admin_b`, `player_a1`, `player_b1`).
6. Run: `npm run dev` → http://localhost:3000. Sign in with a **username** (it maps to `<username>@AUTH_EMAIL_DOMAIN` internally).
7. Schedule `odds-sync` and `maintenance` (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#scheduled-jobs)). In **Main admin → Integrations** enter The Odds API key, enable it and press *Sync now*.
8. Licensed casino content (after you have a contract): **Main admin → Games** — enter the aggregator URL, keys, import its catalogue, activate. See [docs/CASINO_PROVIDERS.md](docs/CASINO_PROVIDERS.md).

Local development with Docker: `supabase start`, then use the printed URL/keys in `.env.local`.

## Tests

| Command | What it checks |
|---|---|
| `npm test` | unit (money, provider normalisation, sync budget, signatures) + database suites. Needs PostgreSQL ≥ 15 at `TEST_DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/postgres`); each suite runs the real migrations in a throw-away database. |
| `npm run typecheck`, `npx eslint src` | static checks |
| `npm run stack:up` → `npm run build && npm start` → `npm run e2e`, then `node e2e/mock-aggregator.mjs` + `node e2e/provider.mjs` (start the stack with `DENO_EXTRA_FLAGS=--unsafely-ignore-certificate-errors=localhost` for the self-signed mock) | Docker-free local stack (GoTrue + PostgREST + Deno Edge Function) and a Playwright run through the real UI |

The mandatory scenarios A–F map to `supabase/tests/db/hierarchy-wallet.test.ts` (A, B, C, F),
`sportsbook.test.ts` (D, F), `casino.test.ts` (E, F) and `security.test.ts`; `e2e/smoke.mjs`
repeats B, C, D and F through the browser.

## Documentation

- [Architecture, roles, tenant isolation, ledger](docs/ARCHITECTURE.md)
- [Original games: provably fair algorithm and mathematics; house edge vs RTP vs margin](docs/GAMES.md)
- [Sports data providers: evaluation, limits, settlement](docs/SPORTS_PROVIDERS.md)
- [Casino providers and licensed-content integration](docs/CASINO_PROVIDERS.md)
- [Security, compliance gate, backups](docs/SECURITY.md)
- [Deployment](docs/DEPLOYMENT.md)
