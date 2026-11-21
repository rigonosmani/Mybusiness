-- =============================================================================
-- KOMETA seed data (idempotent). Users are created by `npm run bootstrap`
-- through the Supabase Admin API, never here.
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
