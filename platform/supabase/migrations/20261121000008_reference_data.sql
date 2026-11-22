-- =============================================================================
-- KOMETA — reference data required by the application (settings, providers,
-- game catalog, game configuration, house-edge defaults, integrations).
-- Idempotent so it can be re-applied.
-- =============================================================================
insert into public.platform_settings (key, value, description, locked) values
  ('demo_mode', 'true', 'Demo-credit mode. Credits have no monetary value.', true),
  ('real_money_enabled', 'false', 'Real-money play. Hard-disabled by schema constraint.', true),
  ('security.require_admin_mfa', 'false', 'Require TOTP MFA (AAL2) for administrator operations. Enable in production.', false),
  ('responsible.limit_increase_cooldown_hours', '24', 'Hours before a raised/removed player limit takes effect.', false),
  ('casino.default_house_edge_bps', '100', 'Default house edge (basis points) for new configurable games.', false),
  ('casino.min_bet_units', '1', 'Minimum casino stake (units, 100 = 1 Cr).', false),
  ('casino.max_bet_units', '1000000', 'Maximum casino stake (units).', false),
  ('casino.max_payout_units', '100000000', 'Maximum payout of a single casino round (units).', false),
  ('sportsbook.margin_bps', '500', 'Pricing margin applied to provider odds (basis points of the price above 1.00).', false),
  ('sportsbook.min_bet_units', '10', 'Minimum sports stake (units).', false),
  ('sportsbook.max_bet_units', '1000000', 'Maximum sports stake (units).', false),
  ('sportsbook.max_payout_units', '100000000', 'Maximum potential payout of a bet (units).', false),
  ('sportsbook.max_selections', '20', 'Maximum selections in an accumulator.', false),
  ('sportsbook.prematch_odds_max_age_seconds', '7200', 'Pre-match odds older than this are suspended.', false),
  ('sportsbook.live_odds_max_age_seconds', '30', 'Live odds older than this are suspended.', false),
  ('sportsbook.live_betting_enabled', 'true', 'Accept bets on in-play fixtures (only with fresh odds).', false),
  ('platform.maintenance_mode', 'false', 'Block all wagering while true.', false),
  ('platform.default_locale', '"sq"', 'Default interface language.', false)
on conflict (key) do nothing;

insert into public.compliance_jurisdictions (code, name, notes) values
  ('XK', 'Kosovo', 'Placeholder. Real-money play requires a licence and a reviewed migration.'),
  ('AL', 'Albania', 'Placeholder. Real-money play requires a licence and a reviewed migration.')
on conflict (code) do nothing;

insert into public.casino_providers (id, name, kind, status, wallet_mode, notes) values
  ('kometa_originals', 'Kometa Originals', 'in_house', 'active', 'internal',
   'Original games built for this platform. Outcomes computed server-side, provably fair.'),
  ('licensed_aggregator', 'Licensed slot aggregator', 'aggregator', 'not_configured', 'seamless_callback',
   'Integration interface only. Commercial slot content requires a contract and licence with an aggregator.'),
  ('licensed_live_studio', 'Live casino studio', 'live_studio', 'not_configured', 'seamless_callback',
   'Integration interface only. Live dealer content is never freely available and requires a licensed studio.')
on conflict (id) do nothing;

insert into public.casino_games (id, provider_id, name, category, tags, edge_configurable, fixed_edge_note, is_featured, is_new, sort_order, min_bet, max_bet, description, rules) values
  ('dice', 'kometa_originals', 'Dice', 'originals', '{originals}', true, null, true, false, 10, 1, 1000000,
   '{"sq":"Zgjidhni një numër dhe hidhni zarin 0–99.99.","en":"Pick a target and roll 0–99.99."}',
   '{"sq":"Fitoni nëse rezultati është nën/mbi objektivin. Shumëzuesi = (1 − avantazhi) / probabiliteti.","en":"Win if the roll lands under/over your target. Multiplier = (1 − edge) / win chance."}'),
  ('crash', 'kometa_originals', 'Crash', 'originals', '{originals}', true, null, true, false, 20, 1, 1000000,
   '{"sq":"Shumëzuesi rritet derisa rrëzohet. Tërhiquni në kohë.","en":"The multiplier climbs until it crashes. Cash out in time."}',
   '{"sq":"Pika e rrëzimit përcaktohet në fillim. Tërheqja vlerësohet me orën e serverit.","en":"The crash point is fixed when the round starts. Cash-outs use the server clock."}'),
  ('mines', 'kometa_originals', 'Mines', 'originals', '{originals}', true, null, true, false, 30, 1, 1000000,
   '{"sq":"Zbuloni diamante, shmangni minat.","en":"Reveal gems, avoid the mines."}',
   '{"sq":"Pas k zbulimesh të sigurta: shumëzuesi = (1 − avantazhi) · C(25,k) / C(25−m,k).","en":"After k safe picks: multiplier = (1 − edge) · C(25,k) / C(25−m,k)."}'),
  ('plinko', 'kometa_originals', 'Plinko', 'originals', '{originals}', true, null, true, false, 40, 1, 1000000,
   '{"sq":"Lëshoni topin nëpër kunjat.","en":"Drop the ball through the pegs."}',
   '{"sq":"Çdo rresht: majtas/djathtas 50/50. Tabela shkallëzohet në RTP = 1 − avantazhi.","en":"Each row: left/right 50/50. Table scaled to RTP = 1 − edge."}'),
  ('limbo', 'kometa_originals', 'Limbo', 'originals', '{originals}', true, null, false, false, 50, 1, 1000000,
   '{"sq":"Vendosni një shumëzues objektiv.","en":"Set a target multiplier."}',
   '{"sq":"P(rezultati ≥ objektivi) = (1 − avantazhi) / objektivi.","en":"P(result ≥ target) = (1 − edge) / target."}'),
  ('roulette', 'kometa_originals', 'Ruleta Evropiane', 'table', '{originals,roulette}', false, '1/37 ≈ 2.70%', true, false, 60, 1, 1000000,
   '{"sq":"Ruletë me një zero.","en":"Single-zero European roulette."}',
   '{"sq":"Numër i drejtë 35:1, ngjyra/çift-tek/gjysmë 1:1, dhjetëshe/kolona 2:1.","en":"Straight 35:1, colour/odd-even/halves 1:1, dozens/columns 2:1."}'),
  ('blackjack', 'kometa_originals', 'Blackjack', 'table', '{originals,blackjack}', false, '≈ 0.5–1%', true, false, 70, 1, 1000000,
   '{"sq":"Arrini 21 pa e kaluar.","en":"Get to 21 without going over."}',
   '{"sq":"Dileri qëndron në 17 të butë, blackjack paguan 3:2, dyfishim në dy letrat e para, pa ndarje.","en":"Dealer stands on soft 17, blackjack pays 3:2, double on first two cards, no split."}'),
  ('coinflip', 'kometa_originals', 'Coin Flip', 'originals', '{originals}', true, null, false, true, 80, 1, 1000000,
   '{"sq":"Kokë apo pil?","en":"Heads or tails?"}',
   '{"sq":"Shans 50%, shumëzuesi = 2 · (1 − avantazhi).","en":"50% chance, multiplier = 2 · (1 − edge)."}'),
  ('hilo', 'kometa_originals', 'Hi-Lo', 'originals', '{originals}', true, null, false, true, 90, 1, 1000000,
   '{"sq":"Më e lartë apo më e ulët?","en":"Higher or lower?"}',
   '{"sq":"Shumëzuesi = (1 − avantazhi) · Π 1/P. Mund të kaloni letrën.","en":"Multiplier = (1 − edge) · Π 1/P. You may skip a card."}'),
  ('keno', 'kometa_originals', 'Keno', 'originals', '{originals}', true, null, false, true, 100, 1, 1000000,
   '{"sq":"Zgjidhni 1–10 numra nga 40.","en":"Pick 1–10 numbers out of 40."}',
   '{"sq":"10 numra tërhiqen. Tabela shkallëzohet me probabilitetet hipergjeometrike.","en":"10 numbers are drawn. Table scaled with exact hypergeometric odds."}'),
  ('baccarat', 'kometa_originals', 'Baccarat', 'table', '{baccarat}', false, 'B 1.06% · P 1.24% · T 14.4%', false, true, 110, 1, 1000000,
   '{"sq":"Lojtari, Bankieri apo Barazim.","en":"Player, Banker or Tie."}',
   '{"sq":"Lojtari 1:1, Bankieri 0.95:1, Barazim 8:1.","en":"Player 1:1, Banker 0.95:1, Tie 8:1."}'),
  ('videopoker', 'kometa_originals', 'Video Poker', 'poker', '{poker}', false, '≈ 0.5% (optimal)', false, true, 120, 1, 1000000,
   '{"sq":"Jacks or Better – mbani letrat dhe tërhiqni.","en":"Jacks or Better – hold and draw."}',
   '{"sq":"Royal 800, Straight Flush 50, Poker 25, Full 9, Flush 6, Rresht 4, Treshe 3, Dy çifte 2, J+ 1.","en":"Royal 800, Straight flush 50, Quads 25, Full house 9, Flush 6, Straight 4, Trips 3, Two pair 2, Jacks+ 1."}'),
  ('slot_neon_orchard', 'kometa_originals', 'Neon Orchard', 'slots', '{slots}', true, null, true, true, 130, 1, 1000000,
   '{"sq":"Slot origjinal 3×3 me 5 linja.","en":"Original 3×3 slot with 5 paylines."}',
   '{"sq":"Tre simbole të njëjta në një linjë paguajnë. RTP = 1 − avantazhi.","en":"Three of a kind on a line pays. RTP = 1 − edge."}'),
  ('slot_astro_gems', 'kometa_originals', 'Astro Gems', 'slots', '{slots}', true, null, false, true, 140, 1, 1000000,
   '{"sq":"Slot origjinal kozmik 3×3 me 5 linja.","en":"Original cosmic 3×3 slot with 5 paylines."}',
   '{"sq":"Tre simbole të njëjta në një linjë paguajnë. RTP = 1 − avantazhi.","en":"Three of a kind on a line pays. RTP = 1 − edge."}')
on conflict (id) do nothing;

insert into public.game_configurations (game_id, config) values
  ('plinko', '{"base": {"low": {"8": 1.35, "12": 1.25, "16": 1.18}, "medium": {"8": 1.9, "12": 1.65, "16": 1.5}, "high": {"8": 2.8, "12": 2.3, "16": 2.0}}}'),
  ('keno', '{"base": {"1": [0, 4.0], "2": [0, 1.8235, 5.1767], "3": [0, 0, 5.4759, 20.7295], "4": [0, 0, 2.924, 7.4208, 35.4158], "5": [0, 0, 0, 8.5353, 27.3088, 160.3871], "6": [0, 0, 0, 4.7609, 11.9547, 47.0699, 337.8386], "7": [0, 0, 0, 0, 14.3327, 44.2894, 213.109, 1882.3026], "8": [0, 0, 0, 0, 8.0701, 20.8664, 78.7985, 466.5964, 5195.6619], "9": [0, 0, 0, 0, 0, 25.9653, 82.0464, 381.286, 2846.3355, 42263.9088], "10": [0, 0, 0, 0, 0, 14.5463, 39.8202, 154.8429, 907.1817, 9030.5369, 208032.0556]}}'),
  ('slot_neon_orchard', '{"symbols": [{"id": "cherry", "weight": 30, "pay": 5}, {"id": "lemon", "weight": 25, "pay": 8}, {"id": "plum", "weight": 20, "pay": 15}, {"id": "bell", "weight": 12, "pay": 40}, {"id": "star", "weight": 8, "pay": 100}, {"id": "seven", "weight": 5, "pay": 400}]}'),
  ('slot_astro_gems', '{"symbols": [{"id": "quartz", "weight": 28, "pay": 4}, {"id": "topaz", "weight": 24, "pay": 7}, {"id": "emerald", "weight": 20, "pay": 12}, {"id": "sapphire", "weight": 14, "pay": 30}, {"id": "ruby", "weight": 9, "pay": 80}, {"id": "comet", "weight": 5, "pay": 500}]}')
on conflict (game_id) do nothing;

insert into public.game_configurations (game_id, config)
select id, '{}'::jsonb from public.casino_games
on conflict (game_id) do nothing;

insert into public.house_edge_settings (game_id, edge_bps, min_bps, max_bps) values
  ('dice', 100, 50, 1000), ('limbo', 100, 50, 1000), ('crash', 150, 50, 1000), ('mines', 200, 50, 1000),
  ('plinko', 200, 50, 1000), ('coinflip', 100, 50, 1000), ('hilo', 100, 50, 1000), ('keno', 200, 50, 1500),
  ('slot_neon_orchard', 400, 100, 1500), ('slot_astro_gems', 400, 100, 1500)
on conflict (game_id) do nothing;

insert into public.api_integrations (id, name, kind, config) values
  ('the_odds_api', 'The Odds API', 'sports_odds',
   '{"regions": "eu", "markets": "h2h,spreads,totals", "sports": ["soccer_epl", "soccer_spain_la_liga", "soccer_italy_serie_a", "soccer_germany_bundesliga", "soccer_uefa_champs_league", "basketball_nba", "basketball_euroleague", "tennis_atp_aus_open_singles", "americanfootball_nfl", "icehockey_nhl", "baseball_mlb", "mma_mixed_martial_arts", "boxing_boxing"], "odds_interval_minutes": 60, "scores_interval_minutes": 30, "days_from": 3}'),
  ('api_sports', 'API-Sports (API-Football)', 'sports_odds',
   '{"note": "Adapter scaffolded; enable once an API-Sports key and plan are configured."}')
on conflict (id) do nothing;
