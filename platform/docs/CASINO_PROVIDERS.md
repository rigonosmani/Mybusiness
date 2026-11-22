# Casino content and licensed providers

**Free commercial slots do not exist.** Titles from studios such as those found on major
casino sites are licensed content delivered through aggregators under contract, with
jurisdiction licences, certified RTP and a seamless-wallet integration. Scraping or
embedding them without a licence is not done here. No free, legitimately reusable API
for commercial slot or live-dealer content was identified, so every playable game in
this platform is an **original demo implementation** (14 games, see [GAMES.md](GAMES.md)).

The *Live casino* category is intentionally empty and explains why; the provider rows
`licensed_aggregator` and `licensed_live_studio` are `not_configured`.

## Connecting a provider from the admin panel

Everything is configured by the Main Administrator — no code changes:

1. Edge Function secret (once): `supabase secrets set INTEGRATION_SECRETS_KEY=$(openssl rand -hex 32)`.
2. **Main admin → Games → Licensed slot aggregator**:
   - *API base URL* (https), *Licence reference*, settings JSON
     (`operator_id`, `launch_path` default `/games/launch`, `launch_url_field`, `currency`, `extra`);
   - *API key* and *Callback secret* — write-only fields, encrypted in the database
     (pgp_sym_encrypt with `INTEGRATION_SECRETS_KEY`), only the last 4 characters are ever shown;
   - give the provider the displayed *Wallet callback URL*;
   - *Import games*: paste the provider's catalogue as JSON
     `[{"external_game_id","name","category","thumbnail","rtp"}]`;
   - set status **active** (refused until URL, API key and callback secret exist).
3. Players see the games in the catalogue; `casino-launch` asks the provider for a game URL
   (signed server-to-server request) and the game opens in an iframe. Every spin moves
   Kometa credits through `casino-provider-callback` (`balance`, `debit`, `credit`, `rollback`).

**Generic protocol.** `supabase/functions/_shared/casino/generic-aggregator.ts` implements the
common seamless-wallet shape (launch: `POST {base}{launch_path}` with `x-timestamp`,
`x-signature = HMAC-SHA256(api_key, "<ts>.<body>")`; callbacks signed with the callback secret).
Field names are configurable; a vendor whose API differs more needs a small adapter file
next to it — the wallet, sessions, rounds and admin screens stay the same.

**Local test:** `e2e/mock-aggregator.mjs` is a fake provider that follows this protocol;
`e2e/provider.mjs` drives the whole flow through the UI.

## Integration architecture

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
