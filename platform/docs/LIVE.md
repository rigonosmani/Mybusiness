# Kometa Live — in-play football odds

Free in-play odds without buying a live odds feed.

1. **Pre-match odds** come from The Odds API. At kick-off the engine removes the bookmaker
   margin and fits two Poisson goal rates (home / away) that reproduce those odds
   (`supabase/functions/_shared/sports/live-model.ts`).
2. **Live scores** come from a free source whose key is entered in the admin panel:
   API-Football (`api_sports`, 100 requests/day) or football-data.org (`football_data`).
   One request returns every live match. Matches are linked by team names + kick-off time.
3. **Every minute** (`live-engine` Edge Function, pg_cron) the engine re-prices 1X2 and
   Over/Under from score + minute; the clock moves forward between polls. The score source
   is polled every `poll_minutes` (default 5) and only while a football match is live.
4. **Safety**: betting pauses `goal_cooldown_seconds` after a detected goal, when score data
   is older than `max_score_age_minutes`, from `close_minute` (88), at half-time end/extra
   time, and for outcomes below 2 % or above 97 %. Margin: `sportsbook.live_margin_bps` (8 %).
5. **Results**: a full-time (regular time) score from the source settles bets immediately.

Limitations: odds react to goals only after the next poll (up to `poll_minutes`), so a
player who watches the match can be faster than the engine. Fine for demo credits; a real
operation needs a paid, low-latency feed.

Config (admin panel → Integrations → Kometa Live):
`{"source": "auto", "poll_minutes": 5, "close_minute": 88, "goal_cooldown_seconds": 90,
"max_score_age_minutes": 15, "min_requests_remaining": 3}`
