-- =============================================================================
-- KOMETA — two more original games.
--
--  * Kometa Jet: crash game with two simultaneous bets per round, each with its
--    own (optional) auto cash-out. One crash point per round (Limbo formula,
--    RTP = 1 − edge for every cash-out target), server clock decides.
--  * Hot Fruits 5: classic 5×3 slot, 5 fixed lines, left-to-right pays and a
--    scatter star that pays anywhere. Cells are independent weighted draws, so the
--    exact RTP has a closed form (see app.lines_ev); pays are scaled to 1 − edge.
-- =============================================================================

-- Completes a round with an exact payout in units (used when a round holds several bets).
create or replace function app.finish_round_units(
  p_round_id uuid, p_payout bigint, p_state jsonb, p_outcome jsonb
) returns public.game_rounds
language plpgsql security definer set search_path = public, app as $$
declare
  v_round public.game_rounds;
  v_payout bigint;
  v_mult numeric;
  v_status public.round_status;
begin
  select * into v_round from public.game_rounds where id = p_round_id for update;
  if v_round.status <> 'active' then perform app.fail('ROUND_FINALIZED'); end if;
  v_payout := least(greatest(coalesce(p_payout, 0), 0), app.setting_int('casino.max_payout_units', 100000000));
  v_mult := floor(v_payout::numeric / v_round.stake * 10000) / 10000;
  v_status := case when v_payout > v_round.stake then 'won' when v_payout = v_round.stake then 'push' else 'lost' end;
  if v_payout > 0 then
    perform app.move_credits('game_payout', null, 'round-payout:' || v_round.id,
      app.system_account('SYS_HOUSE_CASINO'), app.wallet_account(v_round.user_id), v_payout,
      'round:' || v_round.id, null, v_round.tenant_id, jsonb_build_object('game', v_round.game_id));
  end if;
  update public.game_rounds
     set status = v_status, payout = v_payout, multiplier = v_mult, state = coalesce(p_state, state), completed_at = now()
   where id = p_round_id
  returning * into v_round;
  insert into public.game_results (round_id, user_id, tenant_id, game_id, stake, payout, multiplier, outcome)
  values (v_round.id, v_round.user_id, v_round.tenant_id, v_round.game_id, v_round.stake, v_payout, v_mult,
          coalesce(p_outcome, '{}'::jsonb));
  return v_round;
end $$;

-- -----------------------------------------------------------------------------
-- KOMETA JET
-- p_bets: [{"stake": units, "auto": 2.0|null}, ...] (1 or 2 bets)
-- state: {started_at, growth, cashed: [m|null, m|null]}
-- -----------------------------------------------------------------------------
create or replace function public.jet_start(p_bets jsonb, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds;
  v_b jsonb;
  v_bets jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_stake bigint;
  v_auto numeric;
  v_min bigint;
  v_point numeric;
begin
  if jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) not between 1 and 2 then
    perform app.fail('INVALID_PARAMS', '1 or 2 bets');
  end if;
  select min_bet into v_min from public.casino_games where id = 'jet';
  for v_b in select * from jsonb_array_elements(p_bets) loop
    v_stake := (v_b->>'stake')::bigint;
    v_auto := round(nullif(v_b->>'auto', '')::numeric, 2);
    if v_stake is null or v_stake < greatest(coalesce(v_min, 1), app.setting_int('casino.min_bet_units', 1)) then
      perform app.fail('STAKE_TOO_LOW');
    end if;
    if v_auto is not null and (v_auto < 1.01 or v_auto > 1000) then perform app.fail('INVALID_PARAMS'); end if;
    v_total := v_total + v_stake;
    v_bets := v_bets || jsonb_build_object('stake', v_stake, 'auto', v_auto);
  end loop;
  if exists (select 1 from public.game_rounds where user_id = v_me.id and game_id = 'jet' and status = 'active') then
    perform app.fail('ACTIVE_ROUND_EXISTS');
  end if;
  v_round := app.begin_round(v_me, 'jet', v_total, jsonb_build_object('bets', v_bets), p_idempotency_key);
  if v_round.status <> 'active' or v_round.state ? 'started_at' then return app.round_view(v_round); end if;
  v_point := app.limbo_point(app.rf(v_round, 0), app.edge(v_round), 1000);
  perform app.set_round_secret(v_round.id, jsonb_build_object('crash_point', v_point));
  update public.game_rounds
     set state = jsonb_build_object('started_at', clock_timestamp(), 'growth', app.crash_growth(),
                                    'cashed', (select jsonb_agg('null'::jsonb) from jsonb_array_elements(v_bets)))
   where id = v_round.id returning * into v_round;
  return app.round_view(v_round);
end $$;

-- Applies auto cash-outs, an optional manual cash-out of bet p_bet, and the crash.
create or replace function app.jet_resolve(p_round public.game_rounds, p_bet int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_round public.game_rounds := p_round;
  v_point numeric := (app.round_secret(p_round.id) ->> 'crash_point')::numeric;
  v_bets jsonb := p_round.params -> 'bets';
  v_cashed jsonb := p_round.state -> 'cashed';
  v_elapsed numeric := extract(epoch from clock_timestamp() - (p_round.state ->> 'started_at')::timestamptz);
  v_now numeric := app.crash_multiplier_at(v_elapsed);
  v_auto numeric;
  v_n int := jsonb_array_length(p_round.params -> 'bets');
  v_open int := 0;
  v_payout bigint := 0;
  v_state jsonb;
  i int;
begin
  for i in 0..v_n - 1 loop
    if v_cashed -> i = 'null'::jsonb then
      v_auto := nullif(v_bets -> i ->> 'auto', '')::numeric;
      -- Auto cash-out first if its target was reached before the crash.
      if v_auto is not null and v_auto <= v_point and v_now >= v_auto then
        v_cashed := jsonb_set(v_cashed, array[i::text], to_jsonb(v_auto));
      elsif p_bet = i and v_now < v_point then
        v_cashed := jsonb_set(v_cashed, array[i::text], to_jsonb(v_now));
      end if;
    end if;
    if v_cashed -> i = 'null'::jsonb then v_open := v_open + 1; end if;
  end loop;

  if v_open = 0 or v_now >= v_point then
    for i in 0..v_n - 1 loop
      if v_cashed -> i <> 'null'::jsonb then
        v_payout := v_payout + floor((v_bets -> i ->> 'stake')::bigint * (v_cashed ->> i)::numeric)::bigint;
      end if;
    end loop;
    v_state := p_round.state || jsonb_build_object('cashed', v_cashed, 'crash_point', v_point);
    v_round := app.finish_round_units(p_round.id, v_payout, v_state,
                 jsonb_build_object('crash_point', v_point, 'cashed', v_cashed));
  else
    update public.game_rounds set state = state || jsonb_build_object('cashed', v_cashed)
     where id = p_round.id returning * into v_round;
  end if;
  return app.round_view(v_round) || jsonb_build_object('server_multiplier', v_now, 'elapsed', v_elapsed);
end $$;

create or replace function public.jet_cashout(p_round_id uuid, p_bet int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds := app.load_active_round(p_round_id, 'jet');
begin
  if v_round.status <> 'active' then return app.round_view(v_round); end if;
  if p_bet is null or p_bet < 0 or p_bet >= jsonb_array_length(v_round.params -> 'bets') then perform app.fail('INVALID_PARAMS'); end if;
  return app.jet_resolve(v_round, p_bet);
end $$;

create or replace function public.jet_status(p_round_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds := app.load_active_round(p_round_id, 'jet');
begin
  if v_round.status <> 'active' then return app.round_view(v_round); end if;
  return app.jet_resolve(v_round, -1);
end $$;

-- -----------------------------------------------------------------------------
-- HOT FRUITS 5 — engine "lines5"
-- config: {engine, symbols:[{id, weight, pays:{"2":x,"3":x,"4":x,"5":x}}],
--          scatter:{id, weight, pays:{"3":x,...}}}   pays are raw (before scaling)
-- Line pays are multiples of the line bet (stake / 5); scatter pays × total stake.
-- Grid cell index = column * 3 + row (column-major, 15 cells).
-- -----------------------------------------------------------------------------
create or replace function app.lines_ev(p_config jsonb) returns numeric
language plpgsql immutable as $$
declare
  v_total numeric;
  v_ev numeric := 0;
  v_s jsonb;
  v_p numeric;
  v_q numeric;
  v_k int;
  v_n int;
  v_binom numeric;
begin
  v_total := (select sum((s->>'weight')::numeric) from jsonb_array_elements(p_config->'symbols') s)
             + (p_config->'scatter'->>'weight')::numeric;
  -- One line (by linearity the 5 lines at stake/5 each have the same expectation as one line at full stake).
  for v_s in select * from jsonb_array_elements(p_config->'symbols') loop
    v_p := (v_s->>'weight')::numeric / v_total;
    for v_k in 2..5 loop
      if v_s->'pays' ? v_k::text then
        v_ev := v_ev + (v_s->'pays'->>v_k::text)::numeric
                       * power(v_p, v_k) * case when v_k < 5 then 1 - v_p else 1 end;
      end if;
    end loop;
  end loop;
  -- Scatter: Binomial(15, q).
  v_q := (p_config->'scatter'->>'weight')::numeric / v_total;
  for v_n in 3..15 loop
    v_k := least(v_n, 5);
    if p_config->'scatter'->'pays' ? v_k::text then
      v_binom := (select exp(sum(ln(x::numeric))) from generate_series(1, 15) x)
               / ((select exp(sum(ln(x::numeric))) from generate_series(1, v_n) x)
                  * coalesce((select exp(sum(ln(x::numeric))) from generate_series(1, 15 - v_n) x), 1));
      v_ev := v_ev + (p_config->'scatter'->'pays'->>v_k::text)::numeric
                     * round(v_binom) * power(v_q, v_n) * power(1 - v_q, 15 - v_n);
    end if;
  end loop;
  return v_ev;
end $$;

create or replace function public.lines_paytable(p_game_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'symbols', (select jsonb_agg(jsonb_build_object('id', s->>'id',
        'pays', (select jsonb_object_agg(k, app.trunc4(v::numeric * x.scale)) from jsonb_each_text(s->'pays') p(k, v))))
      from jsonb_array_elements(c.config->'symbols') s),
    'scatter', jsonb_build_object('id', c.config->'scatter'->>'id',
        'pays', (select jsonb_object_agg(k, app.trunc4(v::numeric * x.scale)) from jsonb_each_text(c.config->'scatter'->'pays') p(k, v))),
    'lines', '[[0,3,6,9,12],[1,4,7,10,13],[2,5,8,11,14],[0,4,8,10,12],[2,4,6,10,14]]'::jsonb,
    'rtp', round((1 - app.game_edge_bps(p_game_id) / 10000.0) * 100, 2))
  from public.game_configurations c,
       lateral (select (1 - app.game_edge_bps(p_game_id) / 10000.0) / app.lines_ev(c.config) as scale) x
  where c.game_id = p_game_id and c.config->>'engine' = 'lines5'
$$;

create or replace function public.play_lines(p_game_id text, p_stake bigint, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds;
  v_config jsonb;
  v_ids text[] := '{}';
  v_w numeric[] := '{}';
  v_total numeric := 0;
  v_scale numeric;
  v_grid text[] := '{}';
  v_f double precision;
  v_acc numeric;
  v_lines int[][] := array[[0,3,6,9,12],[1,4,7,10,13],[2,5,8,11,14],[0,4,8,10,12],[2,4,6,10,14]];
  v_s jsonb;
  v_first text;
  v_run int;
  v_pay numeric;
  v_mult numeric := 0;
  v_wins jsonb := '[]'::jsonb;
  v_scatter text;
  v_stars int;
  i int;
  j int;
begin
  select c.config into v_config from public.game_configurations c
    join public.casino_games g on g.id = c.game_id
   where c.game_id = p_game_id and g.category = 'slots' and c.config->>'engine' = 'lines5';
  if not found then perform app.fail('GAME_UNAVAILABLE'); end if;
  v_round := app.begin_round(v_me, p_game_id, p_stake, '{}'::jsonb, p_idempotency_key);
  if v_round.status <> 'active' then return app.round_view(v_round); end if;

  for v_s in select * from jsonb_array_elements(v_config->'symbols') loop
    v_ids := v_ids || (v_s->>'id'); v_w := v_w || (v_s->>'weight')::numeric;
  end loop;
  v_scatter := v_config->'scatter'->>'id';
  v_ids := v_ids || v_scatter; v_w := v_w || (v_config->'scatter'->>'weight')::numeric;
  for i in 1..cardinality(v_w) loop v_total := v_total + v_w[i]; end loop;
  v_scale := (1 - app.edge(v_round)) / app.lines_ev(v_config);

  for i in 0..14 loop
    v_f := app.rf(v_round, i) * v_total;
    v_acc := 0;
    for j in 1..cardinality(v_ids) loop
      v_acc := v_acc + v_w[j];
      if v_f < v_acc or j = cardinality(v_ids) then v_grid := v_grid || v_ids[j]; exit; end if;
    end loop;
  end loop;

  for i in 1..5 loop
    v_first := v_grid[v_lines[i][1] + 1];
    continue when v_first = v_scatter;
    v_run := 1;
    for j in 2..5 loop
      exit when v_grid[v_lines[i][j] + 1] <> v_first;
      v_run := v_run + 1;
    end loop;
    select (s->'pays'->>v_run::text)::numeric into v_pay
      from jsonb_array_elements(v_config->'symbols') s where s->>'id' = v_first;
    if v_pay is not null then
      v_pay := v_pay * v_scale / 5;
      v_mult := v_mult + v_pay;
      v_wins := v_wins || jsonb_build_object('line', i - 1, 'symbol', v_first, 'count', v_run, 'multiplier', app.trunc4(v_pay));
    end if;
  end loop;

  v_stars := (select count(*) from unnest(v_grid) g where g = v_scatter);
  v_pay := (v_config->'scatter'->'pays'->>least(v_stars, 5)::text)::numeric;
  if v_stars >= 3 and v_pay is not null then
    v_mult := v_mult + v_pay * v_scale;
    v_wins := v_wins || jsonb_build_object('line', null, 'symbol', v_scatter, 'count', v_stars, 'multiplier', app.trunc4(v_pay * v_scale));
  end if;

  v_round := app.finish_round(v_round.id, v_mult,
    jsonb_build_object('grid', to_jsonb(v_grid), 'wins', v_wins),
    jsonb_build_object('grid', to_jsonb(v_grid), 'wins', v_wins));
  return app.round_view(v_round);
end $$;

-- -----------------------------------------------------------------------------
-- Catalogue
-- -----------------------------------------------------------------------------
insert into public.casino_games (id, provider_id, name, category, tags, edge_configurable, is_featured, is_new, sort_order, min_bet, max_bet, description, rules)
values
  ('jet', 'kometa_originals', 'Kometa Jet', 'originals', '{originals,crash}', true, true, true, 1, 10, 1000000,
   '{"sq":"Avioni ngrihet dhe shumëzuesi rritet – tërhiqu para se të fluturojë larg. Dy baste njëkohësisht.","en":"The jet takes off and the multiplier climbs – cash out before it flies away. Two bets at once."}',
   '{"sq":"Vendos një ose dy baste, secili me tërheqje automatike opsionale. Shumëzuesi rritet derisa avioni largohet (pika vendoset nga serveri, e verifikueshme). Çdo bast i patërhequr humbet. RTP = 1 − avantazhi.","en":"Place one or two bets, each with an optional auto cash-out. The multiplier rises until the jet flies away (point set by the server, provably fair). Any bet not cashed out is lost. RTP = 1 − edge."}'),
  ('slot_hot_fruits', 'kometa_originals', 'Hot Fruits 5', 'slots', '{slots,classic}', true, true, true, 4, 10, 1000000,
   '{"sq":"Slot klasik me fruta, 5 rrotulla dhe 5 linja. Yll scatter paguan kudo. Dyfisho fitimin me kartë.","en":"Classic fruit slot, 5 reels and 5 lines. Star scatter pays anywhere. Double your win with the card gamble."}',
   '{"sq":"Fitojnë simbolet e njëjta nga e majta në të djathtë në 5 linjat (qershia nga 2). 3+ yje kudo paguajnë × bastin total. Pas fitimit mund të luash kuq/zi. RTP = 1 − avantazhi.","en":"Matching symbols from the left on the 5 lines win (cherries from 2). 3+ stars anywhere pay × total bet. After a win you may gamble red/black. RTP = 1 − edge."}')
on conflict (id) do nothing;

insert into public.house_edge_settings (game_id, edge_bps, min_bps, max_bps) values
  ('jet', 300, 50, 1000), ('slot_hot_fruits', 400, 100, 1500)
on conflict (game_id) do nothing;

insert into public.game_configurations (game_id, config) values
  ('jet', '{}'::jsonb),
  ('slot_hot_fruits', '{"engine":"lines5","symbols":[
     {"id":"cherry","weight":24,"pays":{"2":1,"3":4,"4":10,"5":40}},
     {"id":"lemon","weight":20,"pays":{"3":4,"4":10,"5":40}},
     {"id":"orange","weight":20,"pays":{"3":4,"4":10,"5":40}},
     {"id":"plum","weight":20,"pays":{"3":4,"4":10,"5":40}},
     {"id":"grapes","weight":12,"pays":{"3":10,"4":40,"5":100}},
     {"id":"melon","weight":12,"pays":{"3":10,"4":40,"5":100}},
     {"id":"seven","weight":6,"pays":{"3":20,"4":200,"5":1000}}],
   "scatter":{"id":"star","weight":5,"pays":{"3":2,"4":10,"5":50}}}'::jsonb)
on conflict (game_id) do update set config = excluded.config, version = game_configurations.version + 1;

revoke execute on function public.jet_start(jsonb, text), public.jet_cashout(uuid, int), public.jet_status(uuid),
  public.play_lines(text, bigint, text), public.lines_paytable(text) from public, anon;
grant execute on function public.jet_start(jsonb, text), public.jet_cashout(uuid, int), public.jet_status(uuid),
  public.play_lines(text, bigint, text), public.lines_paytable(text) to authenticated;
