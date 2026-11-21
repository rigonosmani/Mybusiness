# Security

| Control | Implementation |
|---|---|
| Authentication | Supabase Auth, password ≥ 10 chars with letters + digits, sign-ups disabled; usernames map to synthetic e-mails |
| Administrator MFA | TOTP at `/mfa`; admin areas require AAL2 when a factor exists; setting `security.require_admin_mfa=true` makes every admin RPC require `aal2` in the JWT (enforced in SQL) — enable it in production |
| Authorisation | RLS on every public table; no client write grants; explicit function allowlist; `svc_*` service-role only; `security.test.ts` guards all of this |
| Tenant isolation | `app.can_view_owner`; cross-tenant targets return the same "not found" error as missing ones |
| Money integrity | atomic transactions, row locks, idempotency keys, zero-sum constraint, append-only ledger, reconciliation |
| Anti-replay | idempotency keys (transfers, bet slips, game rounds); provider callbacks: signature + timestamp window + unique tx id |
| Rate limiting | per-user DB limits on transfers (60/min), bets (20/10 s), game rounds (40/10 s), admin-users (30/min); Supabase Auth rate limits |
| Input validation | all parameters validated in SQL functions; amounts are integers; client seeds regex-checked |
| XSS / CSRF | React escaping, no `dangerouslySetInnerHTML`; strict CSP (`script-src 'self'`, `frame-ancestors 'none'`, `connect-src` = Supabase only); bearer-token APIs (no cookie-authenticated mutations) |
| Secrets | service-role and API keys only in Edge Function secrets / local bootstrap env; never `NEXT_PUBLIC_*`; integrations config rejects secret-looking keys |
| Audit | `audit_logs` (immutable, platform vs tenant scope), `security_events`, `house_edge_history`, `provider_sync_logs` |
| Suspicious activity | `maintenance` job: anomalous casino returns, ledger mismatches; denied admin actions are logged |
| Responsible play | daily wager/loss limits, max stake, 24 h cooling-off on raising limits, self-exclusion (1–365 days), all enforced server-side |

## Compliance gate

`platform_settings` rejects `real_money_enabled = true` and `demo_mode = false`;
`compliance_jurisdictions.real_money_allowed` is constrained to `false`. Profiles carry
`date_of_birth`/`kyc_status` placeholders. Enabling real money requires, at minimum: a
licence for each jurisdiction, age/KYC verification, payment and withdrawal integrations,
regulator reporting, certified RNG/game testing, and a reviewed migration lifting these
constraints. None of this is enabled.

## Backup and recovery

Use Supabase PITR (Pro plan) plus daily logical dumps
(`supabase db dump --data-only > backup.sql`). After a restore run `reconcile_ledger()`
as the Main Admin; it must report `ok: true` before reopening play (set
`platform.maintenance_mode=true` meanwhile).
