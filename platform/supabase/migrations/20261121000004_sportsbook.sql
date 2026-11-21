-- =============================================================================
-- KOMETA — Phase 4: sportsbook (demo credits)
--
-- Odds come only from a configured external provider (see Edge Function
-- `odds-sync`). Nothing here invents odds or markets: a market exists only if a
-- provider supplied it. Offered odds = provider odds with a configurable margin.
-- =============================================================================

create table public.api_integrations (
  id                 text primary key,
  name               text not null,
  kind               text not null check (kind in ('sports_odds', 'sports_results', 'casino_aggregator')),
  enabled            boolean not null default false,
  key_configured     boolean not null default false,  -- secrets live in Edge Function env, never here
  status             text not null default 'not_configured'
                     check (status in ('not_configured', 'ok', 'degraded', 'error', 'disabled')),
  config             jsonb not null default '{}'::jsonb,
  requests_remaining int,
  requests_used      int,
  last_success_at    timestamptz,
  last_error         text,
  last_error_at      timestamptz,
  updated_at         timestamptz not null default now()
);

create table public.provider_sync_logs (
  id                 bigint generated always as identity primary key,
  integration_id     text not null references public.api_integrations (id),
  job                text not null,
  status             text not null check (status in ('ok', 'error', 'skipped')),
  items              int not null default 0,
  requests_remaining int,
  error              text,
  details            jsonb not null default '{}'::jsonb,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz
);
create index provider_sync_logs_idx on public.provider_sync_logs (integration_id, started_at desc);

create table public.sports (
  id         text primary key check (id ~ '^[a-z0-9_]{2,48}$'),
  name       text not null,
  active     boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

create table public.leagues (
  id            uuid primary key default gen_random_uuid(),
  sport_id      text not null references public.sports (id),
  provider      text not null,
  provider_key  text not null,
  name          text not null,
  country       text,
  has_outrights boolean not null default false,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (provider, provider_key)
);
create index leagues_sport_idx on public.leagues (sport_id);

create type public.fixture_status as enum ('scheduled', 'live', 'finished', 'cancelled', 'postponed');

create table public.fixtures (
  id                uuid primary key default gen_random_uuid(),
  league_id         uuid not null references public.leagues (id),
  provider          text not null,
  provider_event_id text not null,
  home_team         text not null,
  away_team         text not null,
  commence_time     timestamptz not null,
  status            public.fixture_status not null default 'scheduled',
  home_score        int,
  away_score        int,
  result_verified   boolean not null default false,
  completed_at      timestamptz,
  last_odds_at      timestamptz,
  last_scores_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (provider, provider_event_id)
);
create index fixtures_commence_idx on public.fixtures (status, commence_time);
create index fixtures_league_idx on public.fixtures (league_id, commence_time);
create trigger fixtures_touch before update on public.fixtures for each row execute function app.touch_updated_at();

create type public.market_status as enum ('open', 'suspended', 'settled', 'void');
create type public.selection_result as enum ('pending', 'won', 'lost', 'void', 'half_won', 'half_lost');

create table public.betting_markets (
  id              uuid primary key default gen_random_uuid(),
  fixture_id      uuid not null references public.fixtures (id) on delete cascade,
  market_key      text not null check (market_key in (
                    'h2h', 'h2h_3way', 'double_chance', 'draw_no_bet', 'totals', 'spreads',
                    'btts', 'correct_score', 'period_winner')),
  period          text not null default 'ft',
  line            numeric(6, 2),
  line_key        text not null default '',
  status          public.market_status not null default 'open',
  source          text not null,
  bookmaker_count int not null default 0,
  last_odds_at    timestamptz,
  settled_at      timestamptz,
  settled_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (fixture_id, market_key, period, line_key)
);
create index betting_markets_fixture_idx on public.betting_markets (fixture_id);
create trigger betting_markets_touch before update on public.betting_markets for each row execute function app.touch_updated_at();

create table public.market_outcomes (
  id           uuid primary key default gen_random_uuid(),
  market_id    uuid not null references public.betting_markets (id) on delete cascade,
  outcome_key  text not null,        -- home | away | draw | over | under | yes | no | 1X | X2 | 12 | score:H-A
  label        text not null,
  point        numeric(6, 2),
  source_odds  numeric(10, 3) not null check (source_odds > 1),
  offered_odds numeric(10, 2) not null check (offered_odds >= 1.01),
  margin_bps   int not null,
  status       public.market_status not null default 'open',
  result       public.selection_result not null default 'pending',
  updated_at   timestamptz not null default now(),
  unique (market_id, outcome_key)
);

create table public.odds_snapshots (
  id           bigint generated always as identity primary key,
  outcome_id   uuid not null references public.market_outcomes (id) on delete cascade,
  source_odds  numeric(10, 3) not null,
  offered_odds numeric(10, 2) not null,
  provider     text not null,
  captured_at  timestamptz not null default now()
);
create index odds_snapshots_outcome_idx on public.odds_snapshots (outcome_id, captured_at desc);

create type public.bet_status as enum ('open', 'won', 'lost', 'void');

create table public.bet_slips (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id),
  tenant_id       uuid not null,
  slip_type       text not null check (slip_type in ('singles', 'accumulator')),
  total_stake     bigint not null check (total_stake > 0),
  stake_tx_id     uuid references public.ledger_transactions (id),
  idempotency_key text not null,
  created_at      timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table public.bets (
  id               uuid primary key default gen_random_uuid(),
  slip_id          uuid not null references public.bet_slips (id),
  user_id          uuid not null references public.profiles (id),
  tenant_id        uuid not null,
  bet_type         text not null check (bet_type in ('single', 'accumulator')),
  stake            bigint not null check (stake > 0),
  total_odds       numeric(14, 4) not null check (total_odds >= 1),
  potential_payout bigint not null,
  status           public.bet_status not null default 'open',
  payout           bigint,
  payout_tx_id     uuid references public.ledger_transactions (id),
  placed_at        timestamptz not null default now(),
  settled_at       timestamptz
);
create index bets_user_idx on public.bets (user_id, placed_at desc);
create index bets_tenant_idx on public.bets (tenant_id, placed_at desc);
create index bets_open_idx on public.bets (status) where status = 'open';

create table public.bet_selections (
  id           uuid primary key default gen_random_uuid(),
  bet_id       uuid not null references public.bets (id) on delete cascade,
  outcome_id   uuid not null references public.market_outcomes (id),
  market_id    uuid not null references public.betting_markets (id),
  fixture_id   uuid not null references public.fixtures (id),
  odds         numeric(10, 2) not null,       -- quoted, offered odds at acceptance (immutable)
  source_odds  numeric(10, 3) not null,
  point        numeric(6, 2),
  was_live     boolean not null default false,
  result       public.selection_result not null default 'pending',
  -- Human-readable snapshot so history survives provider renames.
  event_name   text not null,
  market_key   text not null,
  outcome_label text not null,
  commence_time timestamptz not null
);
create index bet_selections_bet_idx on public.bet_selections (bet_id);
create index bet_selections_outcome_idx on public.bet_selections (outcome_id);
create index bet_selections_market_idx on public.bet_selections (market_id);

create table public.bet_settlements (
  id         uuid primary key default gen_random_uuid(),
  bet_id     uuid not null unique references public.bets (id),
  result     public.bet_status not null,
  factor     numeric(18, 6) not null,
  payout     bigint not null,
  tx_id      uuid references public.ledger_transactions (id),
  settled_by text not null,
  details    jsonb not null default '{}'::jsonb,
  settled_at timestamptz not null default now()
);

create trigger bet_settlements_immutable before update or delete on public.bet_settlements
  for each row execute function app.forbid_mutation();

-- Accepted bet terms are immutable; only the settlement columns may change.
create or replace function app.protect_bet_terms() returns trigger
language plpgsql as $$
begin
  if new.stake <> old.stake or new.total_odds <> old.total_odds or new.potential_payout <> old.potential_payout
     or new.user_id <> old.user_id or new.placed_at <> old.placed_at or new.slip_id <> old.slip_id then
    raise exception 'BET_TERMS_IMMUTABLE' using errcode = 'P0001';
  end if;
  if old.status <> 'open' then
    raise exception 'BET_ALREADY_SETTLED' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger bets_protect before update on public.bets for each row execute function app.protect_bet_terms();
create trigger bets_no_delete before delete on public.bets for each row execute function app.forbid_mutation();

create or replace function app.protect_selection_terms() returns trigger
language plpgsql as $$
begin
  if new.odds <> old.odds or new.outcome_id <> old.outcome_id or new.bet_id <> old.bet_id then
    raise exception 'BET_TERMS_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger bet_selections_protect before update on public.bet_selections
  for each row execute function app.protect_selection_terms();

-- -----------------------------------------------------------------------------
-- Pricing
-- -----------------------------------------------------------------------------
-- Offered price keeps (1 - margin) of the provider's profit portion, rounded down.
create or replace function app.offered_odds(p_source numeric, p_margin_bps int) returns numeric
language sql immutable as $$
  select greatest(1.01, floor((1 + (p_source - 1) * (1 - p_margin_bps / 10000.0)) * 100) / 100)::numeric(10, 2)
$$;

-- -----------------------------------------------------------------------------
-- Provider ingestion (service role only)
-- -----------------------------------------------------------------------------
-- p_events: [{sport_key, sport_title, league_key, league_title, country, has_outrights,
--             event_id, home_team, away_team, commence_time, odds_updated_at,
--             markets:[{market_key, period, line, bookmaker_count,
--                       outcomes:[{key, label, point, price}]}]}]
create or replace function public.svc_upsert_odds(p_provider text, p_events jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ev jsonb;
  v_mk jsonb;
  v_oc jsonb;
  v_league uuid;
  v_fixture uuid;
  v_market uuid;
  v_outcome uuid;
  v_margin int := app.setting_int('sportsbook.margin_bps', 500)::int;
  v_at timestamptz;
  v_seen_markets uuid[];
  v_fixtures int := 0;
  v_markets int := 0;
  v_price numeric;
  v_old_price numeric;
  v_line numeric;
begin
  for v_ev in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    v_at := coalesce((v_ev->>'odds_updated_at')::timestamptz, now());

    insert into public.sports (id, name)
    values (v_ev->>'sport_key', v_ev->>'sport_title')
    on conflict (id) do nothing;

    insert into public.leagues (sport_id, provider, provider_key, name, country, has_outrights)
    values (v_ev->>'sport_key', p_provider, v_ev->>'league_key', v_ev->>'league_title',
            v_ev->>'country', coalesce((v_ev->>'has_outrights')::boolean, false))
    on conflict (provider, provider_key) do update set name = excluded.name
    returning id into v_league;

    insert into public.fixtures (league_id, provider, provider_event_id, home_team, away_team, commence_time, last_odds_at, status)
    values (v_league, p_provider, v_ev->>'event_id', v_ev->>'home_team', v_ev->>'away_team',
            (v_ev->>'commence_time')::timestamptz, v_at,
            case when (v_ev->>'commence_time')::timestamptz <= now() then 'live' else 'scheduled' end::public.fixture_status)
    on conflict (provider, provider_event_id) do update
      set commence_time = excluded.commence_time,
          home_team = excluded.home_team,
          away_team = excluded.away_team,
          last_odds_at = excluded.last_odds_at,
          status = case
            when fixtures.status in ('finished', 'cancelled') then fixtures.status
            when excluded.commence_time <= now() then 'live'::public.fixture_status
            else 'scheduled'::public.fixture_status end
    returning id into v_fixture;
    v_fixtures := v_fixtures + 1;

    -- Fixtures already decided are never re-priced.
    continue when (select status from public.fixtures where id = v_fixture) in ('finished', 'cancelled');

    v_seen_markets := array[]::uuid[];
    for v_mk in select * from jsonb_array_elements(coalesce(v_ev->'markets', '[]'::jsonb)) loop
      v_line := nullif(v_mk->>'line', '')::numeric;
      insert into public.betting_markets (fixture_id, market_key, period, line, line_key, status, source, bookmaker_count, last_odds_at)
      values (v_fixture, v_mk->>'market_key', coalesce(v_mk->>'period', 'ft'), v_line,
              coalesce(v_line::text, ''), 'open', p_provider, coalesce((v_mk->>'bookmaker_count')::int, 1), v_at)
      on conflict (fixture_id, market_key, period, line_key) do update
        set last_odds_at = excluded.last_odds_at,
            bookmaker_count = excluded.bookmaker_count,
            status = case when betting_markets.status in ('settled', 'void') then betting_markets.status else 'open' end
      returning id into v_market;
      v_seen_markets := v_seen_markets || v_market;
      v_markets := v_markets + 1;

      for v_oc in select * from jsonb_array_elements(coalesce(v_mk->'outcomes', '[]'::jsonb)) loop
        v_price := (v_oc->>'price')::numeric;
        continue when v_price is null or v_price <= 1;
        select source_odds into v_old_price
          from public.market_outcomes where market_id = v_market and outcome_key = v_oc->>'key';
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
        if v_old_price is distinct from v_price then
          insert into public.odds_snapshots (outcome_id, source_odds, offered_odds, provider)
          values (v_outcome, v_price, app.offered_odds(v_price, v_margin), p_provider);
        end if;
      end loop;
    end loop;

    -- Markets the provider no longer offers are suspended, never guessed.
    update public.betting_markets
       set status = 'suspended'
     where fixture_id = v_fixture and status = 'open' and not (id = any (v_seen_markets));
  end loop;

  return jsonb_build_object('fixtures', v_fixtures, 'markets', v_markets);
end $$;

-- p_scores: [{event_id, completed, home_score, away_score, last_update}]
create or replace function public.svc_update_scores(p_provider text, p_scores jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_s jsonb;
  v_fixture public.fixtures;
  v_settled int := 0;
  v_updated int := 0;
begin
  for v_s in select * from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb)) loop
    select * into v_fixture from public.fixtures
     where provider = p_provider and provider_event_id = v_s->>'event_id' for update;
    continue when not found or v_fixture.status in ('finished', 'cancelled');

    if coalesce((v_s->>'completed')::boolean, false)
       and v_s->>'home_score' is not null and v_s->>'away_score' is not null then
      update public.fixtures
         set status = 'finished', home_score = (v_s->>'home_score')::int, away_score = (v_s->>'away_score')::int,
             result_verified = true, completed_at = coalesce((v_s->>'last_update')::timestamptz, now()),
             last_scores_at = now()
       where id = v_fixture.id;
      update public.betting_markets set status = 'suspended' where fixture_id = v_fixture.id and status = 'open';
      v_settled := v_settled + (public.svc_settle_fixture(v_fixture.id) ->> 'bets_settled')::int;
    elsif v_s->>'home_score' is not null then
      update public.fixtures
         set status = 'live', home_score = (v_s->>'home_score')::int, away_score = (v_s->>'away_score')::int,
             last_scores_at = now()
       where id = v_fixture.id;
    end if;
    v_updated := v_updated + 1;
  end loop;
  return jsonb_build_object('updated', v_updated, 'bets_settled', v_settled);
end $$;

-- Suspend markets whose odds are stale (called by the sync job).
create or replace function public.svc_suspend_stale_markets() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  update public.betting_markets m
     set status = 'suspended'
    from public.fixtures f
   where f.id = m.fixture_id and m.status = 'open'
     and (
       (f.status = 'scheduled' and m.last_odds_at < now() - make_interval(secs => app.setting_int('sportsbook.prematch_odds_max_age_seconds', 7200)))
       or (f.status = 'live' and m.last_odds_at < now() - make_interval(secs => app.setting_int('sportsbook.live_odds_max_age_seconds', 30)))
       or f.status in ('finished', 'cancelled', 'postponed')
     );
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- -----------------------------------------------------------------------------
-- Grading
-- -----------------------------------------------------------------------------
-- Grade a "line" bet given the margin by which it beat the line (0 = push).
-- Quarter lines (x.25 / x.75) are split into two half-stakes.
create or replace function app.grade_line(p_diff numeric) returns public.selection_result
language plpgsql immutable as $$
declare
  a public.selection_result;
  b public.selection_result;
begin
  if (p_diff * 4) % 2 <> 0 then
    a := app.grade_line(p_diff - 0.25);
    b := app.grade_line(p_diff + 0.25);
    if a = b then return a; end if;
    if 'won' in (a, b) and 'void' in (a, b) then return 'half_won'; end if;
    if 'lost' in (a, b) and 'void' in (a, b) then return 'half_lost'; end if;
    return 'void';
  end if;
  return case when p_diff > 0 then 'won' when p_diff < 0 then 'lost' else 'void' end;
end $$;

create or replace function app.grade_outcome(
  p_market_key text, p_has_draw boolean, p_outcome_key text, p_point numeric, p_home int, p_away int
) returns public.selection_result
language plpgsql immutable as $$
declare
  v_total int := p_home + p_away;
begin
  case p_market_key
    when 'h2h', 'h2h_3way' then
      if p_home = p_away and not p_has_draw then return 'void'; end if;
      return case
        when p_outcome_key = 'home' and p_home > p_away then 'won'
        when p_outcome_key = 'away' and p_away > p_home then 'won'
        when p_outcome_key = 'draw' and p_home = p_away then 'won'
        else 'lost' end;
    when 'draw_no_bet' then
      if p_home = p_away then return 'void'; end if;
      return case when (p_outcome_key = 'home') = (p_home > p_away) then 'won' else 'lost' end;
    when 'double_chance' then
      return case
        when p_outcome_key = '1X' and p_home >= p_away then 'won'
        when p_outcome_key = 'X2' and p_away >= p_home then 'won'
        when p_outcome_key = '12' and p_home <> p_away then 'won'
        else 'lost' end;
    when 'totals' then
      if p_outcome_key = 'over' then return app.grade_line(v_total - p_point); end if;
      if p_outcome_key = 'under' then return app.grade_line(p_point - v_total); end if;
      return null;
    when 'spreads' then
      if p_outcome_key = 'home' then return app.grade_line(p_home + p_point - p_away); end if;
      if p_outcome_key = 'away' then return app.grade_line(p_away + p_point - p_home); end if;
      return null;
    when 'btts' then
      return case when (p_outcome_key = 'yes') = (p_home > 0 and p_away > 0) then 'won' else 'lost' end;
    when 'correct_score' then
      return case when p_outcome_key = format('score:%s-%s', p_home, p_away) then 'won' else 'lost' end;
    else
      return null;  -- not auto-gradable (e.g. period markets need period scores)
  end case;
end $$;

create or replace function app.result_factor(p_result public.selection_result, p_odds numeric) returns numeric
language sql immutable as $$
  select case p_result
    when 'won' then p_odds
    when 'lost' then 0
    when 'void' then 1
    when 'half_won' then (1 + p_odds) / 2
    when 'half_lost' then 0.5
  end
$$;

-- Settle one bet if all its selections are graded. Idempotent.
create or replace function app.try_settle_bet(p_bet uuid, p_settled_by text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_bet public.bets;
  v_factor numeric := 1;
  v_sel record;
  v_all_void boolean := true;
  v_payout bigint;
  v_status public.bet_status;
  v_tx uuid;
begin
  select * into v_bet from public.bets where id = p_bet for update;
  if not found or v_bet.status <> 'open' then
    return false;
  end if;

  -- Copy outcome results onto the selections.
  update public.bet_selections s set result = o.result
    from public.market_outcomes o
   where s.bet_id = p_bet and o.id = s.outcome_id and s.result = 'pending' and o.result <> 'pending';

  if exists (select 1 from public.bet_selections where bet_id = p_bet and result = 'pending') then
    return false;
  end if;

  for v_sel in select result, odds from public.bet_selections where bet_id = p_bet loop
    v_factor := v_factor * app.result_factor(v_sel.result, v_sel.odds);
    if v_sel.result <> 'void' then v_all_void := false; end if;
  end loop;

  v_payout := floor(v_bet.stake * v_factor)::bigint;
  v_status := case
    when v_all_void then 'void'
    when v_payout = 0 then 'lost'
    when v_payout >= v_bet.stake then 'won'
    else 'lost' end;

  if v_payout > 0 then
    v_tx := app.move_credits(
      case when v_status = 'void' then 'bet_refund' else 'bet_payout' end::public.ledger_tx_type,
      null, 'bet-settle:' || p_bet,
      app.system_account('SYS_HOUSE_SPORTSBOOK'), app.wallet_account(v_bet.user_id), v_payout,
      'bet:' || p_bet, null, v_bet.tenant_id);
  end if;

  update public.bets set status = v_status, payout = v_payout, payout_tx_id = v_tx, settled_at = now()
   where id = p_bet;
  insert into public.bet_settlements (bet_id, result, factor, payout, tx_id, settled_by)
  values (p_bet, v_status, v_factor, v_payout, v_tx, p_settled_by);
  return true;
end $$;

create or replace function app.settle_bets_for_market(p_market uuid, p_by text) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_bet uuid;
  v_n int := 0;
begin
  for v_bet in
    select distinct s.bet_id from public.bet_selections s
    join public.bets b on b.id = s.bet_id
    where s.market_id = p_market and b.status = 'open'
  loop
    if app.try_settle_bet(v_bet, p_by) then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- Grade every auto-gradable market of a finished, verified fixture.
create or replace function public.svc_settle_fixture(p_fixture uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_f public.fixtures;
  v_m record;
  v_graded int := 0;
  v_bets int := 0;
  v_has_draw boolean;
begin
  select * into v_f from public.fixtures where id = p_fixture;
  if not found or v_f.status <> 'finished' or not v_f.result_verified
     or v_f.home_score is null or v_f.away_score is null then
    return jsonb_build_object('markets_graded', 0, 'bets_settled', 0);
  end if;

  for v_m in select * from public.betting_markets where fixture_id = p_fixture and status in ('open', 'suspended') loop
    continue when v_m.period <> 'ft';
    v_has_draw := exists (select 1 from public.market_outcomes where market_id = v_m.id and outcome_key = 'draw');
    -- Only grade when every outcome is gradable.
    continue when exists (
      select 1 from public.market_outcomes o
      where o.market_id = v_m.id
        and app.grade_outcome(v_m.market_key, v_has_draw, o.outcome_key, o.point, v_f.home_score, v_f.away_score) is null
    );
    update public.market_outcomes o
       set result = app.grade_outcome(v_m.market_key, v_has_draw, o.outcome_key, o.point, v_f.home_score, v_f.away_score),
           status = 'settled'
     where o.market_id = v_m.id;
    update public.betting_markets set status = 'settled', settled_at = now() where id = v_m.id;
    v_graded := v_graded + 1;
    v_bets := v_bets + app.settle_bets_for_market(v_m.id, 'auto:' || v_f.provider);
  end loop;
  return jsonb_build_object('markets_graded', v_graded, 'bets_settled', v_bets);
end $$;

-- -----------------------------------------------------------------------------
-- Main Admin market operations (audited)
-- -----------------------------------------------------------------------------
create or replace function public.admin_settle_market(p_market_id uuid, p_results jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['super_admin']::public.app_role[]);
  v_m public.betting_markets;
  v_n int;
begin
  select * into v_m from public.betting_markets where id = p_market_id for update;
  if not found then perform app.fail('MARKET_NOT_FOUND'); end if;
  if v_m.status in ('settled', 'void') then perform app.fail('MARKET_ALREADY_SETTLED'); end if;
  if exists (select 1 from public.market_outcomes o where o.market_id = p_market_id
              and (p_results ->> o.outcome_key) is null) then
    perform app.fail('RESULTS_INCOMPLETE');
  end if;
  update public.market_outcomes o
     set result = (p_results ->> o.outcome_key)::public.selection_result, status = 'settled'
   where o.market_id = p_market_id;
  update public.betting_markets set status = 'settled', settled_at = now(), settled_by = v_me.id where id = p_market_id;
  v_n := app.settle_bets_for_market(p_market_id, 'manual:' || v_me.id);
  perform app.audit('sportsbook.settle_market', 'market', p_market_id::text, 'platform', null,
                    jsonb_build_object('results', p_results, 'bets_settled', v_n));
  return jsonb_build_object('bets_settled', v_n);
end $$;

create or replace function public.admin_void_market(p_market_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['super_admin']::public.app_role[]);
  v_m public.betting_markets;
  v_n int;
begin
  select * into v_m from public.betting_markets where id = p_market_id for update;
  if not found then perform app.fail('MARKET_NOT_FOUND'); end if;
  if v_m.status in ('settled', 'void') then perform app.fail('MARKET_ALREADY_SETTLED'); end if;
  update public.market_outcomes set result = 'void', status = 'void' where market_id = p_market_id;
  update public.betting_markets set status = 'void', settled_at = now(), settled_by = v_me.id where id = p_market_id;
  v_n := app.settle_bets_for_market(p_market_id, 'void:' || v_me.id);
  perform app.audit('sportsbook.void_market', 'market', p_market_id::text, 'platform', null,
                    jsonb_build_object('reason', p_reason, 'bets_settled', v_n));
  return jsonb_build_object('bets_settled', v_n);
end $$;

create or replace function public.admin_set_market_status(p_market_id uuid, p_status public.market_status) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['super_admin']::public.app_role[]);
begin
  if p_status not in ('open', 'suspended') then perform app.fail('INVALID_STATUS'); end if;
  update public.betting_markets set status = p_status
   where id = p_market_id and status in ('open', 'suspended');
  if not found then perform app.fail('MARKET_NOT_FOUND'); end if;
  perform app.audit('sportsbook.market_status', 'market', p_market_id::text, 'platform', null,
                    jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true);
end $$;

-- Cancel a fixture: every market void, every bet leg void.
create or replace function public.admin_cancel_fixture(p_fixture_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['super_admin']::public.app_role[]);
  v_m uuid;
  v_n int := 0;
begin
  update public.fixtures set status = 'cancelled' where id = p_fixture_id and status <> 'finished';
  if not found then perform app.fail('FIXTURE_NOT_FOUND'); end if;
  for v_m in select id from public.betting_markets where fixture_id = p_fixture_id and status in ('open', 'suspended') loop
    update public.market_outcomes set result = 'void', status = 'void' where market_id = v_m;
    update public.betting_markets set status = 'void', settled_at = now(), settled_by = v_me.id where id = v_m;
    v_n := v_n + app.settle_bets_for_market(v_m, 'cancel:' || v_me.id);
  end loop;
  perform app.audit('sportsbook.cancel_fixture', 'fixture', p_fixture_id::text, 'platform', null,
                    jsonb_build_object('reason', p_reason, 'bets_settled', v_n));
  return jsonb_build_object('bets_settled', v_n);
end $$;

-- -----------------------------------------------------------------------------
-- Bet placement
-- p_slip: {"mode": "singles"|"accumulator", "stake": units (per bet),
--          "selections": [{"outcome_id": uuid, "odds": "2.10"}]}
-- -----------------------------------------------------------------------------
create or replace function public.place_bets(p_slip jsonb, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_mode text := p_slip ->> 'mode';
  v_stake bigint := (p_slip ->> 'stake')::bigint;
  v_sels jsonb := coalesce(p_slip -> 'selections', '[]'::jsonb);
  v_n int := jsonb_array_length(coalesce(p_slip -> 'selections', '[]'::jsonb));
  v_existing public.bet_slips;
  v_slip uuid;
  v_bet uuid;
  v_total bigint;
  v_tx uuid;
  v_sel jsonb;
  v_row record;
  v_odds numeric;
  v_total_odds numeric := 1;
  v_potential bigint;
  v_max_payout bigint := app.setting_int('sportsbook.max_payout_units', 100000000);
  v_prematch_age int := app.setting_int('sportsbook.prematch_odds_max_age_seconds', 7200)::int;
  v_live_age int := app.setting_int('sportsbook.live_odds_max_age_seconds', 30)::int;
  v_live_enabled boolean := app.setting_bool('sportsbook.live_betting_enabled', true);
  v_is_live boolean;
  v_validated jsonb := '[]'::jsonb;
  v_bets jsonb := '[]'::jsonb;
begin
  perform app.validate_idempotency_key(p_idempotency_key);
  select * into v_existing from public.bet_slips where user_id = v_me.id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('slip_id', v_existing.id, 'replayed', true,
      'bets', (select jsonb_agg(id) from public.bets where slip_id = v_existing.id),
      'balance', public.my_balance());
  end if;

  if app.setting_bool('platform.maintenance_mode', false) then perform app.fail('MAINTENANCE'); end if;
  if v_mode not in ('singles', 'accumulator') then perform app.fail('INVALID_MODE'); end if;
  if v_stake is null or v_stake < app.setting_int('sportsbook.min_bet_units', 10) then perform app.fail('STAKE_TOO_LOW'); end if;
  if v_stake > app.setting_int('sportsbook.max_bet_units', 1000000) then perform app.fail('STAKE_TOO_HIGH'); end if;
  if v_n = 0 then perform app.fail('NO_SELECTIONS'); end if;
  if v_mode = 'accumulator' and v_n < 2 then perform app.fail('ACCUMULATOR_NEEDS_TWO'); end if;
  if v_n > app.setting_int('sportsbook.max_selections', 20) then perform app.fail('TOO_MANY_SELECTIONS'); end if;
  if (select count(distinct x->>'outcome_id') from jsonb_array_elements(v_sels) x) <> v_n then
    perform app.fail('DUPLICATE_SELECTION');
  end if;

  perform app.enforce_rate_limit('bet:' || v_me.id, 20, 10);

  -- Validate every selection against current, fresh, open prices.
  for v_sel in select * from jsonb_array_elements(v_sels) loop
    select o.id as outcome_id, o.offered_odds, o.source_odds, o.point, o.status as o_status, o.label,
           m.id as market_id, m.market_key, m.status as m_status, m.last_odds_at,
           f.id as fixture_id, f.status as f_status, f.commence_time, f.home_team, f.away_team
      into v_row
      from public.market_outcomes o
      join public.betting_markets m on m.id = o.market_id
      join public.fixtures f on f.id = m.fixture_id
     where o.id = (v_sel ->> 'outcome_id')::uuid
     for share of o;
    if not found then perform app.fail('SELECTION_NOT_FOUND'); end if;
    if v_row.o_status <> 'open' or v_row.m_status <> 'open' then perform app.fail('MARKET_SUSPENDED'); end if;

    v_is_live := v_row.commence_time <= now();
    if v_row.f_status in ('finished', 'cancelled', 'postponed') then perform app.fail('MARKET_SUSPENDED'); end if;
    if v_is_live then
      if not v_live_enabled then perform app.fail('LIVE_BETTING_DISABLED'); end if;
      if v_row.last_odds_at is null or v_row.last_odds_at < now() - make_interval(secs => v_live_age) then
        perform app.fail('ODDS_STALE');
      end if;
    elsif v_row.last_odds_at is null or v_row.last_odds_at < now() - make_interval(secs => v_prematch_age) then
      perform app.fail('ODDS_STALE');
    end if;

    v_odds := (v_sel ->> 'odds')::numeric;
    if v_odds is null or v_odds <> v_row.offered_odds then
      perform app.fail('ODDS_CHANGED', format('%s:%s', v_row.outcome_id, v_row.offered_odds));
    end if;

    if v_mode = 'accumulator' and exists (
      select 1 from jsonb_array_elements(v_validated) x where (x ->> 'fixture_id')::uuid = v_row.fixture_id) then
      perform app.fail('SAME_EVENT_IN_ACCUMULATOR');
    end if;

    v_validated := v_validated || jsonb_build_object(
      'outcome_id', v_row.outcome_id, 'market_id', v_row.market_id, 'fixture_id', v_row.fixture_id,
      'odds', v_row.offered_odds, 'source_odds', v_row.source_odds, 'point', v_row.point,
      'live', v_is_live, 'event_name', v_row.home_team || ' – ' || v_row.away_team,
      'market_key', v_row.market_key, 'label', v_row.label, 'commence_time', v_row.commence_time);
    v_total_odds := v_total_odds * v_row.offered_odds;
    if v_mode = 'singles' and floor(v_stake * v_row.offered_odds) > v_max_payout then
      perform app.fail('PAYOUT_LIMIT');
    end if;
  end loop;

  if v_mode = 'accumulator' and floor(v_stake * v_total_odds) > v_max_payout then
    perform app.fail('PAYOUT_LIMIT');
  end if;

  v_total := case when v_mode = 'singles' then v_stake * v_n else v_stake end;
  perform app.assert_can_wager(v_me.id, v_total);

  insert into public.bet_slips (user_id, tenant_id, slip_type, total_stake, idempotency_key)
  values (v_me.id, v_me.tenant_id, v_mode, v_total, p_idempotency_key)
  returning id into v_slip;

  v_tx := app.move_credits('bet_stake', v_me.id, 'slip:' || p_idempotency_key,
    app.wallet_account(v_me.id), app.system_account('SYS_HOUSE_SPORTSBOOK'), v_total,
    'slip:' || v_slip, null, v_me.tenant_id);
  update public.bet_slips set stake_tx_id = v_tx where id = v_slip;

  if v_mode = 'accumulator' then
    v_potential := floor(v_stake * v_total_odds)::bigint;
    insert into public.bets (slip_id, user_id, tenant_id, bet_type, stake, total_odds, potential_payout)
    values (v_slip, v_me.id, v_me.tenant_id, 'accumulator', v_stake, round(v_total_odds, 4), v_potential)
    returning id into v_bet;
    v_bets := v_bets || to_jsonb(v_bet);
    insert into public.bet_selections (bet_id, outcome_id, market_id, fixture_id, odds, source_odds, point, was_live,
                                       event_name, market_key, outcome_label, commence_time)
    select v_bet, (x->>'outcome_id')::uuid, (x->>'market_id')::uuid, (x->>'fixture_id')::uuid,
           (x->>'odds')::numeric, (x->>'source_odds')::numeric, nullif(x->>'point', '')::numeric, (x->>'live')::boolean,
           x->>'event_name', x->>'market_key', x->>'label', (x->>'commence_time')::timestamptz
      from jsonb_array_elements(v_validated) x;
  else
    for v_sel in select * from jsonb_array_elements(v_validated) loop
      insert into public.bets (slip_id, user_id, tenant_id, bet_type, stake, total_odds, potential_payout)
      values (v_slip, v_me.id, v_me.tenant_id, 'single', v_stake, (v_sel->>'odds')::numeric,
              floor(v_stake * (v_sel->>'odds')::numeric)::bigint)
      returning id into v_bet;
      v_bets := v_bets || to_jsonb(v_bet);
      insert into public.bet_selections (bet_id, outcome_id, market_id, fixture_id, odds, source_odds, point, was_live,
                                         event_name, market_key, outcome_label, commence_time)
      values (v_bet, (v_sel->>'outcome_id')::uuid, (v_sel->>'market_id')::uuid, (v_sel->>'fixture_id')::uuid,
              (v_sel->>'odds')::numeric, (v_sel->>'source_odds')::numeric, nullif(v_sel->>'point', '')::numeric,
              (v_sel->>'live')::boolean, v_sel->>'event_name', v_sel->>'market_key', v_sel->>'label',
              (v_sel->>'commence_time')::timestamptz);
    end loop;
  end if;

  return jsonb_build_object('slip_id', v_slip, 'replayed', false, 'bets', v_bets, 'balance', public.my_balance());
end $$;

-- Re-define the admin player list now that bets exist.
create or replace function public.list_my_players()
returns table (
  id uuid, username text, display_name text, status public.account_status,
  balance bigint, created_at timestamptz, last_login_at timestamptz,
  open_bets bigint, self_excluded_until timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['admin']::public.app_role[]);
begin
  return query
  select p.id, p.username, p.display_name, p.status, a.balance, p.created_at, u.last_sign_in_at,
         (select count(*) from public.bets b where b.user_id = p.id and b.status = 'open'),
         l.self_excluded_until
  from public.profiles p
  join public.wallets w on w.user_id = p.id
  join public.ledger_accounts a on a.id = w.account_id
  left join auth.users u on u.id = p.id
  left join public.player_limits l on l.user_id = p.id
  where p.role = 'player' and p.tenant_id = v_me.tenant_id
  order by p.created_at desc;
end $$;

-- -----------------------------------------------------------------------------
-- Integration management (Main Admin)
-- -----------------------------------------------------------------------------
create or replace function public.admin_update_integration(p_id text, p_enabled boolean, p_config jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['super_admin']::public.app_role[]);
begin
  -- Secrets are never accepted here.
  if p_config ?| array['api_key', 'apiKey', 'key', 'secret', 'token'] then
    perform app.fail('SECRETS_NOT_ALLOWED', 'store API keys as Edge Function secrets');
  end if;
  update public.api_integrations
     set enabled = coalesce(p_enabled, enabled),
         config = coalesce(p_config, config),
         status = case when coalesce(p_enabled, enabled) then status else 'disabled' end,
         updated_at = now()
   where id = p_id;
  if not found then perform app.fail('INTEGRATION_NOT_FOUND'); end if;
  perform app.audit('integration.update', 'integration', p_id, 'platform', null,
                    jsonb_build_object('enabled', p_enabled, 'config', p_config));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.svc_record_sync(
  p_integration text, p_job text, p_status text, p_items int, p_requests_remaining int,
  p_requests_used int, p_error text, p_details jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.provider_sync_logs (integration_id, job, status, items, requests_remaining, error, details, finished_at)
  values (p_integration, p_job, p_status, coalesce(p_items, 0), p_requests_remaining, p_error, coalesce(p_details, '{}'::jsonb), now());
  update public.api_integrations
     set key_configured = true,
         status = case when p_status = 'ok' then 'ok' when p_status = 'error' then 'error' else status end,
         requests_remaining = coalesce(p_requests_remaining, requests_remaining),
         requests_used = coalesce(p_requests_used, requests_used),
         last_success_at = case when p_status = 'ok' then now() else last_success_at end,
         last_error = case when p_status = 'error' then p_error else last_error end,
         last_error_at = case when p_status = 'error' then now() else last_error_at end,
         updated_at = now()
   where id = p_integration;
end $$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.api_integrations   enable row level security;
alter table public.provider_sync_logs enable row level security;
alter table public.sports             enable row level security;
alter table public.leagues            enable row level security;
alter table public.fixtures           enable row level security;
alter table public.betting_markets    enable row level security;
alter table public.market_outcomes    enable row level security;
alter table public.odds_snapshots     enable row level security;
alter table public.bet_slips          enable row level security;
alter table public.bets               enable row level security;
alter table public.bet_selections     enable row level security;
alter table public.bet_settlements    enable row level security;

revoke all on public.api_integrations, public.provider_sync_logs, public.sports, public.leagues,
  public.fixtures, public.betting_markets, public.market_outcomes, public.odds_snapshots,
  public.bet_slips, public.bets, public.bet_selections, public.bet_settlements from anon;
revoke insert, update, delete, truncate on public.api_integrations, public.provider_sync_logs,
  public.sports, public.leagues, public.fixtures, public.betting_markets, public.market_outcomes,
  public.odds_snapshots, public.bet_slips, public.bets, public.bet_selections, public.bet_settlements
from authenticated;

create policy integrations_read on public.api_integrations for select to authenticated using ((select app.is_super_admin()));
create policy sync_logs_read on public.provider_sync_logs for select to authenticated using ((select app.is_super_admin()));
create policy sports_read on public.sports for select to authenticated using (true);
create policy leagues_read on public.leagues for select to authenticated using (true);
create policy fixtures_read on public.fixtures for select to authenticated using (true);
create policy markets_read on public.betting_markets for select to authenticated using (true);
create policy outcomes_read on public.market_outcomes for select to authenticated using (true);
create policy snapshots_read on public.odds_snapshots for select to authenticated using (true);

create policy slips_read on public.bet_slips for select to authenticated using (
  user_id = (select auth.uid()) or ((select app.is_admin()) and tenant_id = (select app.current_tenant())));
create policy bets_read on public.bets for select to authenticated using (
  user_id = (select auth.uid()) or ((select app.is_admin()) and tenant_id = (select app.current_tenant())));
create policy selections_read on public.bet_selections for select to authenticated using (
  exists (select 1 from public.bets b where b.id = bet_id));
create policy settlements_read on public.bet_settlements for select to authenticated using (
  exists (select 1 from public.bets b where b.id = bet_id));

alter publication supabase_realtime add table public.bets, public.market_outcomes, public.fixtures;
