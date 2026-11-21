-- =============================================================================
-- KOMETA — Phase 1: identity, hierarchy, tenant isolation, settings, auditing
-- Demo-credit platform. Credits have NO monetary value.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- Private schema for internal helpers. It is NOT exposed through PostgREST.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- Functions are not executable by everyone unless we say so. (Per-schema
-- defaults cannot revoke the global PUBLIC grant, hence the global statement.)
-- The final migration also revokes and re-grants an explicit allowlist.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema app revoke execute on functions from public;

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------
create type public.app_role as enum ('super_admin', 'admin', 'player');
create type public.account_status as enum ('active', 'suspended', 'deactivated');

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function app.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'APPEND_ONLY: % rows are immutable', tg_table_name
    using errcode = 'P0001';
end $$;

-- Raise an application error with a stable machine-readable code.
create or replace function app.fail(p_code text, p_detail text default null) returns void
language plpgsql as $$
begin
  raise exception '%', p_code using errcode = 'P0001', detail = coalesce(p_detail, p_code);
end $$;

-- -----------------------------------------------------------------------------
-- Platform settings & compliance gate
-- -----------------------------------------------------------------------------
create table public.platform_settings (
  key         text primary key check (key ~ '^[a-z0-9_.]{2,64}$'),
  value       jsonb not null,
  description text,
  locked      boolean not null default false,
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  -- The demo-only guarantee is enforced by the schema itself. Enabling real-money
  -- play requires a reviewed migration, not a settings toggle.
  constraint real_money_disabled check (key <> 'real_money_enabled' or value = 'false'::jsonb),
  constraint demo_mode_enabled  check (key <> 'demo_mode' or value = 'true'::jsonb)
);

create table public.compliance_jurisdictions (
  code               text primary key check (code ~ '^[A-Z]{2}(-[A-Z0-9]{1,3})?$'),
  name               text not null,
  regulator          text,
  license_reference  text,
  minimum_age        int not null default 18 check (minimum_age between 18 and 25),
  real_money_allowed boolean not null default false,
  enabled            boolean not null default false,
  notes              text,
  created_at         timestamptz not null default now(),
  -- Future licensed deployments: this constraint is intentionally hard-coded and
  -- must only be lifted together with licensing, KYC/age verification and
  -- payment integrations in a reviewed migration.
  constraint no_real_money_yet check (real_money_allowed = false)
);

create or replace function app.setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.platform_settings where key = p_key
$$;

create or replace function app.setting_int(p_key text, p_default bigint) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::bigint from public.platform_settings where key = p_key), p_default)
$$;

create or replace function app.setting_bool(p_key text, p_default boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::boolean from public.platform_settings where key = p_key), p_default)
$$;

-- -----------------------------------------------------------------------------
-- Identity
-- -----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text not null unique check (username ~ '^[a-z0-9][a-z0-9_.]{2,31}$'),
  display_name  text not null check (char_length(display_name) between 1 and 64),
  role          public.app_role not null,
  status        public.account_status not null default 'active',
  -- tenant_id = administrator_groups.id; null for the super admin.
  tenant_id     uuid,
  locale        text not null default 'sq' check (locale in ('sq', 'en')),
  created_by    uuid references public.profiles (id),
  date_of_birth date,
  kyc_status    text not null default 'not_required'
                check (kyc_status in ('not_required', 'pending', 'verified', 'rejected')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint tenant_matches_role check (
    (role = 'super_admin' and tenant_id is null) or (role <> 'super_admin' and tenant_id is not null)
  )
);
create index profiles_tenant_role_idx on public.profiles (tenant_id, role);
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- Authoritative role table: one role per user.
create table public.user_roles (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  role       public.app_role not null,
  granted_by uuid references public.profiles (id),
  granted_at timestamptz not null default now()
);
-- Exactly one Main Administrator.
create unique index user_roles_single_super_admin on public.user_roles (role) where role = 'super_admin';

create table public.administrator_groups (
  id         uuid primary key default gen_random_uuid(),   -- tenant id
  admin_id   uuid not null unique references public.profiles (id) on delete restrict,
  name       text not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_tenant_fk foreign key (tenant_id)
  references public.administrator_groups (id) deferrable initially deferred;

create table public.administrator_players (
  player_id  uuid primary key references public.profiles (id) on delete cascade,
  group_id   uuid not null references public.administrator_groups (id) on delete restrict,
  admin_id   uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index administrator_players_group_idx on public.administrator_players (group_id);

create table public.admin_permissions (
  admin_id   uuid not null references public.profiles (id) on delete cascade,
  permission text not null check (permission in (
    'players.create', 'players.update', 'players.reset_password', 'players.suspend',
    'credits.transfer', 'credits.reclaim', 'reports.view'
  )),
  granted    boolean not null default true,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (admin_id, permission)
);

-- -----------------------------------------------------------------------------
-- Auditing & security
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  actor_role  public.app_role,
  action      text not null,
  target_type text,
  target_id   text,
  -- 'platform' entries are visible to the Main Admin; 'tenant' entries only to
  -- the owning secondary admin (they may identify individual players).
  scope       text not null check (scope in ('platform', 'tenant')),
  tenant_id   uuid,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  constraint tenant_scope_has_tenant check (scope = 'platform' or tenant_id is not null)
);
create index audit_logs_scope_idx on public.audit_logs (scope, tenant_id, created_at desc);
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function app.forbid_mutation();

create table public.security_events (
  id           bigint generated always as identity primary key,
  user_id      uuid,
  subject_role public.app_role,
  tenant_id    uuid,
  event_type   text not null,
  severity     text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  details      jsonb not null default '{}'::jsonb,
  resolved     boolean not null default false,
  created_at   timestamptz not null default now()
);
create index security_events_created_idx on public.security_events (created_at desc);
create index security_events_tenant_idx on public.security_events (tenant_id, created_at desc);

create table app.rate_limits (
  bucket       text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (bucket, window_start)
);

-- -----------------------------------------------------------------------------
-- Session context helpers (SECURITY DEFINER so they can read role tables
-- regardless of RLS; they only ever describe the *calling* user).
-- -----------------------------------------------------------------------------
create or replace function app.current_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.user_roles where user_id = auth.uid()
$$;

create or replace function app.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'super_admin' from public.user_roles where user_id = auth.uid()), false)
$$;

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.user_roles where user_id = auth.uid()), false)
$$;

create or replace function app.current_tenant() returns uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from public.profiles where id = auth.uid()
$$;

-- Can the calling user see the given account owner (profile)?
--   * everyone sees themself
--   * the Main Admin sees administrators (never players)
--   * a secondary admin sees players of their own tenant
create or replace function app.can_view_owner(p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_owner is null or auth.uid() is null then false
    when p_owner = auth.uid() then true
    else exists (
      select 1
      from public.profiles me
      join public.profiles target on target.id = p_owner
      where me.id = auth.uid()
        and (
          (me.role = 'super_admin' and target.role = 'admin')
          or (me.role = 'admin' and target.role = 'player' and target.tenant_id = me.tenant_id)
        )
    )
  end
$$;

-- Actor-explicit variant used by service-role entry points (Edge Functions).
create or replace function app.actor_can_manage(p_actor uuid, p_target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles me
    join public.profiles target on target.id = p_target
    where me.id = p_actor
      and me.status = 'active'
      and (
        (me.role = 'super_admin' and target.role = 'admin')
        or (me.role = 'admin' and target.role = 'player' and target.tenant_id = me.tenant_id)
      )
  )
$$;

create or replace function app.admin_has_permission(p_admin uuid, p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select granted from public.admin_permissions where admin_id = p_admin and permission = p_permission),
    false
  )
$$;

create or replace function app.audit(
  p_action text, p_target_type text, p_target_id text, p_scope text,
  p_tenant uuid, p_details jsonb default '{}'::jsonb, p_actor uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
begin
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, scope, tenant_id, details)
  values (v_actor, (select role from public.user_roles where user_id = v_actor),
          p_action, p_target_type, p_target_id, p_scope, p_tenant, coalesce(p_details, '{}'::jsonb));
end $$;

create or replace function app.security_event(
  p_user uuid, p_type text, p_severity text, p_details jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.security_events (user_id, subject_role, tenant_id, event_type, severity, details)
  select p_user, p.role, p.tenant_id, p_type, p_severity, coalesce(p_details, '{}'::jsonb)
  from (select 1) x
  left join public.profiles p on p.id = p_user;
end $$;

-- Fixed-window rate limiter. Raises RATE_LIMITED when exceeded.
create or replace function app.enforce_rate_limit(p_bucket text, p_limit int, p_window_seconds int) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into app.rate_limits as r (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;
  if v_hits > p_limit then
    perform app.fail('RATE_LIMITED', format('limit %s per %ss', p_limit, p_window_seconds));
  end if;
end $$;

-- The calling user must exist, be active, and (for admin roles) satisfy MFA policy.
create or replace function app.require_user(p_roles public.app_role[] default null) returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null then
    perform app.fail('NOT_AUTHENTICATED');
  end if;
  select * into v_profile from public.profiles where id = auth.uid();
  if not found then
    perform app.fail('NO_PROFILE');
  end if;
  if v_profile.status <> 'active' then
    perform app.fail('ACCOUNT_NOT_ACTIVE');
  end if;
  if p_roles is not null and not (v_profile.role = any (p_roles)) then
    perform app.fail('FORBIDDEN', 'role not permitted for this operation');
  end if;
  if v_profile.role in ('super_admin', 'admin')
     and app.setting_bool('security.require_admin_mfa', false)
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    perform app.fail('MFA_REQUIRED');
  end if;
  return v_profile;
end $$;

-- Same checks for an explicit actor (service-role entry points).
create or replace function app.require_actor(p_actor uuid, p_aal text, p_roles public.app_role[]) returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id = p_actor;
  if not found then
    perform app.fail('NO_PROFILE');
  end if;
  if v_profile.status <> 'active' then
    perform app.fail('ACCOUNT_NOT_ACTIVE');
  end if;
  if not (v_profile.role = any (p_roles)) then
    perform app.fail('FORBIDDEN', 'role not permitted for this operation');
  end if;
  if app.setting_bool('security.require_admin_mfa', false) and coalesce(p_aal, 'aal1') <> 'aal2' then
    perform app.fail('MFA_REQUIRED');
  end if;
  return v_profile;
end $$;

grant execute on function
  app.current_role(), app.is_super_admin(), app.is_admin(), app.current_tenant(),
  app.can_view_owner(uuid)
to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security (reads). All writes go through SECURITY DEFINER functions.
-- -----------------------------------------------------------------------------
alter table public.platform_settings        enable row level security;
alter table public.compliance_jurisdictions enable row level security;
alter table public.profiles                 enable row level security;
alter table public.user_roles               enable row level security;
alter table public.administrator_groups     enable row level security;
alter table public.administrator_players    enable row level security;
alter table public.admin_permissions        enable row level security;
alter table public.audit_logs               enable row level security;
alter table public.security_events          enable row level security;

revoke insert, update, delete, truncate on
  public.platform_settings, public.compliance_jurisdictions, public.profiles, public.user_roles,
  public.administrator_groups, public.administrator_players, public.admin_permissions,
  public.audit_logs, public.security_events
from anon, authenticated;
revoke all on
  public.platform_settings, public.compliance_jurisdictions, public.profiles, public.user_roles,
  public.administrator_groups, public.administrator_players, public.admin_permissions,
  public.audit_logs, public.security_events
from anon;

create policy settings_read on public.platform_settings
  for select to authenticated using (true);

create policy jurisdictions_read on public.compliance_jurisdictions
  for select to authenticated using ((select app.is_super_admin()));

create policy profiles_read on public.profiles
  for select to authenticated using ((select app.can_view_owner(id)));

create policy user_roles_read on public.user_roles
  for select to authenticated using ((select app.can_view_owner(user_id)));

create policy groups_read on public.administrator_groups
  for select to authenticated using (
    admin_id = (select auth.uid()) or (select app.is_super_admin())
  );

create policy group_players_read on public.administrator_players
  for select to authenticated using (
    player_id = (select auth.uid())
    or ((select app.is_admin()) and group_id = (select app.current_tenant()))
  );

create policy admin_permissions_read on public.admin_permissions
  for select to authenticated using (
    admin_id = (select auth.uid()) or (select app.is_super_admin())
  );

create policy audit_read on public.audit_logs
  for select to authenticated using (
    ((select app.is_super_admin()) and scope = 'platform')
    or ((select app.is_admin()) and scope = 'tenant' and tenant_id = (select app.current_tenant()))
  );

create policy security_events_read on public.security_events
  for select to authenticated using (
    ((select app.is_super_admin()) and coalesce(subject_role::text, 'none') <> 'player')
    or ((select app.is_admin()) and tenant_id = (select app.current_tenant()))
  );
