-- =============================================================================
-- KOMETA — live odds engine (football).
--
-- Live 1X2 / Over-Under prices are computed by the `live-engine` Edge Function
-- from a free live-score source (API-Football or football-data.org) and a Poisson
-- model fitted to the provider's pre-match odds. This migration stores the live
-- state, applies the prices with the live margin and suspends markets when the
-- engine says so (goal cool-down, stale score, end of match).
-- =============================================================================

alter table public.fixtures
  add column if not exists live_minute          int,
  add column if not exists live_period          text,
  add column if not exists live_model           jsonb,
  add column if not exists live_source          text,
  add column if not exists live_source_id       text,
  add column if not exists live_updated_at      timestamptz,
  add column if not exists live_suspended_until timestamptz;

insert into public.api_integrations (id, name, kind, enabled, config) values
  ('live_engine', 'Kometa Live (odds engine)', 'sports_odds', true,
   '{"source": "auto", "poll_minutes": 5, "close_minute": 88, "goal_cooldown_seconds": 90, "max_score_age_minutes": 15, "min_requests_remaining": 3}'),
  ('football_data', 'football-data.org (live scores)', 'sports_results', false,
   '{"note": "Free live-score source for Kometa Live. Enter the API key only."}')
on conflict (id) do nothing;

update public.api_integrations
   set name = 'API-Football (live scores)',
       config = '{"note": "Free live-score source for Kometa Live. Enter the API key only."}'::jsonb
 where id = 'api_sports';

insert into public.platform_settings (key, value, description, locked) values
  ('sportsbook.live_margin_bps', '800', 'Margin applied to Kometa Live in-play odds (basis points).', false)
on conflict (key) do nothing;

-- The engine re-prices every minute.
update public.platform_settings
   set value = '150'::jsonb,
       description = 'Live odds older than this are suspended (Kometa Live re-prices every minute).'
 where key = 'sportsbook.live_odds_max_age_seconds' and value = '30'::jsonb;

-- Football fixtures in play (or just finished) with what the engine needs.
create or replace function public.svc_live_targets() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'fixture_id', f.id, 'provider', f.provider, 'provider_event_id', f.provider_event_id,
    'home_team', f.home_team, 'away_team', f.away_team, 'commence_time', f.commence_time,
    'home_score', f.home_score, 'away_score', f.away_score,
    'live_minute', f.live_minute, 'live_period', f.live_period, 'live_source_id', f.live_source_id,
    'live_updated_at', f.live_updated_at, 'live_model', f.live_model,
    'h2h', (select jsonb_build_object(
               'home', max(o.source_odds) filter (where o.outcome_key = 'home'),
               'draw', max(o.source_odds) filter (where o.outcome_key = 'draw'),
               'away', max(o.source_odds) filter (where o.outcome_key = 'away'))
              from public.betting_markets m join public.market_outcomes o on o.market_id = m.id
             where m.fixture_id = f.id and m.market_key = 'h2h' and m.period = 'ft'),
    'totals', coalesce((select jsonb_agg(jsonb_build_object(
               'line', m.line,
               'over', (select source_odds from public.market_outcomes where market_id = m.id and outcome_key = 'over'),
               'under', (select source_odds from public.market_outcomes where market_id = m.id and outcome_key = 'under')))
              from public.betting_markets m
             where m.fixture_id = f.id and m.market_key = 'totals' and m.period = 'ft' and m.line is not null
               and m.status in ('open', 'suspended')), '[]'::jsonb)
  )), '[]'::jsonb)
  from public.fixtures f
  join public.leagues l on l.id = f.league_id
  where l.sport_id = 'football'
    and f.status = 'live'
    and f.commence_time > now() - interval '4 hours'
$$;

-- p_items: [{fixture_id, observed, home_score, away_score, minute, period, source, source_id,
--            model, suspend, markets:[{market_key, line, outcomes:[{key, label, point, prob}]}]}]
create or replace function public.svc_apply_live(p_items jsonb, p_goal_cooldown_seconds int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_it jsonb;
  v_mk jsonb;
  v_oc jsonb;
  v_f public.fixtures;
  v_market uuid;
  v_outcome uuid;
  v_seen uuid[];
  v_margin int := app.setting_int('sportsbook.live_margin_bps', 800)::int;
  v_line numeric;
  v_prob numeric;
  v_price numeric;
  v_suspend boolean;
  v_priced int := 0;
  v_suspended int := 0;
  v_goals int := 0;
begin
  for v_it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select * into v_f from public.fixtures where id = (v_it->>'fixture_id')::uuid for update;
    continue when not found or v_f.status in ('finished', 'cancelled', 'postponed');

    if coalesce((v_it->>'observed')::boolean, false) then
      -- A score change while we were watching = goal (or correction): pause betting.
      if v_f.home_score is not null and v_f.live_updated_at is not null
         and ((v_it->>'home_score')::int is distinct from v_f.home_score or (v_it->>'away_score')::int is distinct from v_f.away_score) then
        v_f.live_suspended_until := now() + make_interval(secs => greatest(0, coalesce(p_goal_cooldown_seconds, 90)));
        v_goals := v_goals + 1;
      end if;
      update public.fixtures
         set home_score = (v_it->>'home_score')::int,
             away_score = (v_it->>'away_score')::int,
             live_minute = nullif(v_it->>'minute', '')::numeric::int,
             live_period = v_it->>'period',
             live_source = v_it->>'source',
             live_source_id = v_it->>'source_id',
             live_updated_at = now(),
             last_scores_at = now(),
             live_suspended_until = v_f.live_suspended_until
       where id = v_f.id;
    end if;
    if v_it ? 'model' and jsonb_typeof(v_it->'model') = 'object' then
      update public.fixtures set live_model = v_it->'model' where id = v_f.id;
    end if;

    v_suspend := coalesce((v_it->>'suspend')::boolean, false)
                 or (v_f.live_suspended_until is not null and v_f.live_suspended_until > now());
    if v_suspend then
      update public.betting_markets set status = 'suspended' where fixture_id = v_f.id and status = 'open';
      v_suspended := v_suspended + 1;
      continue;
    end if;

    v_seen := array[]::uuid[];
    for v_mk in select * from jsonb_array_elements(coalesce(v_it->'markets', '[]'::jsonb)) loop
      continue when v_mk->>'market_key' not in ('h2h', 'totals');
      v_line := nullif(v_mk->>'line', '')::numeric;
      insert into public.betting_markets (fixture_id, market_key, period, line, line_key, status, source, bookmaker_count, last_odds_at)
      values (v_f.id, v_mk->>'market_key', 'ft', v_line, coalesce(v_line::text, ''), 'open', 'kometa_live', 0, now())
      on conflict (fixture_id, market_key, period, line_key) do update
        set last_odds_at = now(), source = 'kometa_live',
            status = case when betting_markets.status in ('settled', 'void') then betting_markets.status else 'open' end
      returning id into v_market;
      v_seen := v_seen || v_market;

      for v_oc in select * from jsonb_array_elements(coalesce(v_mk->'outcomes', '[]'::jsonb)) loop
        v_prob := (v_oc->>'prob')::numeric;
        if v_prob is null or v_prob < 0.02 or v_prob > 0.97 then
          -- Too unlikely / too certain to offer a sensible price.
          update public.market_outcomes set status = 'suspended', updated_at = now()
           where market_id = v_market and outcome_key = v_oc->>'key' and result = 'pending';
          continue;
        end if;
        v_price := round(1 / v_prob, 3);
        insert into public.market_outcomes (market_id, outcome_key, label, point, source_odds, offered_odds, margin_bps, status)
        values (v_market, v_oc->>'key', v_oc->>'label', nullif(v_oc->>'point', '')::numeric,
                v_price, app.offered_odds(v_price, v_margin), v_margin, 'open')
        on conflict (market_id, outcome_key) do update
          set source_odds = excluded.source_odds,
              offered_odds = excluded.offered_odds,
              margin_bps = excluded.margin_bps,
              label = excluded.label,
              point = excluded.point,
              status = case when market_outcomes.result = 'pending' then 'open'::public.market_status else market_outcomes.status end,
              updated_at = now()
        returning id into v_outcome;
        if coalesce((v_it->>'observed')::boolean, false) then
          insert into public.odds_snapshots (outcome_id, source_odds, offered_odds, provider)
          values (v_outcome, v_price, app.offered_odds(v_price, v_margin), 'kometa_live');
        end if;
      end loop;
    end loop;

    -- Markets the engine does not price in play (spreads, BTTS, decided lines...) stay closed.
    update public.betting_markets set status = 'suspended'
     where fixture_id = v_f.id and status = 'open' and not (id = any (v_seen));
    update public.fixtures set last_odds_at = now() where id = v_f.id;
    v_priced := v_priced + 1;
  end loop;
  return jsonb_build_object('priced', v_priced, 'suspended', v_suspended, 'goals', v_goals);
end $$;

revoke execute on function public.svc_live_targets(), public.svc_apply_live(jsonb, int) from public, anon, authenticated;
grant execute on function public.svc_live_targets(), public.svc_apply_live(jsonb, int) to service_role;
