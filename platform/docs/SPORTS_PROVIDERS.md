# Sports data providers

The sportsbook never invents odds or markets: a market exists only if a provider returned
both of its sides, and is suspended when the provider stops sending it or its odds age
past the freshness window (`sportsbook.prematch_odds_max_age_seconds`, default 7200;
`sportsbook.live_odds_max_age_seconds`, default 30).

## The Odds API — implemented (primary)

Facts checked on 2026-11-21 at the-odds-api.com (re-check before going live):

| Item | Value |
|---|---|
| Plans | Starter **free, 500 credits/month**; 20K $30/mo; 100K $59/mo; 5M $119/mo; 15M $249/mo |
| Cost | `/sports` free; `/odds` = markets × regions (empty responses free); `/scores` 1, or 2 with `daysFrom`; `/events/{id}/odds` = markets returned × regions |
| Markets | featured: `h2h` (includes draw for soccer), `spreads`, `totals`, outrights — spreads/totals "mainly available for US sports and bookmakers". BTTS, draw no bet, double chance, correct score, period markets and player props are *additional markets*, fetched one event at a time |
| Freshness | featured markets update every 60 s pre-match, 40 s in-play; live scores ≈ every 30 s; results up to 3 days back |
| Terms | display in apps (incl. commercial) allowed; resale/redistribution of the data as a standalone product prohibited; attribution appreciated, not required; keep the key private |

What the adapter does (`_shared/sports/the-odds-api.ts`): fetches `/odds` per configured
league with `oddsFormat=decimal`, takes the **median** price per outcome across returned
bookmakers (separately per totals/spread line), drops one-sided markets, and maps
`h2h`, `spreads`, `totals`, `btts`, `draw_no_bet`, `h2h_3_way`. Scores come from `/scores`
and settle full-time markets automatically. Per-event additional markets (double chance,
correct score) are not fetched yet because each event costs extra credits; the schema
and grader already support them.

Budget: the free plan allows ~16 credits/day. The default sync config (2 leagues,
`h2h,totals`, one region, every 12 h) costs ~8 credits/day plus score checks only for
started fixtures; the job stops when `x-requests-remaining` drops below
`min_requests_remaining`. For a usable live sportsbook a paid plan (20K+) and a shorter
interval are required. Note that the free feed cannot meet a 30-second live window
unless polled often, so in-play markets will usually be suspended — by design.

## API-Sports — adapter scaffolded

API-Sports offers per-sport APIs (football, basketball, …) with fixtures, live scores and
bookmaker odds. Its pricing and documentation pages refused automated access during
this evaluation, so plan limits, odds availability and update frequency **were not
verified**; check https://api-sports.io before relying on it. `api-sports.ts` contains a
results mapper for `/fixtures` (finished = FT/AET/PEN) and throws
`ProviderNotConfiguredError` without a key. Completing it means mapping `/odds` bets to
`MarketKey`s and adding a sync job; the `OddsProvider` interface keeps the rest unchanged.

## Settlement rules

Full-time score as reported by the provider (regular time for soccer). Two-way `h2h`
ties are void; Asian/quarter lines split into half stakes (`half_won` pays (1+odds)/2,
`half_lost` returns half). Cancelled fixtures void every leg (stake refunded); void legs
count as odds 1.00 in accumulators. Unsupported markets stay open for manual settlement
by the Main Admin (audited).
