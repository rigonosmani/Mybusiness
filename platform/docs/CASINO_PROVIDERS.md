# Casino content and licensed providers

**Free commercial slots do not exist.** Titles from studios such as those found on major
casino sites are licensed content delivered through aggregators under contract, with
jurisdiction licences, certified RTP and a seamless-wallet integration. Scraping or
embedding them without a licence is not done here. No free, legitimately reusable API
for commercial slot or live-dealer content was identified, so every playable game in
this platform is an **original demo implementation** (14 games, see [GAMES.md](GAMES.md)).

The *Live casino* category is intentionally empty and explains why; the provider rows
`licensed_aggregator` and `licensed_live_studio` are `not_configured`.

## Integration architecture (ready, disabled)

| Step | Where |
|---|---|
| Provider registration | `casino_providers` (status, wallet mode, licence reference, non-secret config) |
| Catalogue sync | insert/update `casino_games` with `provider_id`, `external_game_id`, `certified_rtp` |
| Authorised launch | `casino_create_session(game)` → session + one-time token (only its SHA-256 is stored); refuses with `PROVIDER_NOT_CONFIGURED` |
| Wallet callbacks | Edge Function `casino-provider-callback`: HMAC-SHA256 over `"<timestamp>.<body>"` with `PROVIDER_SECRET_<ID>`, 5-minute window → `svc_provider_wallet(debit|credit|rollback)` |
| Idempotency / replay | unique `(provider_id, provider_tx_id)` in `provider_transactions`; duplicates return the original result |
| Round tracking | `game_rounds.external_round_id` |
| Reconciliation | provider settlement account `SYS_PROVIDER_SETTLEMENT`; `reconcile_ledger()` |
| Errors | bad signatures → `security_events` (critical); invalid session → `SESSION_INVALID` |

To onboard a licensed provider: sign the contract, set the secret, implement its launch
URL format in a `casino-launch` function, sync its catalogue, set the provider `active`.
