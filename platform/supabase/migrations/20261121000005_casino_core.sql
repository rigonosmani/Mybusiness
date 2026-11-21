-- =============================================================================
-- KOMETA — Phase 5/6: casino core, provably-fair engine, house edge
--
-- All outcomes are produced inside PostgreSQL from a provably-fair seed pair:
--   float_i = bytes of HMAC_SHA256(key = server_seed, msg = "client_seed:nonce:round")
--   where round = i / 8 and the 4 bytes at offset (i % 8) * 4 form
--   b0/256 + b1/256^2 + b2/256^3 + b3/256^4  ∈ [0, 1).
-- The server seed is generated with gen_random_bytes (CSPRNG), only its SHA-256
-- hash is shown until the player rotates the seed pair, after which it is revealed
-- and every past round can be re-computed in the browser.
-- =============================================================================

create table public.casino_providers (
  id                 text primary key check (id ~ '^[a-z0-9_]{2,48}$'),
  name               text not null,
  kind               text not null check (kind in ('in_house', 'aggregator', 'live_studio')),
  status             text not null default 'not_configured'
                     check (status in ('active', 'disabled', 'not_configured')),
  wallet_mode        text not null default 'internal' check (wallet_mode in ('internal', 'seamless_callback')),
  api_base_url       text,
  license_reference  text,
  notes              text,
  config             jsonb not null default '{}'::jsonb,   -- never secrets
  created_at         timestamptz not null default now()
);

create table public.casino_games (
  id                 text primary key check (id ~ '^[a-z0-9_]{2,48}$'),
  provider_id        text not null references public.casino_providers (id),
  name               text not null,
  category           text not null check (category in ('originals', 'slots', 'table', 'live', 'poker')),
  tags               text[] not null default '{}',
  description        jsonb not null default '{}'::jsonb,   -- {"sq": "...", "en": "..."}
  rules              jsonb not null default '{}'::jsonb,   -- {"sq": "...", "en": "..."}
  thumbnail          text,
  enabled            boolean not null default true,
  is_featured        boolean not null default false,
  is_new             boolean not null default false,
  edge_configurable  boolean not null default false,
  fixed_edge_note    text,           -- for games whose edge comes from the rules
  certified_rtp      numeric(6, 3),  -- external providers: the provider's certified RTP
  external_game_id   text,
  min_bet            bigint not null default 1 check (min_bet > 0),
  max_bet            bigint not null default 1000000,
  sort_order         int not null default 100,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (max_bet >= min_bet)
);
create trigger casino_games_touch before update on public.casino_games for each row execute function app.touch_updated_at();

create table public.game_configurations (
  game_id    text primary key references public.casino_games (id) on delete cascade,
  config     jsonb not null default '{}'::jsonb,
  version    int not null default 1,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

create table public.house_edge_settings (
  game_id    text primary key references public.casino_games (id) on delete cascade,
  edge_bps   int not null,
  min_bps    int not null default 50,
  max_bps    int not null default 1000,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  check (min_bps >= 0 and max_bps <= 2500 and min_bps <= max_bps),
  check (edge_bps between min_bps and max_bps)
);

create table public.house_edge_history (
  id         bigint generated always as identity primary key,
  game_id    text not null references public.casino_games (id),
  old_bps    int,
  new_bps    int not null,
  changed_by uuid not null references public.profiles (id),
  changed_at timestamptz not null default now()
);
create trigger house_edge_history_immutable before update or delete on public.house_edge_history
  for each row execute function app.forbid_mutation();

create table public.favorite_games (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  game_id    text not null references public.casino_games (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

-- Provably-fair seed pairs. The server seed itself lives in app.seed_secrets
-- (not exposed) until the pair is rotated.
create table public.fairness_seeds (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles (id) on delete cascade,
  server_seed_hash     text not null,
  client_seed          text not null check (client_seed ~ '^[A-Za-z0-9_\-]{1,64}$'),
  nonce                bigint not null default 0,
  status               text not null default 'active' check (status in ('active', 'revealed')),
  revealed_server_seed text,
  created_at           timestamptz not null default now(),
  revealed_at          timestamptz
);
create unique index fairness_one_active on public.fairness_seeds (user_id) where status = 'active';

create table app.seed_secrets (
  seed_id     uuid primary key references public.fairness_seeds (id) on delete cascade,
  server_seed text not null
);

create table public.game_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id),
  tenant_id        uuid not null,
  game_id          text not null references public.casino_games (id),
  provider_id      text not null references public.casino_providers (id),
  token_hash       text unique,        -- SHA-256 of the launch token given to an external provider
  status           text not null default 'active' check (status in ('active', 'closed', 'expired')),
  started_at       timestamptz not null default now(),
  expires_at       timestamptz,
  ended_at         timestamptz
);
create index game_sessions_user_idx on public.game_sessions (user_id, started_at desc);

create type public.round_status as enum ('active', 'won', 'lost', 'push', 'cancelled');

create table public.game_rounds (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id),
  tenant_id        uuid not null,
  game_id          text not null references public.casino_games (id),
  provider_id      text not null references public.casino_providers (id),
  session_id       uuid references public.game_sessions (id),
  seed_id          uuid references public.fairness_seeds (id),
  server_seed_hash text,
  client_seed      text,
  nonce            bigint,
  edge_bps         int not null default 0,         -- frozen at round start
  config_version   int,
  stake            bigint not null check (stake > 0),
  payout           bigint not null default 0,
  multiplier       numeric(18, 4) not null default 0,
  status           public.round_status not null default 'active',
  params           jsonb not null default '{}'::jsonb,
  state            jsonb not null default '{}'::jsonb,
  idempotency_key  text,
  external_round_id text,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,
  unique (user_id, idempotency_key)
);
create index game_rounds_user_idx on public.game_rounds (user_id, created_at desc);
create index game_rounds_tenant_idx on public.game_rounds (tenant_id, created_at desc);
create index game_rounds_active_idx on public.game_rounds (user_id, game_id) where status = 'active';
create unique index game_rounds_external_idx on public.game_rounds (provider_id, external_round_id) where external_round_id is not null;

create table app.round_secrets (
  round_id uuid primary key references public.game_rounds (id) on delete cascade,
  secret   jsonb not null default '{}'::jsonb
);

create table public.game_results (
  id         uuid primary key default gen_random_uuid(),
  round_id   uuid not null unique references public.game_rounds (id),
  user_id    uuid not null,
  tenant_id  uuid not null,
  game_id    text not null,
  stake      bigint not null,
  payout     bigint not null,
  multiplier numeric(18, 4) not null,
  outcome    jsonb not null,
  created_at timestamptz not null default now()
);
create index game_results_user_idx on public.game_results (user_id, created_at desc);
create index game_results_tenant_idx on public.game_results (tenant_id, created_at desc);
create trigger game_results_immutable before update or delete on public.game_results
  for each row execute function app.forbid_mutation();

-- Completed rounds are immutable (stake, payout and outcome are final).
create or replace function app.protect_round() returns trigger
language plpgsql as $$
begin
  if old.status <> 'active' then
    raise exception 'ROUND_FINALIZED' using errcode = 'P0001';
  end if;
  if new.edge_bps <> old.edge_bps or new.nonce is distinct from old.nonce or new.user_id <> old.user_id then
    raise exception 'ROUND_TERMS_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger game_rounds_protect before update on public.game_rounds for each row execute function app.protect_round();
create trigger game_rounds_no_delete before delete on public.game_rounds for each row execute function app.forbid_mutation();

-- External provider wallet callbacks (idempotent by provider transaction id).
create table public.provider_transactions (
  id                 uuid primary key default gen_random_uuid(),
  provider_id        text not null references public.casino_providers (id),
  provider_tx_id     text not null,
  round_id           uuid references public.game_rounds (id),
  action             text not null check (action in ('debit', 'credit', 'rollback')),
  amount             bigint not null check (amount >= 0),
  ledger_tx_id       uuid references public.ledger_transactions (id),
  status             text not null check (status in ('ok', 'rejected')),
  error              text,
  created_at         timestamptz not null default now(),
  unique (provider_id, provider_tx_id)
);

-- -----------------------------------------------------------------------------
-- Provably fair primitives
-- -----------------------------------------------------------------------------
create or replace function app.pf_float(p_server_seed text, p_client_seed text, p_nonce bigint, p_index int)
returns double precision
language plpgsql immutable set search_path = public, extensions as $$
declare
  v_round int := p_index / 8;
  v_off int := (p_index % 8) * 4;
  v_h bytea;
begin
  v_h := extensions.hmac(convert_to(p_client_seed || ':' || p_nonce || ':' || v_round, 'UTF8'),
                         convert_to(p_server_seed, 'UTF8'), 'sha256');
  return (get_byte(v_h, v_off)::numeric / 256
        + get_byte(v_h, v_off + 1)::numeric / 65536
        + get_byte(v_h, v_off + 2)::numeric / 16777216
        + get_byte(v_h, v_off + 3)::numeric / 4294967296)::double precision;
end $$;

-- Float #i of a given round.
create or replace function app.rf(p_round public.game_rounds, p_index int) returns double precision
language sql stable security definer set search_path = public, app as $$
  select app.pf_float(s.server_seed, p_round.client_seed, p_round.nonce, p_index)
  from app.seed_secrets s where s.seed_id = p_round.seed_id
$$;

create or replace function app.new_seed(p_user uuid, p_client_seed text) returns public.fairness_seeds
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_server text := encode(extensions.gen_random_bytes(32), 'hex');
  v_seed public.fairness_seeds;
begin
  insert into public.fairness_seeds (user_id, server_seed_hash, client_seed)
  values (p_user, encode(extensions.digest(v_server, 'sha256'), 'hex'),
          coalesce(nullif(p_client_seed, ''), encode(extensions.gen_random_bytes(8), 'hex')))
  returning * into v_seed;
  insert into app.seed_secrets (seed_id, server_seed) values (v_seed.id, v_server);
  return v_seed;
end $$;

create or replace function public.get_fairness() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_seed public.fairness_seeds;
begin
  select * into v_seed from public.fairness_seeds where user_id = v_me.id and status = 'active';
  if not found then
    v_seed := app.new_seed(v_me.id, null);
  end if;
  return jsonb_build_object(
    'active', jsonb_build_object('id', v_seed.id, 'server_seed_hash', v_seed.server_seed_hash,
                                 'client_seed', v_seed.client_seed, 'nonce', v_seed.nonce),
    'revealed', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'server_seed_hash', server_seed_hash,
                                          'server_seed', revealed_server_seed, 'client_seed', client_seed,
                                          'nonce', nonce, 'revealed_at', revealed_at) order by revealed_at desc)
      from (select * from public.fairness_seeds where user_id = v_me.id and status = 'revealed'
            order by revealed_at desc limit 20) r), '[]'::jsonb));
end $$;

-- Rotate the seed pair: reveals the current server seed, starts a new pair.
create or replace function public.rotate_seed(p_new_client_seed text) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_old public.fairness_seeds;
  v_secret text;
  v_new public.fairness_seeds;
begin
  if p_new_client_seed is not null and p_new_client_seed !~ '^[A-Za-z0-9_\-]{1,64}$' then
    perform app.fail('INVALID_CLIENT_SEED');
  end if;
  if exists (select 1 from public.game_rounds where user_id = v_me.id and status = 'active' and seed_id is not null) then
    perform app.fail('ACTIVE_ROUND_EXISTS');
  end if;
  select * into v_old from public.fairness_seeds where user_id = v_me.id and status = 'active' for update;
  if found then
    select server_seed into v_secret from app.seed_secrets where seed_id = v_old.id;
    update public.fairness_seeds set status = 'revealed', revealed_server_seed = v_secret, revealed_at = now()
     where id = v_old.id;
  end if;
  v_new := app.new_seed(v_me.id, p_new_client_seed);
  return jsonb_build_object(
    'previous', case when v_old.id is null then null else jsonb_build_object(
      'server_seed', v_secret, 'server_seed_hash', v_old.server_seed_hash,
      'client_seed', v_old.client_seed, 'nonce', v_old.nonce) end,
    'active', jsonb_build_object('server_seed_hash', v_new.server_seed_hash,
                                 'client_seed', v_new.client_seed, 'nonce', v_new.nonce));
end $$;

-- -----------------------------------------------------------------------------
-- House edge
-- -----------------------------------------------------------------------------
create or replace function app.game_edge_bps(p_game text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select edge_bps from public.house_edge_settings where game_id = p_game), 0)
$$;

create or replace function public.admin_set_house_edge(p_game_id text, p_edge_bps int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['super_admin']::public.app_role[]);
  v_cur public.house_edge_settings;
begin
  select * into v_cur from public.house_edge_settings where game_id = p_game_id for update;
  if not found then
    perform app.fail('EDGE_NOT_CONFIGURABLE', 'this game''s edge is defined by its rules or provider');
  end if;
  if p_edge_bps is null or p_edge_bps < v_cur.min_bps or p_edge_bps > v_cur.max_bps then
    perform app.fail('EDGE_OUT_OF_RANGE', format('allowed %s–%s bps', v_cur.min_bps, v_cur.max_bps));
  end if;
  update public.house_edge_settings set edge_bps = p_edge_bps, updated_by = v_me.id, updated_at = now()
   where game_id = p_game_id;
  insert into public.house_edge_history (game_id, old_bps, new_bps, changed_by)
  values (p_game_id, v_cur.edge_bps, p_edge_bps, v_me.id);
  perform app.audit('house_edge.update', 'game', p_game_id, 'platform', null,
                    jsonb_build_object('old_bps', v_cur.edge_bps, 'new_bps', p_edge_bps));
  return jsonb_build_object('game_id', p_game_id, 'edge_bps', p_edge_bps);
end $$;

-- Apply one edge to every configurable game (clamped to each game's range).
create or replace function public.admin_set_global_house_edge(p_edge_bps int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['super_admin']::public.app_role[]);
  v_g record;
  v_new int;
  v_n int := 0;
begin
  if p_edge_bps is null or p_edge_bps < 0 or p_edge_bps > 2500 then
    perform app.fail('EDGE_OUT_OF_RANGE');
  end if;
  for v_g in select * from public.house_edge_settings for update loop
    v_new := least(greatest(p_edge_bps, v_g.min_bps), v_g.max_bps);
    if v_new <> v_g.edge_bps then
      update public.house_edge_settings set edge_bps = v_new, updated_by = v_me.id, updated_at = now()
       where game_id = v_g.game_id;
      insert into public.house_edge_history (game_id, old_bps, new_bps, changed_by)
      values (v_g.game_id, v_g.edge_bps, v_new, v_me.id);
      v_n := v_n + 1;
    end if;
  end loop;
  update public.platform_settings set value = to_jsonb(p_edge_bps), updated_by = v_me.id, updated_at = now()
   where key = 'casino.default_house_edge_bps';
  perform app.audit('house_edge.global', 'platform', null, 'platform', null,
                    jsonb_build_object('edge_bps', p_edge_bps, 'games_changed', v_n));
  return jsonb_build_object('games_changed', v_n);
end $$;

create or replace function public.admin_set_game_enabled(p_game_id text, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['super_admin']::public.app_role[]);
begin
  update public.casino_games set enabled = p_enabled where id = p_game_id;
  if not found then perform app.fail('GAME_NOT_FOUND'); end if;
  perform app.audit('game.enabled', 'game', p_game_id, 'platform', null, jsonb_build_object('enabled', p_enabled));
  return jsonb_build_object('game_id', p_game_id, 'enabled', p_enabled);
end $$;

create or replace function public.admin_update_setting(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['super_admin']::public.app_role[]);
  v_cur public.platform_settings;
begin
  select * into v_cur from public.platform_settings where key = p_key for update;
  if not found then perform app.fail('SETTING_NOT_FOUND'); end if;
  if v_cur.locked then perform app.fail('SETTING_LOCKED'); end if;
  if jsonb_typeof(p_value) <> jsonb_typeof(v_cur.value) then perform app.fail('SETTING_TYPE_MISMATCH'); end if;
  if jsonb_typeof(p_value) = 'number' and (p_value #>> '{}')::numeric < 0 then perform app.fail('SETTING_INVALID'); end if;
  if p_key = 'sportsbook.margin_bps' and (p_value #>> '{}')::int > 2000 then perform app.fail('SETTING_INVALID'); end if;
  update public.platform_settings set value = p_value, updated_by = v_me.id, updated_at = now() where key = p_key;
  perform app.audit('setting.update', 'setting', p_key, 'platform', null,
                    jsonb_build_object('old', v_cur.value, 'new', p_value));
  return jsonb_build_object('key', p_key, 'value', p_value);
end $$;

create or replace function public.toggle_favorite(p_game_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
begin
  if exists (select 1 from public.favorite_games where user_id = v_me.id and game_id = p_game_id) then
    delete from public.favorite_games where user_id = v_me.id and game_id = p_game_id;
    return jsonb_build_object('favorite', false);
  end if;
  insert into public.favorite_games (user_id, game_id) values (v_me.id, p_game_id);
  return jsonb_build_object('favorite', true);
end $$;

-- -----------------------------------------------------------------------------
-- Round engine (internal)
-- -----------------------------------------------------------------------------
create or replace function app.round_view(p_round public.game_rounds) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'round_id', p_round.id, 'game_id', p_round.game_id, 'status', p_round.status,
    'stake', p_round.stake, 'payout', p_round.payout, 'multiplier', p_round.multiplier,
    'params', p_round.params, 'state', p_round.state, 'edge_bps', p_round.edge_bps,
    'nonce', p_round.nonce, 'client_seed', p_round.client_seed, 'server_seed_hash', p_round.server_seed_hash,
    'created_at', p_round.created_at, 'completed_at', p_round.completed_at,
    'balance', (select balance from public.ledger_accounts where id = app.wallet_account(p_round.user_id)))
$$;

-- Validates and opens a round: debits the stake and consumes one nonce.
-- Returns null when the idempotency key was already used (caller replays).
create or replace function app.begin_round(
  p_user public.profiles, p_game text, p_stake bigint, p_params jsonb, p_idempotency_key text,
  p_uses_seed boolean default true
) returns public.game_rounds
language plpgsql security definer set search_path = public as $$
declare
  v_game public.casino_games;
  v_provider public.casino_providers;
  v_seed public.fairness_seeds;
  v_round public.game_rounds;
  v_version int;
begin
  if p_idempotency_key is not null then
    if char_length(p_idempotency_key) not between 8 and 128 then perform app.fail('IDEMPOTENCY_KEY_REQUIRED'); end if;
    select * into v_round from public.game_rounds where user_id = p_user.id and idempotency_key = p_idempotency_key;
    if found then
      if v_round.game_id <> p_game then perform app.fail('IDEMPOTENCY_KEY_REUSED'); end if;
      return v_round;
    end if;
  end if;

  if app.setting_bool('platform.maintenance_mode', false) then perform app.fail('MAINTENANCE'); end if;
  select * into v_game from public.casino_games where id = p_game;
  if not found or not v_game.enabled then perform app.fail('GAME_UNAVAILABLE'); end if;
  select * into v_provider from public.casino_providers where id = v_game.provider_id;
  if v_provider.status <> 'active' then perform app.fail('GAME_UNAVAILABLE'); end if;

  if p_stake is null or p_stake < greatest(v_game.min_bet, app.setting_int('casino.min_bet_units', 1)) then
    perform app.fail('STAKE_TOO_LOW');
  end if;
  if p_stake > least(v_game.max_bet, app.setting_int('casino.max_bet_units', 1000000)) then
    perform app.fail('STAKE_TOO_HIGH');
  end if;
  perform app.enforce_rate_limit('game:' || p_user.id, 40, 10);
  perform app.assert_can_wager(p_user.id, p_stake);

  if p_uses_seed then
    select * into v_seed from public.fairness_seeds where user_id = p_user.id and status = 'active' for update;
    if not found then
      v_seed := app.new_seed(p_user.id, null);
      perform 1 from public.fairness_seeds where id = v_seed.id for update;
    end if;
    update public.fairness_seeds set nonce = nonce + 1 where id = v_seed.id;
  end if;

  select version into v_version from public.game_configurations where game_id = p_game;

  insert into public.game_rounds (user_id, tenant_id, game_id, provider_id, seed_id, server_seed_hash, client_seed,
                                  nonce, edge_bps, config_version, stake, params, idempotency_key)
  values (p_user.id, p_user.tenant_id, p_game, v_game.provider_id, v_seed.id, v_seed.server_seed_hash,
          v_seed.client_seed, v_seed.nonce, app.game_edge_bps(p_game), v_version, p_stake,
          coalesce(p_params, '{}'::jsonb), p_idempotency_key)
  returning * into v_round;
  insert into app.round_secrets (round_id) values (v_round.id);

  perform app.move_credits('game_stake', p_user.id, null,
    app.wallet_account(p_user.id), app.system_account('SYS_HOUSE_CASINO'), p_stake,
    'round:' || v_round.id, null, p_user.tenant_id, jsonb_build_object('game', p_game));
  return v_round;
end $$;

-- Extra stake within an active round (blackjack double).
create or replace function app.add_stake(p_round public.game_rounds, p_amount bigint) returns public.game_rounds
language plpgsql security definer set search_path = public as $$
declare
  v_round public.game_rounds;
begin
  perform app.assert_can_wager(p_round.user_id, p_amount);
  perform app.move_credits('game_stake', p_round.user_id, null,
    app.wallet_account(p_round.user_id), app.system_account('SYS_HOUSE_CASINO'), p_amount,
    'round:' || p_round.id, 'additional stake', p_round.tenant_id, jsonb_build_object('game', p_round.game_id));
  update public.game_rounds set stake = stake + p_amount where id = p_round.id returning * into v_round;
  return v_round;
end $$;

-- Completes a round: pays stake * multiplier (rounded down) and records the result.
create or replace function app.finish_round(
  p_round_id uuid, p_multiplier numeric, p_state jsonb, p_outcome jsonb
) returns public.game_rounds
language plpgsql security definer set search_path = public, app as $$
declare
  v_round public.game_rounds;
  v_mult numeric := greatest(0, floor(coalesce(p_multiplier, 0) * 10000) / 10000);
  v_payout bigint;
  v_status public.round_status;
begin
  select * into v_round from public.game_rounds where id = p_round_id for update;
  if v_round.status <> 'active' then perform app.fail('ROUND_FINALIZED'); end if;
  v_payout := least(floor(v_round.stake * v_mult)::bigint, app.setting_int('casino.max_payout_units', 100000000));
  v_status := case when v_payout > v_round.stake then 'won' when v_payout = v_round.stake then 'push' else 'lost' end;

  if v_payout > 0 then
    perform app.move_credits('game_payout', null, 'round-payout:' || v_round.id,
      app.system_account('SYS_HOUSE_CASINO'), app.wallet_account(v_round.user_id), v_payout,
      'round:' || v_round.id, null, v_round.tenant_id, jsonb_build_object('game', v_round.game_id));
  end if;

  update public.game_rounds
     set status = v_status, payout = v_payout, multiplier = v_mult,
         state = coalesce(p_state, state), completed_at = now()
   where id = p_round_id
  returning * into v_round;

  insert into public.game_results (round_id, user_id, tenant_id, game_id, stake, payout, multiplier, outcome)
  values (v_round.id, v_round.user_id, v_round.tenant_id, v_round.game_id, v_round.stake, v_payout, v_mult,
          coalesce(p_outcome, '{}'::jsonb));
  return v_round;
end $$;

create or replace function app.load_active_round(p_round_id uuid, p_game text) returns public.game_rounds
language plpgsql security definer set search_path = public as $$
declare
  v_round public.game_rounds;
begin
  select * into v_round from public.game_rounds
   where id = p_round_id and user_id = auth.uid() and game_id = p_game for update;
  if not found then perform app.fail('ROUND_NOT_FOUND'); end if;
  return v_round;
end $$;

create or replace function app.round_secret(p_round uuid) returns jsonb
language sql stable security definer set search_path = app as $$
  select secret from app.round_secrets where round_id = p_round
$$;

create or replace function app.set_round_secret(p_round uuid, p_secret jsonb) returns void
language sql security definer set search_path = app as $$
  update app.round_secrets set secret = p_secret where round_id = p_round
$$;

-- Current active round of a stateful game (to resume after reload).
create or replace function public.get_active_round(p_game_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_round public.game_rounds;
begin
  select * into v_round from public.game_rounds
   where user_id = v_me.id and game_id = p_game_id and status = 'active'
   order by created_at desc limit 1;
  if not found then return null; end if;
  return app.round_view(v_round);
end $$;

-- Exact binomial coefficient.
create or replace function app.choose(n int, k int) returns numeric
language plpgsql immutable as $$
declare
  r numeric := 1;
  i int;
begin
  if k < 0 or k > n then return 0; end if;
  for i in 1..least(k, n - k) loop
    r := r * (n - least(k, n - k) + i) / i;
  end loop;
  return round(r);
end $$;

-- Fisher–Yates: first p_count values of a shuffled 0..p_n-1 using floats from p_offset.
create or replace function app.pf_shuffle(p_round public.game_rounds, p_n int, p_count int, p_offset int)
returns int[]
language plpgsql stable security definer set search_path = public, app as $$
declare
  v_pool int[] := array(select generate_series(0, p_n - 1));
  v_out int[] := '{}';
  v_idx int;
  i int;
begin
  for i in 0..p_count - 1 loop
    v_idx := floor(app.rf(p_round, p_offset + i) * (p_n - i))::int + 1;
    v_out := v_out || v_pool[v_idx];
    v_pool := v_pool[1:v_idx - 1] || v_pool[v_idx + 1:];
  end loop;
  return v_out;
end $$;

-- -----------------------------------------------------------------------------
-- Licensed provider integration (architecture; no provider is configured)
-- -----------------------------------------------------------------------------
-- Creates a session for an external game. Returns a one-time launch token that
-- the `casino-launch` Edge Function hands to the provider. Refuses when the
-- provider is not configured, so nothing pretends to be integrated.
create or replace function public.casino_create_session(p_game_id text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_game public.casino_games;
  v_provider public.casino_providers;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_session uuid;
begin
  select * into v_game from public.casino_games where id = p_game_id and enabled;
  if not found then perform app.fail('GAME_UNAVAILABLE'); end if;
  select * into v_provider from public.casino_providers where id = v_game.provider_id;
  if v_provider.kind = 'in_house' then perform app.fail('NOT_AN_EXTERNAL_GAME'); end if;
  if v_provider.status <> 'active' then perform app.fail('PROVIDER_NOT_CONFIGURED'); end if;
  insert into public.game_sessions (user_id, tenant_id, game_id, provider_id, token_hash, expires_at)
  values (v_me.id, v_me.tenant_id, p_game_id, v_provider.id,
          encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '4 hours')
  returning id into v_session;
  return jsonb_build_object('session_id', v_session, 'launch_token', v_token,
                            'provider_id', v_provider.id, 'external_game_id', v_game.external_game_id);
end $$;

-- Seamless-wallet callback handler. Called by the Edge Function after it has
-- verified the provider's request signature. Idempotent per provider tx id.
create or replace function public.svc_provider_wallet(
  p_provider text, p_token text, p_action text, p_provider_tx_id text, p_round_ref text,
  p_amount bigint, p_ref_tx_id text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_session public.game_sessions;
  v_existing public.provider_transactions;
  v_round public.game_rounds;
  v_user public.profiles;
  v_ledger uuid;
  v_orig public.provider_transactions;
begin
  select * into v_existing from public.provider_transactions where provider_id = p_provider and provider_tx_id = p_provider_tx_id;
  if found then
    return jsonb_build_object('status', v_existing.status, 'duplicate', true,
      'balance', (select balance from public.ledger_accounts a join public.game_rounds r on a.owner_id = r.user_id
                  where r.id = v_existing.round_id and a.account_type = 'user_wallet'));
  end if;
  select * into v_session from public.game_sessions
   where provider_id = p_provider and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if not found or v_session.status <> 'active' or v_session.expires_at < now() then
    perform app.fail('SESSION_INVALID');
  end if;
  select * into v_user from public.profiles where id = v_session.user_id;
  if p_amount is null or p_amount < 0 then perform app.fail('INVALID_AMOUNT'); end if;

  select * into v_round from public.game_rounds
   where provider_id = p_provider and external_round_id = p_round_ref for update;

  if p_action = 'debit' then
    if v_user.status <> 'active' then perform app.fail('ACCOUNT_NOT_ACTIVE'); end if;
    perform app.assert_can_wager(v_user.id, p_amount);
    if v_round.id is null then
      insert into public.game_rounds (user_id, tenant_id, game_id, provider_id, session_id, stake, external_round_id, params)
      values (v_user.id, v_user.tenant_id, v_session.game_id, p_provider, v_session.id, greatest(p_amount, 1), p_round_ref, '{}'::jsonb)
      returning * into v_round;
    else
      update public.game_rounds set stake = stake + p_amount where id = v_round.id returning * into v_round;
    end if;
    if p_amount > 0 then
      v_ledger := app.move_credits('game_stake', v_user.id, null, app.wallet_account(v_user.id),
        app.system_account('SYS_PROVIDER_SETTLEMENT'), p_amount, 'round:' || v_round.id, null, v_user.tenant_id);
    end if;
  elsif p_action = 'credit' then
    if v_round.id is null then perform app.fail('ROUND_NOT_FOUND'); end if;
    if p_amount > 0 then
      v_ledger := app.move_credits('game_payout', null, 'provider:' || p_provider || ':' || p_provider_tx_id,
        app.system_account('SYS_PROVIDER_SETTLEMENT'), app.wallet_account(v_user.id), p_amount,
        'round:' || v_round.id, null, v_user.tenant_id);
    end if;
    update public.game_rounds set payout = payout + p_amount where id = v_round.id;
  elsif p_action = 'rollback' then
    select * into v_orig from public.provider_transactions
     where provider_id = p_provider and provider_tx_id = p_ref_tx_id and action = 'debit' and status = 'ok';
    if not found then perform app.fail('ORIGINAL_NOT_FOUND'); end if;
    if v_orig.amount > 0 then
      v_ledger := app.move_credits('game_refund', null, 'provider-rollback:' || p_provider || ':' || p_provider_tx_id,
        app.system_account('SYS_PROVIDER_SETTLEMENT'), app.wallet_account(v_user.id), v_orig.amount,
        'round:' || v_orig.round_id, null, v_user.tenant_id);
    end if;
    v_round.id := v_orig.round_id;
  else
    perform app.fail('INVALID_ACTION');
  end if;

  insert into public.provider_transactions (provider_id, provider_tx_id, round_id, action, amount, ledger_tx_id, status)
  values (p_provider, p_provider_tx_id, v_round.id, p_action, p_amount, v_ledger, 'ok');
  return jsonb_build_object('status', 'ok', 'duplicate', false,
                            'balance', (select balance from public.ledger_accounts where id = app.wallet_account(v_user.id)));
end $$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.casino_providers      enable row level security;
alter table public.casino_games          enable row level security;
alter table public.game_configurations   enable row level security;
alter table public.house_edge_settings   enable row level security;
alter table public.house_edge_history    enable row level security;
alter table public.favorite_games        enable row level security;
alter table public.fairness_seeds        enable row level security;
alter table public.game_sessions         enable row level security;
alter table public.game_rounds           enable row level security;
alter table public.game_results          enable row level security;
alter table public.provider_transactions enable row level security;

revoke all on public.casino_providers, public.casino_games, public.game_configurations,
  public.house_edge_settings, public.house_edge_history, public.favorite_games, public.fairness_seeds,
  public.game_sessions, public.game_rounds, public.game_results, public.provider_transactions from anon;
revoke insert, update, delete, truncate on public.casino_providers, public.casino_games,
  public.game_configurations, public.house_edge_settings, public.house_edge_history, public.favorite_games,
  public.fairness_seeds, public.game_sessions, public.game_rounds, public.game_results,
  public.provider_transactions from authenticated;
revoke all on app.seed_secrets, app.round_secrets, app.rate_limits from public, anon, authenticated;

create policy providers_read on public.casino_providers for select to authenticated using (true);
create policy games_read on public.casino_games for select to authenticated using (true);
create policy game_config_read on public.game_configurations for select to authenticated using (true);
create policy edge_read on public.house_edge_settings for select to authenticated using (true);
create policy edge_history_read on public.house_edge_history for select to authenticated using ((select app.is_super_admin()));
create policy favorites_read on public.favorite_games for select to authenticated using (user_id = (select auth.uid()));
create policy seeds_read on public.fairness_seeds for select to authenticated using (user_id = (select auth.uid()));
create policy sessions_read on public.game_sessions for select to authenticated using (
  user_id = (select auth.uid()) or ((select app.is_admin()) and tenant_id = (select app.current_tenant())));
create policy rounds_read on public.game_rounds for select to authenticated using (
  user_id = (select auth.uid()) or ((select app.is_admin()) and tenant_id = (select app.current_tenant())));
create policy results_read on public.game_results for select to authenticated using (
  user_id = (select auth.uid()) or ((select app.is_admin()) and tenant_id = (select app.current_tenant())));
create policy provider_tx_read on public.provider_transactions for select to authenticated using ((select app.is_super_admin()));

alter publication supabase_realtime add table public.game_results;
