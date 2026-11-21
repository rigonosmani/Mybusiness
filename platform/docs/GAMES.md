# Original games — fairness and mathematics

All games are original implementations (own rules presentation, procedurally drawn
art, no third-party assets). Outcomes are computed in PostgreSQL
(`20261121000006_original_games.sql`); the browser verifier in `src/lib/fairness.ts`
re-implements the same functions and is tested against the database byte for byte.

## Provably fair scheme

- Per player seed pair: `server_seed` = 32 random bytes from `gen_random_bytes` (CSPRNG),
  stored in `app.seed_secrets` (not readable by clients); the player sees
  `SHA-256(server_seed)` before playing, a `client_seed` they may choose, and a `nonce`
  that increases by one per round.
- Float *i* of a round: `HMAC_SHA256(key = server_seed, msg = "client_seed:nonce:⌊i/8⌋")`,
  bytes `(i mod 8)·4 … +3` → `b0/256 + b1/256² + b2/256³ + b3/256⁴` ∈ [0, 1).
- Shuffles (mines, keno, video poker) use Fisher–Yates with consecutive floats.
- **Rotate seed pair** reveals the old server seed (blocked while a round is active);
  every past round can then be recomputed at *Provable fairness* (prefilled from
  *History → Verify*).

## House edge, RTP, margin, realised result

- **House edge** *e*: expected share of each stake kept by the house. **RTP** = 1 − *e*.
- Each round stores the edge in force when it started; changes apply to new rounds only
  and completed rounds are immutable (trigger `ROUND_FINALIZED`).
- **Sportsbook margin** is separate: offered odds = `1 + (source − 1)(1 − m)`; accepted bets keep their odds.
- **Realised profit/loss** is what actually happened in a period; it fluctuates around the
  expected edge (shown per game as realised RTP in the dashboards).
- Only the Main Admin can change edges (`admin_set_house_edge`, range-checked per game,
  history in `house_edge_history`). Games whose edge follows from the rules (roulette,
  blackjack, baccarat, video poker) are not configurable. External provider games would
  show the provider's certified RTP; their probabilities cannot be changed by an operator.

Payouts are `floor(stake × multiplier)` with the multiplier truncated to 4 decimals, so
realised RTP is at most the theoretical value by a rounding fraction.

| Game | Outcome | Payout / probability | Edge |
|---|---|---|---|
| Dice | roll = ⌊f·10000⌋/100 ∈ [0, 99.99] | under T: P = T/100; over T: P = (99.99−T)/100; multiplier = (1−e)/P; P ∈ [1 %, 98 %] | configurable (default 1 %) |
| Limbo | r = max(1, ⌊(1−e)/(1−f)·100⌋/100) | win if r ≥ target T; P = (1−e)/T; pays T | configurable (1 %) |
| Crash | crash point = Limbo formula, cap 1000× | multiplier shown as e^(0.08·t) from the **server** start time; cash-out evaluated with the DB clock; auto cash-out A wins if A ≤ crash point; P(reach m) = (1−e)/m | configurable (1.5 %) |
| Coin flip | heads if f < 0.5 | 2·(1−e) | configurable (1 %) |
| Mines | m mines on 25 tiles | after k safe picks: (1−e)·C(25,k)/C(25−m,k) | configurable (2 %) |
| Plinko | row i: right if fᵢ ≥ 0.5; bucket = #rights | base bᵏ with b per risk/rows (config), scaled by (1−e)/Σ C(n,k)/2ⁿ·base | configurable (2 %) |
| Keno | 10 of 40 drawn | base table per pick count (config), scaled with exact hypergeometric P(h) = C(10,h)C(30,p−h)/C(40,p) | configurable (2 %) |
| Hi-Lo | card = ⌊f·52⌋ (infinite deck) | "higher or same" P = (14−r)/13, "lower or same" P = r/13 (P = 1 not offered); multiplier = (1−e)·Π 1/Pᵢ | configurable (1 %) |
| Roulette | ⌊f·37⌋, European | straight 36×, even-money 2×, dozen/column 3× | 1/37 ≈ 2.70 % |
| Blackjack | infinite deck; P, D, P, hole, then draws | dealer stands soft 17, peeks, BJ 3:2, double on two cards, no split/insurance | ≈ 0.5–1 % (basic strategy) |
| Baccarat | infinite deck, standard tableau | Player 1:1, Banker 0.95:1, Tie 8:1 (P/B push on tie) | B 1.06 %, P 1.24 %, T ≈ 14.4 % |
| Video poker | single deck, Fisher–Yates 10 cards | Jacks or Better 9/6 (800/50/25/9/6/4/3/2/1) | ≈ 0.5 % with optimal play |
| Slots (Neon Orchard, Astro Gems) | 3×3, each cell independent weighted symbol | 5 lines × stake/5; three of a kind pays; EV/line = Σ pₛ³·payₛ, scaled to 1−e exactly | configurable (4 %) |

Tests (`supabase/tests/db/casino.test.ts`) assert that the scaled Plinko, Keno and slot
tables return exactly 1 − e in expectation and that the TypeScript float stream equals
`app.pf_float`.
