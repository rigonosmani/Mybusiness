-- =============================================================================
-- KOMETA — Phase 2: hierarchical administration
--
-- Creating auth users requires the Supabase Admin API (service role), so the
-- Edge Function `admin-users` creates the auth.users row and then calls the
-- svc_* functions below, passing the *verified* acting user. svc_* functions are
-- executable by service_role only and re-check every authorization rule.
-- =============================================================================

create table public.player_limits (
  user_id                   uuid primary key references public.profiles (id) on delete cascade,
  daily_wager_limit         bigint check (daily_wager_limit is null or daily_wager_limit > 0),
  daily_loss_limit          bigint check (daily_loss_limit is null or daily_loss_limit > 0),
  max_single_stake          bigint check (max_single_stake is null or max_single_stake > 0),
  -- Increases (or removals) only take effect after a cooling-off period.
  pending_changes           jsonb,
  pending_effective_at      timestamptz,
  self_excluded_until       timestamptz,
  self_exclusion_requested_at timestamptz,
  updated_at                timestamptz not null default now()
);

alter table public.player_limits enable row level security;
revoke all on public.player_limits from anon;
revoke insert, update, delete, truncate on public.player_limits from authenticated;
create policy player_limits_read on public.player_limits
  for select to authenticated using ((select app.can_view_owner(user_id)));

create or replace function app.default_admin_permissions(p_admin uuid, p_actor uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.admin_permissions (admin_id, permission, granted, updated_by)
  select p_admin, perm, true, p_actor
  from unnest(array['players.create', 'players.update', 'players.reset_password', 'players.suspend',
                    'credits.transfer', 'credits.reclaim', 'reports.view']) perm
  on conflict do nothing;
$$;

create or replace function app.create_wallet(p_user uuid, p_tenant uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid;
begin
  insert into public.ledger_accounts (account_type, owner_id, tenant_id)
  values ('user_wallet', p_user, p_tenant)
  returning id into v_acc;
  insert into public.wallets (user_id, account_id) values (p_user, v_acc);
  return v_acc;
end $$;

-- -----------------------------------------------------------------------------
-- Bootstrap: creates the one and only Main Administrator (service role only).
-- -----------------------------------------------------------------------------
create or replace function public.svc_bootstrap_super_admin(
  p_user_id uuid, p_username text, p_display_name text, p_initial_credits bigint default 0
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tx uuid;
begin
  if exists (select 1 from public.user_roles where role = 'super_admin') then
    perform app.fail('SUPER_ADMIN_EXISTS');
  end if;
  insert into public.profiles (id, username, display_name, role, tenant_id)
  values (p_user_id, lower(p_username), p_display_name, 'super_admin', null);
  insert into public.user_roles (user_id, role) values (p_user_id, 'super_admin');
  perform app.create_wallet(p_user_id, null);
  if coalesce(p_initial_credits, 0) > 0 then
    v_tx := app.move_credits('issuance', p_user_id, 'bootstrap-initial-issuance',
      app.system_account('SYS_ISSUANCE'), app.wallet_account(p_user_id), p_initial_credits,
      'issuance', 'Initial demo-credit issuance', null);
    insert into public.wallet_adjustments (tx_id, user_id, adjustment_type, amount, reason, created_by)
    values (v_tx, p_user_id, 'issuance', p_initial_credits, 'Initial demo-credit issuance', p_user_id);
  end if;
  perform app.audit('platform.bootstrap', 'super_admin', p_user_id::text, 'platform', null,
                    jsonb_build_object('initial_credits', p_initial_credits), p_user_id);
  return jsonb_build_object('user_id', p_user_id);
end $$;

-- -----------------------------------------------------------------------------
-- Provision a new admin (by Main Admin) or player (by secondary admin).
-- -----------------------------------------------------------------------------
create or replace function public.svc_provision_account(
  p_actor uuid, p_actor_aal text, p_user_id uuid, p_role public.app_role,
  p_username text, p_display_name text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor public.profiles;
  v_group uuid;
  v_username text := lower(trim(p_username));
begin
  if p_role = 'super_admin' then
    perform app.fail('FORBIDDEN', 'cannot create another Main Administrator');
  elsif p_role = 'admin' then
    v_actor := app.require_actor(p_actor, p_actor_aal, array['super_admin']::public.app_role[]);
  else
    v_actor := app.require_actor(p_actor, p_actor_aal, array['admin']::public.app_role[]);
    if not app.admin_has_permission(v_actor.id, 'players.create') then
      perform app.fail('PERMISSION_DENIED');
    end if;
  end if;

  if v_username !~ '^[a-z0-9][a-z0-9_.]{2,31}$' then
    perform app.fail('INVALID_USERNAME');
  end if;
  if exists (select 1 from public.profiles where username = v_username) then
    perform app.fail('USERNAME_TAKEN');
  end if;
  if exists (select 1 from public.profiles where id = p_user_id) then
    perform app.fail('ACCOUNT_EXISTS');
  end if;

  if p_role = 'admin' then
    v_group := gen_random_uuid();
    insert into public.profiles (id, username, display_name, role, tenant_id, created_by)
    values (p_user_id, v_username, coalesce(nullif(trim(p_display_name), ''), v_username), 'admin', v_group, v_actor.id);
    insert into public.administrator_groups (id, admin_id, name, created_by)
    values (v_group, p_user_id, coalesce(nullif(trim(p_display_name), ''), v_username), v_actor.id);
    insert into public.user_roles (user_id, role, granted_by) values (p_user_id, 'admin', v_actor.id);
    perform app.default_admin_permissions(p_user_id, v_actor.id);
    perform app.create_wallet(p_user_id, v_group);
    perform app.audit('admin.create', 'admin', p_user_id::text, 'platform', null,
                      jsonb_build_object('username', v_username), v_actor.id);
  else
    v_group := v_actor.tenant_id;
    insert into public.profiles (id, username, display_name, role, tenant_id, created_by)
    values (p_user_id, v_username, coalesce(nullif(trim(p_display_name), ''), v_username), 'player', v_group, v_actor.id);
    insert into public.user_roles (user_id, role, granted_by) values (p_user_id, 'player', v_actor.id);
    insert into public.administrator_players (player_id, group_id, admin_id) values (p_user_id, v_group, v_actor.id);
    insert into public.player_limits (user_id) values (p_user_id);
    perform app.create_wallet(p_user_id, v_group);
    perform app.audit('player.create', 'player', p_user_id::text, 'tenant', v_group,
                      jsonb_build_object('username', v_username), v_actor.id);
  end if;

  return jsonb_build_object('user_id', p_user_id, 'role', p_role, 'tenant_id', v_group);
end $$;

-- Pre-flight check so the Edge Function never creates an orphan auth user.
create or replace function public.svc_check_can_provision(
  p_actor uuid, p_actor_aal text, p_role public.app_role, p_username text
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor public.profiles;
  v_username text := lower(trim(p_username));
begin
  if p_role = 'super_admin' then
    perform app.fail('FORBIDDEN');
  elsif p_role = 'admin' then
    v_actor := app.require_actor(p_actor, p_actor_aal, array['super_admin']::public.app_role[]);
  else
    v_actor := app.require_actor(p_actor, p_actor_aal, array['admin']::public.app_role[]);
    if not app.admin_has_permission(v_actor.id, 'players.create') then
      perform app.fail('PERMISSION_DENIED');
    end if;
  end if;
  if v_username !~ '^[a-z0-9][a-z0-9_.]{2,31}$' then
    perform app.fail('INVALID_USERNAME');
  end if;
  if exists (select 1 from public.profiles where username = v_username) then
    perform app.fail('USERNAME_TAKEN');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Authorization check for credential operations (password reset, sign-out).
create or replace function public.svc_authorize_manage(
  p_actor uuid, p_actor_aal text, p_target uuid, p_permission text
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor public.profiles := app.require_actor(p_actor, p_actor_aal, array['super_admin', 'admin']::public.app_role[]);
begin
  if not app.actor_can_manage(p_actor, p_target) then
    perform app.fail('TARGET_NOT_FOUND');
  end if;
  if v_actor.role = 'admin' and p_permission is not null and not app.admin_has_permission(p_actor, p_permission) then
    perform app.fail('PERMISSION_DENIED');
  end if;
  return jsonb_build_object('ok', true, 'actor_role', v_actor.role);
end $$;

create or replace function public.svc_record_password_reset(p_actor uuid, p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_target public.profiles;
begin
  select * into v_target from public.profiles where id = p_target;
  if v_target.role = 'admin' then
    perform app.audit('admin.password_reset', 'admin', p_target::text, 'platform', null, '{}'::jsonb, p_actor);
  else
    perform app.audit('player.password_reset', 'player', p_target::text, 'tenant', v_target.tenant_id, '{}'::jsonb, p_actor);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Account management RPCs (called with the user's own JWT)
-- -----------------------------------------------------------------------------
create or replace function public.set_account_status(p_user_id uuid, p_status public.account_status)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['super_admin', 'admin']::public.app_role[]);
  v_target public.profiles;
begin
  if not app.actor_can_manage(v_me.id, p_user_id) then
    perform app.fail('TARGET_NOT_FOUND');
  end if;
  if v_me.role = 'admin' and not app.admin_has_permission(v_me.id, 'players.suspend') then
    perform app.fail('PERMISSION_DENIED');
  end if;
  update public.profiles set status = p_status where id = p_user_id returning * into v_target;
  if v_target.role = 'admin' then
    perform app.audit('admin.status', 'admin', p_user_id::text, 'platform', null, jsonb_build_object('status', p_status));
  else
    perform app.audit('player.status', 'player', p_user_id::text, 'tenant', v_target.tenant_id, jsonb_build_object('status', p_status));
  end if;
  return jsonb_build_object('user_id', p_user_id, 'status', p_status);
end $$;

create or replace function public.update_account(p_user_id uuid, p_display_name text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['super_admin', 'admin']::public.app_role[]);
  v_target public.profiles;
begin
  if not app.actor_can_manage(v_me.id, p_user_id) then
    perform app.fail('TARGET_NOT_FOUND');
  end if;
  if v_me.role = 'admin' and not app.admin_has_permission(v_me.id, 'players.update') then
    perform app.fail('PERMISSION_DENIED');
  end if;
  if p_display_name is null or char_length(trim(p_display_name)) not between 1 and 64 then
    perform app.fail('INVALID_DISPLAY_NAME');
  end if;
  update public.profiles set display_name = trim(p_display_name) where id = p_user_id returning * into v_target;
  if v_target.role = 'admin' then
    update public.administrator_groups set name = trim(p_display_name) where admin_id = p_user_id;
    perform app.audit('admin.update', 'admin', p_user_id::text, 'platform', null, jsonb_build_object('display_name', p_display_name));
  else
    perform app.audit('player.update', 'player', p_user_id::text, 'tenant', v_target.tenant_id, jsonb_build_object('display_name', p_display_name));
  end if;
  return jsonb_build_object('user_id', p_user_id);
end $$;

create or replace function public.set_admin_permissions(p_admin_id uuid, p_permissions jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['super_admin']::public.app_role[]);
  v_key text;
  v_val jsonb;
begin
  if not exists (select 1 from public.profiles where id = p_admin_id and role = 'admin') then
    perform app.fail('ADMIN_NOT_FOUND');
  end if;
  for v_key, v_val in select * from jsonb_each(p_permissions) loop
    insert into public.admin_permissions (admin_id, permission, granted, updated_by, updated_at)
    values (p_admin_id, v_key, (v_val #>> '{}')::boolean, v_me.id, now())
    on conflict (admin_id, permission) do update
      set granted = excluded.granted, updated_by = excluded.updated_by, updated_at = now();
  end loop;
  perform app.audit('admin.permissions', 'admin', p_admin_id::text, 'platform', null, p_permissions);
  return jsonb_build_object('admin_id', p_admin_id);
end $$;

create or replace function public.update_my_profile(p_display_name text, p_locale text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(null);
begin
  update public.profiles
     set display_name = coalesce(nullif(trim(p_display_name), ''), display_name),
         locale = coalesce(p_locale, locale)
   where id = v_me.id;
  return jsonb_build_object('ok', true);
end $$;

-- Account-management listing for the Main Admin: administrators only.
create or replace function public.list_admins()
returns table (
  id uuid, username text, display_name text, status public.account_status,
  tenant_id uuid, balance bigint, created_at timestamptz, last_login_at timestamptz,
  player_count bigint, permissions jsonb
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require_user(array['super_admin']::public.app_role[]);
  return query
  select p.id, p.username, p.display_name, p.status, p.tenant_id, a.balance, p.created_at,
         u.last_sign_in_at,
         (select count(*) from public.administrator_players ap where ap.group_id = p.tenant_id),
         coalesce((select jsonb_object_agg(permission, granted) from public.admin_permissions where admin_id = p.id), '{}'::jsonb)
  from public.profiles p
  join public.wallets w on w.user_id = p.id
  join public.ledger_accounts a on a.id = w.account_id
  left join auth.users u on u.id = p.id
  where p.role = 'admin'
  order by p.created_at desc;
end $$;

-- Player listing for a secondary admin: own tenant only.
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
         0::bigint,
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
-- Responsible play
-- -----------------------------------------------------------------------------
create or replace function public.set_my_limits(
  p_daily_wager_limit bigint, p_daily_loss_limit bigint, p_max_single_stake bigint
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_cur public.player_limits;
  v_loosening boolean := false;
  v_cooldown int := app.setting_int('responsible.limit_increase_cooldown_hours', 24)::int;
begin
  select * into v_cur from public.player_limits where user_id = v_me.id for update;
  if not found then
    insert into public.player_limits (user_id) values (v_me.id) returning * into v_cur;
  end if;
  if (p_daily_wager_limit is not null and p_daily_wager_limit <= 0)
     or (p_daily_loss_limit is not null and p_daily_loss_limit <= 0)
     or (p_max_single_stake is not null and p_max_single_stake <= 0) then
    perform app.fail('INVALID_LIMIT');
  end if;

  -- A change is "loosening" when it raises or removes an existing limit.
  v_loosening :=
       (v_cur.daily_wager_limit is not null and (p_daily_wager_limit is null or p_daily_wager_limit > v_cur.daily_wager_limit))
    or (v_cur.daily_loss_limit  is not null and (p_daily_loss_limit  is null or p_daily_loss_limit  > v_cur.daily_loss_limit))
    or (v_cur.max_single_stake  is not null and (p_max_single_stake  is null or p_max_single_stake  > v_cur.max_single_stake));

  if v_loosening then
    -- Tightening parts apply immediately; the full requested set applies after cooldown.
    update public.player_limits set
      daily_wager_limit = case when p_daily_wager_limit is not null and (daily_wager_limit is null or p_daily_wager_limit < daily_wager_limit) then p_daily_wager_limit else daily_wager_limit end,
      daily_loss_limit  = case when p_daily_loss_limit  is not null and (daily_loss_limit  is null or p_daily_loss_limit  < daily_loss_limit)  then p_daily_loss_limit  else daily_loss_limit end,
      max_single_stake  = case when p_max_single_stake  is not null and (max_single_stake  is null or p_max_single_stake  < max_single_stake)  then p_max_single_stake  else max_single_stake end,
      pending_changes = jsonb_build_object('daily_wager_limit', p_daily_wager_limit,
                                           'daily_loss_limit', p_daily_loss_limit,
                                           'max_single_stake', p_max_single_stake),
      pending_effective_at = now() + make_interval(hours => v_cooldown),
      updated_at = now()
    where user_id = v_me.id;
  else
    update public.player_limits set
      daily_wager_limit = p_daily_wager_limit,
      daily_loss_limit = p_daily_loss_limit,
      max_single_stake = p_max_single_stake,
      pending_changes = null, pending_effective_at = null, updated_at = now()
    where user_id = v_me.id;
  end if;
  perform app.audit('player.limits', 'player', v_me.id::text, 'tenant', v_me.tenant_id,
                    jsonb_build_object('loosening', v_loosening), v_me.id);
  return jsonb_build_object('pending', v_loosening);
end $$;

create or replace function public.request_self_exclusion(p_days int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_until timestamptz;
begin
  if p_days is null or p_days not in (1, 7, 30, 90, 180, 365) then
    perform app.fail('INVALID_PERIOD');
  end if;
  v_until := now() + make_interval(days => p_days);
  update public.player_limits
     set self_excluded_until = greatest(coalesce(self_excluded_until, now()), v_until),
         self_exclusion_requested_at = now(), updated_at = now()
   where user_id = v_me.id;
  perform app.audit('player.self_exclusion', 'player', v_me.id::text, 'tenant', v_me.tenant_id,
                    jsonb_build_object('days', p_days), v_me.id);
  return jsonb_build_object('excluded_until', v_until);
end $$;

-- Apply matured pending limit changes, then enforce limits for a wager.
create or replace function app.assert_can_wager(p_user uuid, p_stake bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lim public.player_limits;
  v_acc uuid := app.wallet_account(p_user);
  v_wagered bigint;
  v_net bigint;
  v_day_start timestamptz := date_trunc('day', now());
begin
  select * into v_lim from public.player_limits where user_id = p_user for update;
  if not found then
    return;
  end if;
  if v_lim.pending_effective_at is not null and v_lim.pending_effective_at <= now() then
    update public.player_limits set
      daily_wager_limit = (pending_changes->>'daily_wager_limit')::bigint,
      daily_loss_limit  = (pending_changes->>'daily_loss_limit')::bigint,
      max_single_stake  = (pending_changes->>'max_single_stake')::bigint,
      pending_changes = null, pending_effective_at = null, updated_at = now()
    where user_id = p_user
    returning * into v_lim;
  end if;
  if v_lim.self_excluded_until is not null and v_lim.self_excluded_until > now() then
    perform app.fail('SELF_EXCLUDED');
  end if;
  if v_lim.max_single_stake is not null and p_stake > v_lim.max_single_stake then
    perform app.fail('LIMIT_MAX_STAKE');
  end if;
  if v_lim.daily_wager_limit is not null or v_lim.daily_loss_limit is not null then
    select
      coalesce(sum(-e.amount) filter (where t.tx_type in ('bet_stake', 'game_stake')), 0),
      coalesce(sum(e.amount) filter (where t.tx_type in ('bet_stake', 'game_stake', 'bet_payout', 'game_payout', 'bet_refund', 'game_refund')), 0)
    into v_wagered, v_net
    from public.ledger_entries e
    join public.ledger_transactions t on t.id = e.tx_id
    where e.account_id = v_acc and e.created_at >= v_day_start;
    if v_lim.daily_wager_limit is not null and v_wagered + p_stake > v_lim.daily_wager_limit then
      perform app.fail('LIMIT_DAILY_WAGER');
    end if;
    -- Worst case: this stake is lost too.
    if v_lim.daily_loss_limit is not null and (-v_net) + p_stake > v_lim.daily_loss_limit then
      perform app.fail('LIMIT_DAILY_LOSS');
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke execute on function
  public.svc_bootstrap_super_admin(uuid, text, text, bigint),
  public.svc_provision_account(uuid, text, uuid, public.app_role, text, text),
  public.svc_check_can_provision(uuid, text, public.app_role, text),
  public.svc_authorize_manage(uuid, text, uuid, text),
  public.svc_record_password_reset(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.svc_bootstrap_super_admin(uuid, text, text, bigint),
  public.svc_provision_account(uuid, text, uuid, public.app_role, text, text),
  public.svc_check_can_provision(uuid, text, public.app_role, text),
  public.svc_authorize_manage(uuid, text, uuid, text),
  public.svc_record_password_reset(uuid, uuid)
to service_role;

grant execute on function
  public.set_account_status(uuid, public.account_status),
  public.update_account(uuid, text),
  public.set_admin_permissions(uuid, jsonb),
  public.update_my_profile(text, text),
  public.list_admins(),
  public.list_my_players(),
  public.set_my_limits(bigint, bigint, bigint),
  public.request_self_exclusion(int)
to authenticated;
