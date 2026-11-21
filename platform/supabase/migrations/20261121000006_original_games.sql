-- =============================================================================
-- KOMETA — original demo games. Every outcome is computed here, server-side,
-- from the provably-fair float stream of the round (app.rf). See docs/GAMES.md
-- for the mathematics of each game.
-- =============================================================================

-- Helper: edge as a fraction.
create or replace function app.edge(p_round public.game_rounds) returns numeric
language sql immutable as $$ select p_round.edge_bps / 10000.0 $$;

create or replace function app.trunc4(p numeric) returns numeric
language sql immutable as $$ select floor(p * 10000) / 10000 $$;

-- -----------------------------------------------------------------------------
-- DICE: roll = floor(f * 10000) / 100 ∈ [0.00, 99.99]
--   under T wins when roll < T   (P = T / 100)
--   over  T wins when roll > T   (P = (99.99 - T) / 100)
--   multiplier = (1 - edge) / P
-- -----------------------------------------------------------------------------
create or replace function public.play_dice(p_stake bigint, p_target numeric, p_direction text, p_idempotency_key text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds;
  v_target numeric := round(p_target, 2);
  v_p numeric;
  v_roll numeric;
  v_win boolean;
  v_mult numeric;
begin
  if p_direction not in ('under', 'over') then perform app.fail('INVALID_PARAMS'); end if;
  v_p := case when p_direction = 'under' then v_target / 100 else (99.99 - v_target) / 100 end;
  if v_target is null or v_p < 0.01 or v_p > 0.98 then perform app.fail('INVALID_PARAMS', 'win chance must be 1%–98%'); end if;

  v_round := app.begin_round(v_me, 'dice', p_stake, jsonb_build_object('target', v_target, 'direction', p_direction), p_idempotency_key);
  if v_round.status <> 'active' then return app.round_view(v_round); end if;

  v_roll := floor(app.rf(v_round, 0) * 10000) / 100;
  v_win := case when p_direction = 'under' then v_roll < v_target else v_roll > v_target end;
  v_mult := app.trunc4((1 - app.edge(v_round)) / v_p);
  v_round := app.finish_round(v_round.id, case when v_win then v_mult else 0 end,
    jsonb_build_object('roll', v_roll, 'win', v_win, 'payout_multiplier', v_mult, 'win_chance', v_p * 100),
    jsonb_build_object('roll', v_roll));
  return app.round_view(v_round);
end $$;

-- -----------------------------------------------------------------------------
-- LIMBO: result = max(1, floor((1 - edge) / (1 - f) * 100) / 100)
--   P(result >= T) = (1 - edge) / T  →  RTP = 1 - edge
-- -----------------------------------------------------------------------------
create or replace function app.limbo_point(p_float double precision, p_edge numeric, p_cap numeric) returns numeric
language sql immutable as $$
  select least(p_cap, greatest(1.00, floor((1 - p_edge) / (1 - p_float::numeric) * 100) / 100))
$$;

create or replace function public.play_limbo(p_stake bigint, p_target numeric, p_idempotency_key text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds;
  v_target numeric := round(p_target, 2);
  v_result numeric;
begin
  if v_target is null or v_target < 1.01 or v_target > 1000000 then perform app.fail('INVALID_PARAMS'); end if;
  v_round := app.begin_round(v_me, 'limbo', p_stake, jsonb_build_object('target', v_target), p_idempotency_key);
  if v_round.status <> 'active' then return app.round_view(v_round); end if;
  v_result := app.limbo_point(app.rf(v_round, 0), app.edge(v_round), 1000000);
  v_round := app.finish_round(v_round.id, case when v_result >= v_target then v_target else 0 end,
    jsonb_build_object('result', v_result, 'win', v_result >= v_target, 'win_chance', round((1 - app.edge(v_round)) / v_target * 100, 6)),
    jsonb_build_object('result', v_result));
  return app.round_view(v_round);
end $$;

-- -----------------------------------------------------------------------------
-- COIN FLIP: heads when f < 0.5. Multiplier = 2 * (1 - edge).
-- -----------------------------------------------------------------------------
create or replace function public.play_coinflip(p_stake bigint, p_side text, p_idempotency_key text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds;
  v_side text;
  v_mult numeric;
begin
  if p_side not in ('heads', 'tails') then perform app.fail('INVALID_PARAMS'); end if;
  v_round := app.begin_round(v_me, 'coinflip', p_stake, jsonb_build_object('side', p_side), p_idempotency_key);
  if v_round.status <> 'active' then return app.round_view(v_round); end if;
  v_side := case when app.rf(v_round, 0) < 0.5 then 'heads' else 'tails' end;
  v_mult := app.trunc4(2 * (1 - app.edge(v_round)));
  v_round := app.finish_round(v_round.id, case when v_side = p_side then v_mult else 0 end,
    jsonb_build_object('result', v_side, 'win', v_side = p_side, 'payout_multiplier', v_mult),
    jsonb_build_object('result', v_side));
  return app.round_view(v_round);
end $$;

-- -----------------------------------------------------------------------------
-- ROULETTE (European, single zero). Fixed edge 1/37 ≈ 2.70% from the rules.
-- p_bets: [{"type": "straight|red|black|odd|even|low|high|dozen|column", "value": n, "amount": units}]
-- -----------------------------------------------------------------------------
create or replace function app.roulette_pays(p_type text, p_value int, p_n int) returns int
language plpgsql immutable as $$
declare
  v_red int[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
begin
  return case p_type
    when 'straight' then case when p_n = p_value then 36 else 0 end
    when 'red'   then case when p_n = any (v_red) then 2 else 0 end
    when 'black' then case when p_n > 0 and not (p_n = any (v_red)) then 2 else 0 end
    when 'odd'   then case when p_n > 0 and p_n % 2 = 1 then 2 else 0 end
    when 'even'  then case when p_n > 0 and p_n % 2 = 0 then 2 else 0 end
    when 'low'   then case when p_n between 1 and 18 then 2 else 0 end
    when 'high'  then case when p_n between 19 and 36 then 2 else 0 end
    when 'dozen' then case when p_n > 0 and (p_n - 1) / 12 + 1 = p_value then 3 else 0 end
    when 'column' then case when p_n > 0 and (p_n - 1) % 3 + 1 = p_value then 3 else 0 end
    else null end;
end $$;

create or replace function public.play_roulette(p_bets jsonb, p_idempotency_key text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds;
  v_bet jsonb;
  v_total bigint := 0;
  v_amount bigint;
  v_n int;
  v_return bigint := 0;
  v_pays int;
  v_wins jsonb := '[]'::jsonb;
begin
  if p_bets is null or jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) = 0 or jsonb_array_length(p_bets) > 50 then
    perform app.fail('INVALID_PARAMS');
  end if;
  for v_bet in select * from jsonb_array_elements(p_bets) loop
    v_amount := (v_bet->>'amount')::bigint;
    if v_amount is null or v_amount <= 0 then perform app.fail('INVALID_PARAMS'); end if;
    if app.roulette_pays(v_bet->>'type', coalesce((v_bet->>'value')::int, 0), 0) is null then perform app.fail('INVALID_PARAMS'); end if;
    if v_bet->>'type' = 'straight' and coalesce((v_bet->>'value')::int, -1) not between 0 and 36 then perform app.fail('INVALID_PARAMS'); end if;
    if v_bet->>'type' in ('dozen', 'column') and coalesce((v_bet->>'value')::int, -1) not between 1 and 3 then perform app.fail('INVALID_PARAMS'); end if;
    v_total := v_total + v_amount;
  end loop;

  v_round := app.begin_round(v_me, 'roulette', v_total, jsonb_build_object('bets', p_bets), p_idempotency_key);
  if v_round.status <> 'active' then return app.round_view(v_round); end if;
  v_n := floor(app.rf(v_round, 0) * 37)::int;
  for v_bet in select * from jsonb_array_elements(p_bets) loop
    v_pays := app.roulette_pays(v_bet->>'type', coalesce((v_bet->>'value')::int, 0), v_n);
    if v_pays > 0 then
      v_return := v_return + (v_bet->>'amount')::bigint * v_pays;
      v_wins := v_wins || v_bet;
    end if;
  end loop;
  v_round := app.finish_round(v_round.id, v_return::numeric / v_total,
    jsonb_build_object('number', v_n, 'winning_bets', v_wins, 'returned', v_return),
    jsonb_build_object('number', v_n));
  return app.round_view(v_round);
end $$;

-- -----------------------------------------------------------------------------
-- PLINKO: each row the ball goes right when f_i >= 0.5; bucket = number of rights.
-- Base table b^|k - n/2| (config), scaled so the exact expected return equals
-- (1 - edge): scale = (1 - edge) / Σ C(n,k)/2^n · base_k.
-- -----------------------------------------------------------------------------
create or replace function app.plinko_table(p_rows int, p_risk text, p_edge numeric) returns numeric[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_b numeric := ((select config from public.game_configurations where game_id = 'plinko') -> 'base' -> p_risk ->> p_rows::text)::numeric;
  v_base numeric[] := '{}';
  v_ev numeric := 0;
  v_out numeric[] := '{}';
  k int;
begin
  if v_b is null then perform app.fail('INVALID_PARAMS'); end if;
  for k in 0..p_rows loop
    v_base := v_base || power(v_b, abs(k - p_rows / 2.0));
    v_ev := v_ev + app.choose(p_rows, k) / power(2::numeric, p_rows) * v_base[k + 1];
  end loop;
  for k in 0..p_rows loop
    v_out := v_out || app.trunc4(v_base[k + 1] * (1 - p_edge) / v_ev);
  end loop;
  return v_out;
end $$;

create or replace function public.plinko_table(p_rows int, p_risk text) returns numeric[]
language sql stable security definer set search_path = public as $$
  select app.plinko_table(p_rows, p_risk, app.game_edge_bps('plinko') / 10000.0)
$$;

create or replace function public.play_plinko(p_stake bigint, p_rows int, p_risk text, p_idempotency_key text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds;
  v_path int[] := '{}';
  v_bucket int := 0;
  v_table numeric[];
  i int;
begin
  if p_rows not in (8, 12, 16) or p_risk not in ('low', 'medium', 'high') then perform app.fail('INVALID_PARAMS'); end if;
  v_round := app.begin_round(v_me, 'plinko', p_stake, jsonb_build_object('rows', p_rows, 'risk', p_risk), p_idempotency_key);
  if v_round.status <> 'active' then return app.round_view(v_round); end if;
  v_table := app.plinko_table(p_rows, p_risk, app.edge(v_round));
  for i in 0..p_rows - 1 loop
    if app.rf(v_round, i) >= 0.5 then
      v_path := v_path || 1; v_bucket := v_bucket + 1;
    else
      v_path := v_path || 0;
    end if;
  end loop;
  v_round := app.finish_round(v_round.id, v_table[v_bucket + 1],
    jsonb_build_object('path', to_jsonb(v_path), 'bucket', v_bucket, 'table', to_jsonb(v_table)),
    jsonb_build_object('bucket', v_bucket));
  return app.round_view(v_round);
end $$;

-- -----------------------------------------------------------------------------
-- KENO: 40 numbers, 10 drawn (Fisher–Yates on floats 0..9), 1–10 picks.
-- Base paytable per pick count (config), scaled to (1 - edge) with exact
-- hypergeometric probabilities P(h) = C(10,h)·C(30,p-h)/C(40,p).
-- -----------------------------------------------------------------------------
create or replace function app.keno_table(p_picks int, p_edge numeric) returns numeric[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_base jsonb := (select config from public.game_configurations where game_id = 'keno') -> 'base' -> p_picks::text;
  v_ev numeric := 0;
  v_out numeric[] := '{}';
  h int;
begin
  if v_base is null then perform app.fail('INVALID_PARAMS'); end if;
  for h in 0..p_picks loop
    v_ev := v_ev + app.choose(10, h) * app.choose(30, p_picks - h) / app.choose(40, p_picks) * (v_base ->> h)::numeric;
  end loop;
  for h in 0..p_picks loop
    v_out := v_out || app.trunc4((v_base ->> h)::numeric * (1 - p_edge) / v_ev);
  end loop;
  return v_out;
end $$;

create or replace function public.keno_table(p_picks int) returns numeric[]
language sql stable security definer set search_path = public as $$
  select app.keno_table(p_picks, app.game_edge_bps('keno') / 10000.0)
$$;

create or replace function public.play_keno(p_stake bigint, p_picks int[], p_idempotency_key text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds;
  v_picks int[] := array(select distinct x from unnest(p_picks) x order by x);
  v_drawn int[];
  v_hits int;
  v_table numeric[];
begin
  if v_picks is null or cardinality(v_picks) <> cardinality(p_picks) or cardinality(v_picks) not between 1 and 10
     or exists (select 1 from unnest(v_picks) x where x not between 1 and 40) then
    perform app.fail('INVALID_PARAMS');
  end if;
  v_round := app.begin_round(v_me, 'keno', p_stake, jsonb_build_object('picks', to_jsonb(v_picks)), p_idempotency_key);
  if v_round.status <> 'active' then return app.round_view(v_round); end if;
  v_drawn := array(select x + 1 from unnest(app.pf_shuffle(v_round, 40, 10, 0)) x);
  select count(*) into v_hits from unnest(v_picks) x where x = any (v_drawn);
  v_table := app.keno_table(cardinality(v_picks), app.edge(v_round));
  v_round := app.finish_round(v_round.id, v_table[v_hits + 1],
    jsonb_build_object('drawn', to_jsonb(v_drawn), 'hits', v_hits, 'table', to_jsonb(v_table)),
    jsonb_build_object('drawn', to_jsonb(v_drawn), 'hits', v_hits));
  return app.round_view(v_round);
end $$;

-- -----------------------------------------------------------------------------
-- MINES: 5×5 board, 1–24 mines placed by Fisher–Yates (floats 0..m-1).
-- After k safe reveals: multiplier = (1 - edge) · C(25,k) / C(25-m,k).
-- -----------------------------------------------------------------------------
create or replace function app.mines_multiplier(p_mines int, p_safe int, p_edge numeric) returns numeric
language sql immutable as $$
  select case when p_safe = 0 then 0
    else app.trunc4((1 - p_edge) * app.choose(25, p_safe) / app.choose(25 - p_mines, p_safe)) end
$$;

create or replace function public.mines_start(p_stake bigint, p_mines int, p_idempotency_key text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds;
begin
  if p_mines is null or p_mines not between 1 and 24 then perform app.fail('INVALID_PARAMS'); end if;
  if exists (select 1 from public.game_rounds where user_id = v_me.id and game_id = 'mines' and status = 'active') then
    perform app.fail('ACTIVE_ROUND_EXISTS');
  end if;
  v_round := app.begin_round(v_me, 'mines', p_stake, jsonb_build_object('mines', p_mines), p_idempotency_key);
  if v_round.status <> 'active' or v_round.state ? 'revealed' then return app.round_view(v_round); end if;
  perform app.set_round_secret(v_round.id, jsonb_build_object('mines', to_jsonb(app.pf_shuffle(v_round, 25, p_mines, 0))));
  update public.game_rounds
     set state = jsonb_build_object('revealed', '[]'::jsonb, 'multiplier', 0,
                                    'next_multiplier', app.mines_multiplier(p_mines, 1, app.edge(v_round)))
   where id = v_round.id returning * into v_round;
  return app.round_view(v_round);
end $$;

create or replace function public.mines_reveal(p_round_id uuid, p_tile int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds := app.load_active_round(p_round_id, 'mines');
  v_mines jsonb;
  v_revealed jsonb;
  v_m int;
  v_k int;
  v_mult numeric;
begin
  if v_round.status <> 'active' then perform app.fail('ROUND_FINALIZED'); end if;
  if p_tile is null or p_tile not between 0 and 24 then perform app.fail('INVALID_PARAMS'); end if;
  v_revealed := v_round.state -> 'revealed';
  if v_revealed @> to_jsonb(p_tile) then perform app.fail('TILE_ALREADY_REVEALED'); end if;
  v_mines := app.round_secret(v_round.id) -> 'mines';
  v_m := (v_round.params ->> 'mines')::int;

  if v_mines @> to_jsonb(p_tile) then
    v_round := app.finish_round(v_round.id, 0,
      jsonb_build_object('revealed', v_revealed || to_jsonb(p_tile), 'mines', v_mines, 'hit', p_tile, 'multiplier', 0),
      jsonb_build_object('mines', v_mines, 'revealed', v_revealed || to_jsonb(p_tile)));
    return app.round_view(v_round);
  end if;

  v_revealed := v_revealed || to_jsonb(p_tile);
  v_k := jsonb_array_length(v_revealed);
  v_mult := app.mines_multiplier(v_m, v_k, app.edge(v_round));
  if v_k = 25 - v_m then
    v_round := app.finish_round(v_round.id, v_mult,
      jsonb_build_object('revealed', v_revealed, 'mines', v_mines, 'multiplier', v_mult),
      jsonb_build_object('mines', v_mines, 'revealed', v_revealed));
    return app.round_view(v_round);
  end if;
  update public.game_rounds
     set state = jsonb_build_object('revealed', v_revealed, 'multiplier', v_mult,
                                    'next_multiplier', app.mines_multiplier(v_m, v_k + 1, app.edge(v_round)))
   where id = v_round.id returning * into v_round;
  return app.round_view(v_round);
end $$;

create or replace function public.mines_cashout(p_round_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds := app.load_active_round(p_round_id, 'mines');
  v_mines jsonb;
  v_k int;
begin
  if v_round.status <> 'active' then perform app.fail('ROUND_FINALIZED'); end if;
  v_k := jsonb_array_length(v_round.state -> 'revealed');
  if v_k = 0 then perform app.fail('NOTHING_TO_CASH_OUT'); end if;
  v_mines := app.round_secret(v_round.id) -> 'mines';
  v_round := app.finish_round(v_round.id, (v_round.state ->> 'multiplier')::numeric,
    v_round.state || jsonb_build_object('mines', v_mines, 'cashed_out', true),
    jsonb_build_object('mines', v_mines, 'revealed', v_round.state -> 'revealed'));
  return app.round_view(v_round);
end $$;

-- -----------------------------------------------------------------------------
-- CRASH (single-player, server-timed). Crash point uses the Limbo formula
-- (capped at 1000×). Multiplier grows as e^(0.08·t) from the server-side start
-- time; cash-outs are evaluated with the database clock, never the browser's.
-- -----------------------------------------------------------------------------
create or replace function app.crash_growth() returns numeric language sql immutable as $$ select 0.08::numeric $$;

create or replace function app.crash_multiplier_at(p_elapsed numeric) returns numeric
language sql immutable as $$ select floor(exp(app.crash_growth() * greatest(p_elapsed, 0)) * 100) / 100 $$;

create or replace function public.crash_start(p_stake bigint, p_auto_cashout numeric, p_idempotency_key text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds;
  v_auto numeric := round(p_auto_cashout, 2);
  v_point numeric;
begin
  if v_auto is not null and (v_auto < 1.01 or v_auto > 1000) then perform app.fail('INVALID_PARAMS'); end if;
  if exists (select 1 from public.game_rounds where user_id = v_me.id and game_id = 'crash' and status = 'active') then
    perform app.fail('ACTIVE_ROUND_EXISTS');
  end if;
  v_round := app.begin_round(v_me, 'crash', p_stake, jsonb_build_object('auto_cashout', v_auto), p_idempotency_key);
  if v_round.status <> 'active' or v_round.state ? 'started_at' then return app.round_view(v_round); end if;
  v_point := app.limbo_point(app.rf(v_round, 0), app.edge(v_round), 1000);
  perform app.set_round_secret(v_round.id, jsonb_build_object('crash_point', v_point));
  update public.game_rounds
     set state = jsonb_build_object('started_at', clock_timestamp(), 'growth', app.crash_growth())
   where id = v_round.id returning * into v_round;
  return app.round_view(v_round);
end $$;

-- Resolves the round if it has crashed or reached auto cash-out; otherwise reports progress.
create or replace function app.crash_resolve(p_round public.game_rounds, p_cashout boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_round public.game_rounds := p_round;
  v_point numeric := (app.round_secret(p_round.id) ->> 'crash_point')::numeric;
  v_auto numeric := (p_round.params ->> 'auto_cashout')::numeric;
  v_elapsed numeric := extract(epoch from clock_timestamp() - (p_round.state ->> 'started_at')::timestamptz);
  v_now numeric := app.crash_multiplier_at(v_elapsed);
  v_final jsonb;
begin
  -- Auto cash-out happens first if its multiplier was reached before the crash.
  if v_auto is not null and v_auto <= v_point and v_now >= v_auto then
    v_final := p_round.state || jsonb_build_object('crash_point', v_point, 'cashed_out_at', v_auto, 'auto', true);
    v_round := app.finish_round(p_round.id, v_auto, v_final, jsonb_build_object('crash_point', v_point, 'cashed_out_at', v_auto));
  elsif v_now >= v_point then
    v_final := p_round.state || jsonb_build_object('crash_point', v_point, 'cashed_out_at', null);
    v_round := app.finish_round(p_round.id, 0, v_final, jsonb_build_object('crash_point', v_point));
  elsif p_cashout then
    v_final := p_round.state || jsonb_build_object('crash_point', v_point, 'cashed_out_at', v_now, 'auto', false);
    v_round := app.finish_round(p_round.id, v_now, v_final, jsonb_build_object('crash_point', v_point, 'cashed_out_at', v_now));
  end if;
  return app.round_view(v_round) || jsonb_build_object('server_multiplier', v_now, 'elapsed', v_elapsed);
end $$;

create or replace function public.crash_cashout(p_round_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds := app.load_active_round(p_round_id, 'crash');
begin
  if v_round.status <> 'active' then return app.round_view(v_round); end if;
  return app.crash_resolve(v_round, true);
end $$;

create or replace function public.crash_status(p_round_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds := app.load_active_round(p_round_id, 'crash');
begin
  if v_round.status <> 'active' then return app.round_view(v_round); end if;
  return app.crash_resolve(v_round, false);
end $$;

-- -----------------------------------------------------------------------------
-- HI-LO: infinite deck, card = floor(f·52); rank = card % 13 + 1 (A=1 … K=13).
-- "higher" wins if next rank ≥ current (P = (14 - r)/13), "lower" if ≤ (P = r/13).
-- Guesses with P = 1 are not offered. Edge is applied once, at cash-out:
-- multiplier = (1 - edge) · Π 1/P_i.
-- -----------------------------------------------------------------------------
create or replace function app.card(p_round public.game_rounds, p_index int) returns int
language sql stable as $$ select floor(app.rf(p_round, p_index) * 52)::int $$;

create or replace function public.hilo_start(p_stake bigint, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds;
begin
  if exists (select 1 from public.game_rounds where user_id = v_me.id and game_id = 'hilo' and status = 'active') then
    perform app.fail('ACTIVE_ROUND_EXISTS');
  end if;
  v_round := app.begin_round(v_me, 'hilo', p_stake, '{}'::jsonb, p_idempotency_key);
  if v_round.status <> 'active' or v_round.state ? 'cards' then return app.round_view(v_round); end if;
  update public.game_rounds
     set state = jsonb_build_object('cards', jsonb_build_array(app.card(v_round, 0)), 'cursor', 1,
                                    'fair_multiplier', 1, 'multiplier', 0, 'history', '[]'::jsonb, 'skips', 0)
   where id = v_round.id returning * into v_round;
  return app.round_view(v_round);
end $$;

create or replace function public.hilo_guess(p_round_id uuid, p_guess text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds := app.load_active_round(p_round_id, 'hilo');
  v_cards jsonb;
  v_cur int;
  v_rank int;
  v_next int;
  v_next_rank int;
  v_p numeric;
  v_win boolean;
  v_fair numeric;
  v_cursor int;
  v_state jsonb;
begin
  if v_round.status <> 'active' then perform app.fail('ROUND_FINALIZED'); end if;
  if p_guess not in ('higher', 'lower', 'skip') then perform app.fail('INVALID_PARAMS'); end if;
  v_cards := v_round.state -> 'cards';
  v_cur := (v_cards ->> (jsonb_array_length(v_cards) - 1))::int;
  v_rank := v_cur % 13 + 1;
  v_cursor := (v_round.state ->> 'cursor')::int;
  if v_cursor > 400 then perform app.fail('ROUND_TOO_LONG'); end if;
  v_next := app.card(v_round, v_cursor);
  v_next_rank := v_next % 13 + 1;
  v_fair := (v_round.state ->> 'fair_multiplier')::numeric;

  if p_guess = 'skip' then
    if (v_round.state ->> 'skips')::int >= 52 then perform app.fail('SKIP_LIMIT'); end if;
    v_state := v_round.state || jsonb_build_object('cards', v_cards || to_jsonb(v_next), 'cursor', v_cursor + 1,
      'skips', (v_round.state ->> 'skips')::int + 1,
      'history', (v_round.state -> 'history') || jsonb_build_object('guess', 'skip', 'card', v_next));
    update public.game_rounds set state = v_state where id = v_round.id returning * into v_round;
    return app.round_view(v_round);
  end if;

  v_p := case when p_guess = 'higher' then (14 - v_rank) / 13.0 else v_rank / 13.0 end;
  if v_p >= 1 then perform app.fail('GUESS_NOT_ALLOWED'); end if;
  v_win := case when p_guess = 'higher' then v_next_rank >= v_rank else v_next_rank <= v_rank end;

  if not v_win then
    v_round := app.finish_round(v_round.id, 0,
      v_round.state || jsonb_build_object('cards', v_cards || to_jsonb(v_next), 'cursor', v_cursor + 1, 'multiplier', 0,
        'history', (v_round.state -> 'history') || jsonb_build_object('guess', p_guess, 'card', v_next, 'win', false)),
      jsonb_build_object('cards', v_cards || to_jsonb(v_next)));
    return app.round_view(v_round);
  end if;

  v_fair := v_fair / v_p;
  v_state := v_round.state || jsonb_build_object('cards', v_cards || to_jsonb(v_next), 'cursor', v_cursor + 1,
    'fair_multiplier', v_fair, 'multiplier', app.trunc4(v_fair * (1 - app.edge(v_round))),
    'history', (v_round.state -> 'history') || jsonb_build_object('guess', p_guess, 'card', v_next, 'win', true));
  update public.game_rounds set state = v_state where id = v_round.id returning * into v_round;
  return app.round_view(v_round);
end $$;

create or replace function public.hilo_cashout(p_round_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds := app.load_active_round(p_round_id, 'hilo');
begin
  if v_round.status <> 'active' then perform app.fail('ROUND_FINALIZED'); end if;
  if coalesce((v_round.state ->> 'multiplier')::numeric, 0) <= 0 then perform app.fail('NOTHING_TO_CASH_OUT'); end if;
  v_round := app.finish_round(v_round.id, (v_round.state ->> 'multiplier')::numeric,
    v_round.state || jsonb_build_object('cashed_out', true), jsonb_build_object('cards', v_round.state -> 'cards'));
  return app.round_view(v_round);
end $$;

-- -----------------------------------------------------------------------------
-- BLACKJACK: infinite deck, dealer stands on soft 17, dealer peeks for
-- blackjack, blackjack pays 3:2, double on first two cards, no split/insurance.
-- Card order: player, dealer up, player, dealer hole, then draws from index 4.
-- -----------------------------------------------------------------------------
create or replace function app.bj_value(p_cards jsonb) returns int
language plpgsql immutable as $$
declare
  v_total int := 0;
  v_aces int := 0;
  v_c jsonb;
  v_rank int;
begin
  for v_c in select * from jsonb_array_elements(p_cards) loop
    v_rank := (v_c #>> '{}')::int % 13 + 1;
    if v_rank = 1 then v_aces := v_aces + 1; v_total := v_total + 11;
    elsif v_rank >= 10 then v_total := v_total + 10;
    else v_total := v_total + v_rank; end if;
  end loop;
  while v_total > 21 and v_aces > 0 loop v_total := v_total - 10; v_aces := v_aces - 1; end loop;
  return v_total;
end $$;

create or replace function app.bj_soft(p_cards jsonb) returns boolean
language plpgsql immutable as $$
declare
  v_hard int := 0;
  v_has_ace boolean := false;
  v_c jsonb;
  v_rank int;
begin
  for v_c in select * from jsonb_array_elements(p_cards) loop
    v_rank := (v_c #>> '{}')::int % 13 + 1;
    if v_rank = 1 then v_has_ace := true; v_hard := v_hard + 1;
    elsif v_rank >= 10 then v_hard := v_hard + 10;
    else v_hard := v_hard + v_rank; end if;
  end loop;
  return v_has_ace and v_hard + 10 <= 21;
end $$;

create or replace function app.bj_is_blackjack(p_cards jsonb) returns boolean
language sql immutable as $$ select jsonb_array_length(p_cards) = 2 and app.bj_value(p_cards) = 21 $$;

create or replace function app.bj_finish(p_round public.game_rounds, p_player jsonb, p_dealer jsonb, p_cursor int, p_doubled boolean)
returns public.game_rounds
language plpgsql security definer set search_path = public as $$
declare
  v_dealer jsonb := p_dealer;
  v_cursor int := p_cursor;
  v_pv int := app.bj_value(p_player);
  v_dv int;
  v_mult numeric;
  v_outcome text;
begin
  if v_pv <= 21 then
    while app.bj_value(v_dealer) < 17 loop
      v_dealer := v_dealer || to_jsonb(app.card(p_round, v_cursor));
      v_cursor := v_cursor + 1;
    end loop;
  end if;
  v_dv := app.bj_value(v_dealer);
  if v_pv > 21 then v_mult := 0; v_outcome := 'bust';
  elsif v_dv > 21 or v_pv > v_dv then v_mult := 2; v_outcome := 'win';
  elsif v_pv = v_dv then v_mult := 1; v_outcome := 'push';
  else v_mult := 0; v_outcome := 'lose'; end if;
  return app.finish_round(p_round.id, v_mult,
    jsonb_build_object('player', p_player, 'dealer', v_dealer, 'player_value', v_pv, 'dealer_value', v_dv,
                       'cursor', v_cursor, 'doubled', p_doubled, 'outcome', v_outcome),
    jsonb_build_object('player', p_player, 'dealer', v_dealer, 'outcome', v_outcome));
end $$;

create or replace function public.blackjack_start(p_stake bigint, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds;
  v_player jsonb;
  v_dealer jsonb;
  v_up int;
  v_outcome text;
begin
  if exists (select 1 from public.game_rounds where user_id = v_me.id and game_id = 'blackjack' and status = 'active') then
    perform app.fail('ACTIVE_ROUND_EXISTS');
  end if;
  v_round := app.begin_round(v_me, 'blackjack', p_stake, '{}'::jsonb, p_idempotency_key);
  if v_round.status <> 'active' or v_round.state ? 'player' then return app.round_view(v_round); end if;
  v_player := jsonb_build_array(app.card(v_round, 0), app.card(v_round, 2));
  v_dealer := jsonb_build_array(app.card(v_round, 1), app.card(v_round, 3));
  v_up := (v_dealer ->> 0)::int % 13 + 1;

  if app.bj_is_blackjack(v_player) or app.bj_is_blackjack(v_dealer) then
    v_outcome := case
      when app.bj_is_blackjack(v_player) and app.bj_is_blackjack(v_dealer) then 'push'
      when app.bj_is_blackjack(v_player) then 'blackjack'
      else 'dealer_blackjack' end;
    v_round := app.finish_round(v_round.id,
      case v_outcome when 'push' then 1 when 'blackjack' then 2.5 else 0 end,
      jsonb_build_object('player', v_player, 'dealer', v_dealer, 'player_value', app.bj_value(v_player),
                         'dealer_value', app.bj_value(v_dealer), 'cursor', 4, 'outcome', v_outcome),
      jsonb_build_object('player', v_player, 'dealer', v_dealer, 'outcome', v_outcome));
    return app.round_view(v_round);
  end if;

  perform app.set_round_secret(v_round.id, jsonb_build_object('hole', v_dealer -> 1));
  update public.game_rounds
     set state = jsonb_build_object('player', v_player, 'dealer', jsonb_build_array(v_dealer -> 0),
                                    'player_value', app.bj_value(v_player), 'cursor', 4, 'doubled', false,
                                    'can_double', true)
   where id = v_round.id returning * into v_round;
  return app.round_view(v_round);
end $$;

create or replace function public.blackjack_action(p_round_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds := app.load_active_round(p_round_id, 'blackjack');
  v_player jsonb;
  v_dealer jsonb;
  v_cursor int;
begin
  if v_round.status <> 'active' then perform app.fail('ROUND_FINALIZED'); end if;
  if p_action not in ('hit', 'stand', 'double') then perform app.fail('INVALID_PARAMS'); end if;
  v_player := v_round.state -> 'player';
  v_dealer := jsonb_build_array(v_round.state -> 'dealer' -> 0, app.round_secret(v_round.id) -> 'hole');
  v_cursor := (v_round.state ->> 'cursor')::int;

  if p_action = 'double' then
    if jsonb_array_length(v_player) <> 2 then perform app.fail('DOUBLE_NOT_ALLOWED'); end if;
    v_round := app.add_stake(v_round, v_round.stake);
    v_player := v_player || to_jsonb(app.card(v_round, v_cursor));
    v_round := app.bj_finish(v_round, v_player, v_dealer, v_cursor + 1, true);
    return app.round_view(v_round);
  end if;

  if p_action = 'hit' then
    v_player := v_player || to_jsonb(app.card(v_round, v_cursor));
    v_cursor := v_cursor + 1;
    if app.bj_value(v_player) >= 21 then
      v_round := app.bj_finish(v_round, v_player, v_dealer, v_cursor, false);
      return app.round_view(v_round);
    end if;
    update public.game_rounds
       set state = state || jsonb_build_object('player', v_player, 'player_value', app.bj_value(v_player),
                                              'cursor', v_cursor, 'can_double', false)
     where id = v_round.id returning * into v_round;
    return app.round_view(v_round);
  end if;

  v_round := app.bj_finish(v_round, v_player, v_dealer, v_cursor, false);
  return app.round_view(v_round);
end $$;

-- -----------------------------------------------------------------------------
-- BACCARAT (punto banco, infinite deck). Fixed edges from the rules:
-- Player 1:1, Banker 0.95:1 (5% commission), Tie 8:1 (Player/Banker push on tie).
-- Card order: P1, B1, P2, B2, then third cards by the standard tableau.
-- -----------------------------------------------------------------------------
create or replace function app.bac_point(p_card int) returns int
language sql immutable as $$ select case when p_card % 13 + 1 >= 10 then 0 else p_card % 13 + 1 end $$;

create or replace function public.play_baccarat(p_bets jsonb, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds;
  v_bp bigint := coalesce((p_bets ->> 'player')::bigint, 0);
  v_bb bigint := coalesce((p_bets ->> 'banker')::bigint, 0);
  v_bt bigint := coalesce((p_bets ->> 'tie')::bigint, 0);
  v_p jsonb; v_b jsonb;
  v_pt int; v_bt_pts int;
  v_p3 int := null;
  v_cursor int := 4;
  v_winner text;
  v_return numeric := 0;
  v_draw_banker boolean;
begin
  if v_bp < 0 or v_bb < 0 or v_bt < 0 or v_bp + v_bb + v_bt = 0 then perform app.fail('INVALID_PARAMS'); end if;
  v_round := app.begin_round(v_me, 'baccarat', v_bp + v_bb + v_bt,
    jsonb_build_object('player', v_bp, 'banker', v_bb, 'tie', v_bt), p_idempotency_key);
  if v_round.status <> 'active' then return app.round_view(v_round); end if;

  v_p := jsonb_build_array(app.card(v_round, 0), app.card(v_round, 2));
  v_b := jsonb_build_array(app.card(v_round, 1), app.card(v_round, 3));
  v_pt := (app.bac_point((v_p->>0)::int) + app.bac_point((v_p->>1)::int)) % 10;
  v_bt_pts := (app.bac_point((v_b->>0)::int) + app.bac_point((v_b->>1)::int)) % 10;

  if v_pt < 8 and v_bt_pts < 8 then
    if v_pt <= 5 then
      v_p3 := app.card(v_round, v_cursor); v_cursor := v_cursor + 1;
      v_p := v_p || to_jsonb(v_p3);
      v_pt := (v_pt + app.bac_point(v_p3)) % 10;
    end if;
    if v_p3 is null then
      v_draw_banker := v_bt_pts <= 5;
    else
      v_draw_banker := case
        when v_bt_pts <= 2 then true
        when v_bt_pts = 3 then app.bac_point(v_p3) <> 8
        when v_bt_pts = 4 then app.bac_point(v_p3) between 2 and 7
        when v_bt_pts = 5 then app.bac_point(v_p3) between 4 and 7
        when v_bt_pts = 6 then app.bac_point(v_p3) between 6 and 7
        else false end;
    end if;
    if v_draw_banker then
      v_b := v_b || to_jsonb(app.card(v_round, v_cursor)); v_cursor := v_cursor + 1;
      v_bt_pts := (v_bt_pts + app.bac_point((v_b->>2)::int)) % 10;
    end if;
  end if;

  v_winner := case when v_pt > v_bt_pts then 'player' when v_bt_pts > v_pt then 'banker' else 'tie' end;
  v_return := case v_winner
    when 'player' then v_bp * 2
    when 'banker' then v_bb * 1.95
    else v_bp + v_bb + v_bt * 9 end;

  v_round := app.finish_round(v_round.id, v_return / v_round.stake,
    jsonb_build_object('player', v_p, 'banker', v_b, 'player_total', v_pt, 'banker_total', v_bt_pts, 'winner', v_winner),
    jsonb_build_object('winner', v_winner, 'player_total', v_pt, 'banker_total', v_bt_pts));
  return app.round_view(v_round);
end $$;

-- -----------------------------------------------------------------------------
-- VIDEO POKER (Jacks or Better, single 52-card deck shuffled with Fisher–Yates
-- on floats 0..9: cards 1–5 dealt, 6–10 used as replacements in order).
-- Return depends on player strategy (≈99.5% with optimal play on this table).
-- -----------------------------------------------------------------------------
create or replace function app.vp_rank_hand(p_cards int[]) returns text
language plpgsql immutable as $$
declare
  v_ranks int[] := array(select c % 13 + 1 from unnest(p_cards) c order by 1);
  v_suits int[] := array(select c / 13 from unnest(p_cards) c);
  v_flush boolean := (select count(distinct s) = 1 from unnest(v_suits) s);
  v_counts int[] := array(select count(*)::int from unnest(v_ranks) r group by r order by count(*) desc, r desc);
  v_distinct int := (select count(distinct r) from unnest(v_ranks) r);
  v_straight boolean := false;
  v_royal boolean := false;
  v_pair_rank int;
begin
  if v_distinct = 5 then
    if v_ranks[5] - v_ranks[1] = 4 then v_straight := true; end if;
    if v_ranks = array[1, 10, 11, 12, 13] then v_straight := true; v_royal := true; end if;
  end if;
  if v_straight and v_flush and v_royal then return 'royal_flush'; end if;
  if v_straight and v_flush then return 'straight_flush'; end if;
  if v_counts[1] = 4 then return 'four_of_a_kind'; end if;
  if v_counts[1] = 3 and v_counts[2] = 2 then return 'full_house'; end if;
  if v_flush then return 'flush'; end if;
  if v_straight then return 'straight'; end if;
  if v_counts[1] = 3 then return 'three_of_a_kind'; end if;
  if v_counts[1] = 2 and v_counts[2] = 2 then return 'two_pair'; end if;
  if v_counts[1] = 2 then
    select r into v_pair_rank from unnest(v_ranks) r group by r having count(*) = 2;
    if v_pair_rank = 1 or v_pair_rank >= 11 then return 'jacks_or_better'; end if;
  end if;
  return 'nothing';
end $$;

create or replace function app.vp_pays(p_hand text) returns int
language sql immutable as $$
  select case p_hand
    when 'royal_flush' then 800 when 'straight_flush' then 50 when 'four_of_a_kind' then 25
    when 'full_house' then 9 when 'flush' then 6 when 'straight' then 4 when 'three_of_a_kind' then 3
    when 'two_pair' then 2 when 'jacks_or_better' then 1 else 0 end
$$;

create or replace function public.videopoker_deal(p_stake bigint, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds;
  v_deck int[];
begin
  if exists (select 1 from public.game_rounds where user_id = v_me.id and game_id = 'videopoker' and status = 'active') then
    perform app.fail('ACTIVE_ROUND_EXISTS');
  end if;
  v_round := app.begin_round(v_me, 'videopoker', p_stake, '{}'::jsonb, p_idempotency_key);
  if v_round.status <> 'active' or v_round.state ? 'hand' then return app.round_view(v_round); end if;
  v_deck := app.pf_shuffle(v_round, 52, 10, 0);
  perform app.set_round_secret(v_round.id, jsonb_build_object('deck', to_jsonb(v_deck)));
  update public.game_rounds
     set state = jsonb_build_object('hand', to_jsonb(v_deck[1:5]), 'hand_rank', app.vp_rank_hand(v_deck[1:5]))
   where id = v_round.id returning * into v_round;
  return app.round_view(v_round);
end $$;

create or replace function public.videopoker_draw(p_round_id uuid, p_hold boolean[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds := app.load_active_round(p_round_id, 'videopoker');
  v_deck int[];
  v_hand int[];
  v_next int := 6;
  v_rank text;
  i int;
begin
  if v_round.status <> 'active' then perform app.fail('ROUND_FINALIZED'); end if;
  if p_hold is null or cardinality(p_hold) <> 5 then perform app.fail('INVALID_PARAMS'); end if;
  v_deck := array(select (x #>> '{}')::int from jsonb_array_elements(app.round_secret(v_round.id) -> 'deck') x);
  v_hand := v_deck[1:5];
  for i in 1..5 loop
    if not coalesce(p_hold[i], false) then
      v_hand[i] := v_deck[v_next];
      v_next := v_next + 1;
    end if;
  end loop;
  v_rank := app.vp_rank_hand(v_hand);
  v_round := app.finish_round(v_round.id, app.vp_pays(v_rank),
    jsonb_build_object('initial', to_jsonb(v_deck[1:5]), 'hold', to_jsonb(p_hold), 'hand', to_jsonb(v_hand),
                       'hand_rank', v_rank, 'pays', app.vp_pays(v_rank)),
    jsonb_build_object('hand', to_jsonb(v_hand), 'hand_rank', v_rank));
  return app.round_view(v_round);
end $$;

-- -----------------------------------------------------------------------------
-- ORIGINAL SLOTS: 3×3 grid, every cell an independent weighted symbol
-- (floats 0..8, column-major), 5 paylines (3 rows + 2 diagonals), three of a
-- kind pays. With p_s = w_s/Σw, expected return per line = Σ p_s³ · pay_s.
-- Pays are scaled so the exact RTP = 1 - edge; each line carries stake/5.
-- -----------------------------------------------------------------------------
create or replace function app.slot_scale(p_config jsonb, p_edge numeric) returns numeric
language plpgsql immutable as $$
declare
  v_total numeric := (select sum((s->>'weight')::numeric) from jsonb_array_elements(p_config->'symbols') s);
  v_ev numeric;
begin
  select sum(power((s->>'weight')::numeric / v_total, 3) * (s->>'pay')::numeric) into v_ev
    from jsonb_array_elements(p_config->'symbols') s;
  return (1 - p_edge) / v_ev;
end $$;

create or replace function public.slot_paytable(p_game_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_agg(jsonb_build_object('id', s->>'id', 'weight', (s->>'weight')::numeric,
    'line_multiplier', app.trunc4((s->>'pay')::numeric * app.slot_scale(c.config, app.game_edge_bps(p_game_id) / 10000.0))))
  from public.game_configurations c, jsonb_array_elements(c.config->'symbols') s
  where c.game_id = p_game_id
$$;

create or replace function public.play_slot(p_game_id text, p_stake bigint, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds;
  v_config jsonb;
  v_total numeric;
  v_scale numeric;
  v_grid text[] := '{}';
  v_f double precision;
  v_acc numeric;
  v_s jsonb;
  v_lines int[][] := array[[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  v_wins jsonb := '[]'::jsonb;
  v_mult numeric := 0;
  v_line_mult numeric;
  i int;
begin
  select config into v_config from public.game_configurations c
    join public.casino_games g on g.id = c.game_id
   where c.game_id = p_game_id and g.category = 'slots';
  if not found then perform app.fail('GAME_UNAVAILABLE'); end if;
  v_round := app.begin_round(v_me, p_game_id, p_stake, '{}'::jsonb, p_idempotency_key);
  if v_round.status <> 'active' then return app.round_view(v_round); end if;

  v_total := (select sum((s->>'weight')::numeric) from jsonb_array_elements(v_config->'symbols') s);
  v_scale := app.slot_scale(v_config, app.edge(v_round));
  -- Cell i (0..8): column = i / 3, row = i % 3.
  for i in 0..8 loop
    v_f := app.rf(v_round, i) * v_total;
    v_acc := 0;
    for v_s in select * from jsonb_array_elements(v_config->'symbols') loop
      v_acc := v_acc + (v_s->>'weight')::numeric;
      if v_f < v_acc then v_grid := v_grid || (v_s->>'id'); exit; end if;
    end loop;
  end loop;

  for i in 1..5 loop
    if v_grid[v_lines[i][1] + 1] = v_grid[v_lines[i][2] + 1] and v_grid[v_lines[i][2] + 1] = v_grid[v_lines[i][3] + 1] then
      select (s->>'pay')::numeric * v_scale / 5 into v_line_mult
        from jsonb_array_elements(v_config->'symbols') s where s->>'id' = v_grid[v_lines[i][1] + 1];
      v_mult := v_mult + v_line_mult;
      v_wins := v_wins || jsonb_build_object('line', i - 1, 'symbol', v_grid[v_lines[i][1] + 1],
                                             'multiplier', app.trunc4(v_line_mult));
    end if;
  end loop;

  v_round := app.finish_round(v_round.id, v_mult,
    jsonb_build_object('grid', to_jsonb(v_grid), 'wins', v_wins),
    jsonb_build_object('grid', to_jsonb(v_grid), 'wins', v_wins));
  return app.round_view(v_round);
end $$;
