-- =============================================================================
-- KOMETA — "Cosmic Cascade": original 6×5 scatter-pays tumble slot with free
-- spins and multiplier orbs. Mirrors src/lib/slots/cascade.ts exactly; the
-- TypeScript copy is used for RTP calibration (Monte Carlo) and verification.
-- Integer weights + 32-bit draws make u·total < acc·2^32 exact on both sides.
-- =============================================================================

-- 32-bit integer draw #i of a seed pair (same bytes as app.pf_float).
create or replace function app.pf_u32(p_server_seed text, p_client_seed text, p_nonce bigint, p_index int)
returns bigint
language plpgsql immutable set search_path = public, extensions as $$
declare
  v_off int := (p_index % 8) * 4;
  v_h bytea;
begin
  v_h := extensions.hmac(convert_to(p_client_seed || ':' || p_nonce || ':' || (p_index / 8), 'UTF8'),
                         convert_to(p_server_seed, 'UTF8'), 'sha256');
  return (get_byte(v_h, v_off)::bigint << 24) + (get_byte(v_h, v_off + 1)::bigint << 16)
       + (get_byte(v_h, v_off + 2)::bigint << 8) + get_byte(v_h, v_off + 3)::bigint;
end $$;

-- One weighted cell. p_ids/p_w are the symbol list for base or free spins
-- (regular symbols, scatter, and in free spins the orb last).
create or replace function app.cascade_draw(
  p_server text, p_client text, p_nonce bigint, p_cursor int,
  p_ids text[], p_w int[], p_orb_v int[], p_orb_w int[],
  out o_sym text, out o_val int, out o_cursor int)
language plpgsql immutable set search_path = public, app as $$
declare
  v_total bigint := 0;
  v_acc bigint := 0;
  v_u bigint;
  i int;
begin
  for i in 1..cardinality(p_w) loop v_total := v_total + p_w[i]; end loop;
  v_u := app.pf_u32(p_server, p_client, p_nonce, p_cursor);
  o_cursor := p_cursor + 1;
  for i in 1..cardinality(p_ids) loop
    v_acc := v_acc + p_w[i];
    if v_u * v_total < v_acc * 4294967296 then o_sym := p_ids[i]; exit; end if;
  end loop;
  if o_sym is null then o_sym := p_ids[cardinality(p_ids)]; end if;
  if o_sym = 'orb' then
    v_total := 0; v_acc := 0;
    for i in 1..cardinality(p_orb_w) loop v_total := v_total + p_orb_w[i]; end loop;
    v_u := app.pf_u32(p_server, p_client, p_nonce, o_cursor);
    o_cursor := o_cursor + 1;
    for i in 1..cardinality(p_orb_v) loop
      v_acc := v_acc + p_orb_w[i];
      if v_u * v_total < v_acc * 4294967296 then o_val := p_orb_v[i]; exit; end if;
    end loop;
    if o_val is null then o_val := p_orb_v[cardinality(p_orb_v)]; end if;
  end if;
end $$;

-- One spin (with all tumbles). Cells are encoded "id" or "orb:<value>".
create or replace function app.cascade_spin(
  p_cfg jsonb, p_free boolean, p_server text, p_client text, p_nonce bigint, p_cursor int,
  out o_spin jsonb, out o_win numeric, out o_scatters int, out o_cursor int)
language plpgsql immutable set search_path = public, app as $$
declare
  v_cols int := (p_cfg->>'cols')::int;
  v_rows int := (p_cfg->>'rows')::int;
  v_min int := (p_cfg->>'min_count')::int;
  v_reg text[] := array(select s->>'id' from jsonb_array_elements(p_cfg->'symbols') with ordinality x(s, n) order by n);
  v_ids text[];
  v_w int[];
  v_orb_v int[] := array(select (o->>'v')::int from jsonb_array_elements(p_cfg->'orb'->'values') with ordinality x(o, n) order by n);
  v_orb_w int[] := array(select (o->>'w')::int from jsonb_array_elements(p_cfg->'orb'->'values') with ordinality x(o, n) order by n);
  v_scatter text := p_cfg->'scatter'->>'id';
  v_grid text[] := '{}';
  v_new text[];
  v_kept text[];
  v_fresh text[];
  v_steps jsonb := '[]'::jsonb;
  v_winners text[];
  v_step_win numeric;
  v_count int;
  v_sym jsonb;
  v_d record;
  v_orbs int := 0;
  c int; r int; t int; k int;
  v_cell text;
begin
  o_cursor := p_cursor;
  o_win := 0;
  if p_free then
    v_ids := v_reg || v_scatter || 'orb'::text;
    v_w := array(select (s->>'fs_weight')::int from jsonb_array_elements(p_cfg->'symbols') with ordinality x(s, n) order by n)
           || (p_cfg->'scatter'->>'fs_weight')::int || (p_cfg->'orb'->>'fs_weight')::int;
  else
    v_ids := v_reg || v_scatter;
    v_w := array(select (s->>'weight')::int from jsonb_array_elements(p_cfg->'symbols') with ordinality x(s, n) order by n)
           || (p_cfg->'scatter'->>'weight')::int;
  end if;

  for k in 1..v_cols * v_rows loop
    select * into v_d from app.cascade_draw(p_server, p_client, p_nonce, o_cursor, v_ids, v_w, v_orb_v, v_orb_w);
    o_cursor := v_d.o_cursor;
    v_grid := v_grid || case when v_d.o_sym = 'orb' then 'orb:' || v_d.o_val else v_d.o_sym end;
  end loop;

  for t in 1..(p_cfg->>'max_tumbles')::int loop
    v_winners := '{}';
    v_step_win := 0;
    for v_sym in select * from jsonb_array_elements(p_cfg->'symbols') loop
      select count(*) into v_count from unnest(v_grid) g where g = v_sym->>'id';
      if v_count >= v_min then
        v_winners := v_winners || (v_sym->>'id');
        v_step_win := v_step_win + (v_sym->'pays'->>(case when v_count >= 12 then 2 when v_count >= 10 then 1 else 0 end))::numeric;
      end if;
    end loop;
    exit when cardinality(v_winners) = 0;
    o_win := o_win + v_step_win;
    v_steps := v_steps || jsonb_build_object('grid', to_jsonb(v_grid), 'winners', to_jsonb(v_winners), 'win', v_step_win);
    v_new := '{}';
    for c in 0..v_cols - 1 loop
      v_kept := '{}';
      for r in 1..v_rows loop
        v_cell := v_grid[c * v_rows + r];
        if not (v_cell = any (v_winners)) then v_kept := v_kept || v_cell; end if;
      end loop;
      v_fresh := '{}';
      for k in 1..v_rows - cardinality(v_kept) loop
        select * into v_d from app.cascade_draw(p_server, p_client, p_nonce, o_cursor, v_ids, v_w, v_orb_v, v_orb_w);
        o_cursor := v_d.o_cursor;
        v_fresh := v_fresh || case when v_d.o_sym = 'orb' then 'orb:' || v_d.o_val else v_d.o_sym end;
      end loop;
      v_new := v_new || v_fresh || v_kept;
    end loop;
    v_grid := v_new;
  end loop;

  select count(*) into o_scatters from unnest(v_grid) g where g = v_scatter;
  if p_free then
    select coalesce(sum(split_part(g, ':', 2)::int), 0) into v_orbs from unnest(v_grid) g where g like 'orb:%';
    if o_win > 0 and v_orbs > 0 then o_win := o_win * v_orbs; end if;
  end if;
  o_spin := jsonb_build_object('steps', v_steps, 'final', to_jsonb(v_grid), 'win', o_win,
                               'scatters', o_scatters, 'orbs', v_orbs, 'free', p_free);
end $$;

create or replace function public.play_cascade(p_game_id text, p_stake bigint, p_idempotency_key text default null)
returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_cfg jsonb;
  v_round public.game_rounds;
  v_server text;
  v_cursor int := 0;
  v_s record;
  v_spins jsonb := '[]'::jsonb;
  v_raw numeric := 0;
  v_scatter_win numeric := 0;
  v_left int := 0;
  v_played int := 0;
  v_scale numeric;
  v_mult numeric;
begin
  select c.config into v_cfg from public.game_configurations c join public.casino_games g on g.id = c.game_id
   where c.game_id = p_game_id and g.category = 'slots' and c.config->>'engine' = 'cascade';
  if not found then perform app.fail('GAME_UNAVAILABLE'); end if;
  v_round := app.begin_round(v_me, p_game_id, p_stake, '{}'::jsonb, p_idempotency_key);
  if v_round.status <> 'active' then return app.round_view(v_round); end if;
  select server_seed into v_server from app.seed_secrets where seed_id = v_round.seed_id;

  select * into v_s from app.cascade_spin(v_cfg, false, v_server, v_round.client_seed, v_round.nonce, v_cursor);
  v_cursor := v_s.o_cursor;
  v_spins := v_spins || v_s.o_spin;
  v_raw := v_s.o_win;
  if v_s.o_scatters >= (v_cfg->'scatter'->>'trigger')::int then
    v_scatter_win := coalesce((v_cfg->'scatter'->'pays'->>least(v_s.o_scatters, 6)::text)::numeric, 0);
    v_raw := v_raw + v_scatter_win;
    v_left := (v_cfg->'scatter'->>'spins')::int;
    while v_left > 0 and v_played < (v_cfg->>'max_free_spins')::int loop
      select * into v_s from app.cascade_spin(v_cfg, true, v_server, v_round.client_seed, v_round.nonce, v_cursor);
      v_cursor := v_s.o_cursor;
      v_spins := v_spins || v_s.o_spin;
      v_raw := v_raw + v_s.o_win;
      v_left := v_left - 1;
      v_played := v_played + 1;
      if v_s.o_scatters >= (v_cfg->'scatter'->>'retrigger')::int then v_left := v_left + (v_cfg->'scatter'->>'extra')::int; end if;
    end loop;
  end if;

  v_scale := (1 - app.edge(v_round)) / (v_cfg->>'ev_raw')::numeric;
  v_mult := least((v_cfg->>'max_win')::numeric, v_raw * v_scale);
  v_round := app.finish_round(v_round.id, v_mult,
    jsonb_build_object('spins', v_spins, 'raw', v_raw, 'scale', v_scale, 'scatter_win', v_scatter_win, 'free_spins', v_played),
    jsonb_build_object('raw', v_raw, 'free_spins', v_played));
  return app.round_view(v_round);
end $$;

-- Pay table for the UI: scaled multiples of the stake for the current edge.
create or replace function public.cascade_paytable(p_game_id text) returns jsonb
language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object(
    'scale', (1 - app.game_edge_bps(p_game_id) / 10000.0) / (c.config->>'ev_raw')::numeric,
    'symbols', (select jsonb_agg(jsonb_build_object('id', s->>'id', 'pays', s->'pays')) from jsonb_array_elements(c.config->'symbols') s),
    'scatter', c.config->'scatter', 'orb_values', c.config->'orb'->'values', 'max_win', c.config->'max_win')
  from public.game_configurations c where c.game_id = p_game_id and c.config->>'engine' = 'cascade'
$$;

-- The classic 3×3 engine must never run a cascade configuration.
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
   where c.game_id = p_game_id and g.category = 'slots' and c.config->>'engine' is null;
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


insert into public.casino_games (id, provider_id, name, category, tags, edge_configurable, is_featured, is_new, sort_order, min_bet, max_bet, description, rules)
values ('slot_cosmic_cascade', 'kometa_originals', 'Cosmic Cascade', 'slots', '{slots}', true, true, true, 5, 20, 1000000,
  '{"sq":"Slot origjinal 6×5 – 8+ simbole të njëjta kudo paguajnë, simbolet bien dhe zëvendësohen.","en":"Original 6×5 slot – 8+ matching symbols anywhere pay, winners tumble away."}',
  '{"sq":"4+ vrima të zeza japin 10 rrotullime falas. Gjatë tyre bien yje shumëzues 2×–100× që shumëzojnë fitimin. Fitimi maksimal 5 000×. RTP = 1 − avantazhi.","en":"4+ black holes award 10 free spins. During them star orbs (2×–100×) multiply each winning spin. Max win 5,000×. RTP = 1 − edge."}')
on conflict (id) do nothing;

insert into public.house_edge_settings (game_id, edge_bps, min_bps, max_bps) values ('slot_cosmic_cascade', 400, 100, 1500)
on conflict (game_id) do nothing;

insert into public.game_configurations (game_id, config) values ('slot_cosmic_cascade', '{"engine":"cascade","cols":6,"rows":5,"min_count":8,"symbols":[{"id":"nova","weight":40,"fs_weight":40,"pays":[10,25,50]},{"id":"ringed","weight":60,"fs_weight":60,"pays":[2.5,10,25]},{"id":"rocket","weight":80,"fs_weight":80,"pays":[2,5,15]},{"id":"helmet","weight":90,"fs_weight":90,"pays":[1.5,2,12]},{"id":"gem_red","weight":110,"fs_weight":110,"pays":[1,1.5,10]},{"id":"gem_violet","weight":120,"fs_weight":120,"pays":[0.8,1.2,8]},{"id":"gem_green","weight":130,"fs_weight":130,"pays":[0.5,1,5]},{"id":"gem_blue","weight":140,"fs_weight":140,"pays":[0.4,0.9,4]},{"id":"gem_amber","weight":150,"fs_weight":150,"pays":[0.25,0.75,2]}],"scatter":{"id":"blackhole","weight":18,"fs_weight":22,"pays":{"4":3,"5":5,"6":100},"trigger":4,"spins":10,"retrigger":3,"extra":5},"orb":{"id":"orb","fs_weight":32,"values":[{"v":2,"w":40},{"v":3,"w":22},{"v":5,"w":15},{"v":10,"w":12},{"v":25,"w":7},{"v":50,"w":3},{"v":100,"w":1}]},"max_win":5000,"max_free_spins":50,"max_tumbles":50,"ev_raw":0.32684}'::jsonb)
on conflict (game_id) do update set config = excluded.config, version = game_configurations.version + 1;

revoke execute on function public.play_cascade(text, bigint, text), public.cascade_paytable(text) from public, anon;
grant execute on function public.play_cascade(text, bigint, text), public.cascade_paytable(text), public.play_slot(text, bigint, text) to authenticated;
