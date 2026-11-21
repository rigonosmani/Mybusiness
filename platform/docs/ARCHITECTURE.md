# Architecture

## Principles

1. **The database is the authority.** Every balance change, bet, settlement and game
   outcome happens inside a PostgreSQL function, in one transaction, under row locks.
   The browser only displays results; it never computes balances or outcomes.
2. **Least privilege by default.** Tables are read-only to clients (RLS); there are no
   client `INSERT/UPDATE/DELETE` grants on any public table. Functions are not executable
   unless listed in `20261121000099_privileges.sql`; `security.test.ts` fails if that list changes.
3. **Service role stays on the server.** It is used only by Edge Functions and the local
   bootstrap script. `svc_*` functions are executable by `service_role` only and still
   re-check the acting user passed to them.

## Components

```
Browser (Next.js app, anon key + user JWT)
  ├── PostgREST  → RLS-protected reads, RPCs (wallet, bets, games, admin actions)
  ├── Realtime   → own wallet balance, bets, game results (RLS-filtered)
  ├── Auth       → password sign-in, TOTP MFA (AAL2 for admins)
  └── Edge Function admin-users → Auth Admin API (create user, reset password, ban)
Scheduler → odds-sync (The Odds API → svc_upsert_odds / svc_update_scores → settlement)
          → maintenance (anomaly detection, stale-market suspension, ledger check)
Licensed provider → casino-provider-callback (HMAC + timestamp) → svc_provider_wallet
```

## Roles and tenants

| Role | Created by | Sees | Cannot |
|---|---|---|---|
| `super_admin` (exactly one, unique index) | `npm run bootstrap` | administrators, their wallets and admin-level ledger; aggregate statistics | see or manage individual players; create players |
| `admin` | Main Admin | own wallet; players of own tenant, their bets, rounds, ledger | create admins; see other tenants; mint credits; change edge/settings |
| `player` | their admin | own data only | transfer credits; change balances |

`administrator_groups.id` is the tenant id. `profiles.tenant_id` is set for admins (own
group) and players (owner's group); `administrator_players` records the single owner of
each player. Visibility is centralised in `app.can_view_owner()` and reused by RLS
policies on profiles, wallets, ledger entries, transfers and limits. Main Admin reports
(`super_admin_overview`) return aggregates only; security events about players are
masked for the Main Admin (`list_security_events`).

Role and tenant columns have no client write path. Accounts are created by the
`admin-users` Edge Function, which first asks the database whether the caller may
create that role (`svc_check_can_provision`), then creates the Auth user, then
provisions the profile (`svc_provision_account`), deleting the Auth user if that fails.

## Ledger

- `ledger_accounts`: one `user_wallet` per user plus system accounts
  (`SYS_ISSUANCE`, `SYS_HOUSE_CASINO`, `SYS_HOUSE_SPORTSBOOK`, `SYS_PROVIDER_SETTLEMENT`).
  Only system accounts may go negative (check constraint).
- `ledger_transactions` + `ledger_entries`: double entry; a deferred constraint trigger
  rejects any transaction whose entries do not sum to zero. Both tables are append-only
  (triggers reject UPDATE/DELETE even for the owner role).
- `app.post_transaction` claims the idempotency key first (`unique (actor, key)`), locks
  all involved accounts in id order (`FOR UPDATE`), checks balances and writes entries with
  `balance_after`. Concurrent duplicates wait on the key and return the original result.
- Amounts are `bigint` units, 1 Cr = 100 units. The client parses and formats with BigInt.
- Reversals post a compensating transaction linked by `reverses_tx_id` (unique, so a
  transaction can be reversed once); the original is never modified.
- `reconcile_ledger()` verifies cached balances against entries, per-transaction balance
  and that the whole system nets to zero.

Example (specification, Test B): issuance 1000 → Main Admin; allocation 100 → Admin A
(Main 900 / A 100); player credit 10 → Player A1 (A 90 / A1 10).

## Sportsbook

Provider data is normalised in TypeScript (`supabase/functions/_shared/sports`) and
written by `svc_upsert_odds`. Offered odds = `1 + (source − 1) × (1 − margin)`, rounded
down to 2 decimals. Markets the provider stops sending are suspended. `place_bets`
validates every selection against the *current* offered price (stale quote →
`ODDS_CHANGED`), market/fixture state and odds age (pre-match and live windows), checks
limits and balance, then debits the stake. Accepted terms are immutable (trigger).
Results from the provider grade full-time markets (`app.grade_outcome`, incl. Asian
quarter lines → half won/lost); `app.try_settle_bet` is idempotent (row lock + unique
settlement per bet). The Main Admin can suspend, void, cancel or settle manually.

## Casino

`app.begin_round` validates game/provider/stake/limits/rate, consumes a nonce of the
player's seed pair, freezes the current house edge into the round and debits the stake;
`app.finish_round` pays `floor(stake × multiplier)` and writes an immutable
`game_results` row. Secret state (mine positions, hole card, deck, crash point) lives in
`app.round_secrets`, which clients cannot read. See [GAMES.md](GAMES.md).
