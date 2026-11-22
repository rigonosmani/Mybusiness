-- =============================================================================
-- KOMETA — provider configuration from the Main Admin panel.
--
-- API keys entered in the UI are encrypted with pgp_sym_encrypt using a key that
-- exists ONLY as an Edge Function secret (INTEGRATION_SECRETS_KEY). The database
-- never stores that key, clients can never read the ciphertext, and the UI only
-- ever sees "configured · last 4 characters".
-- =============================================================================

create table app.integration_secrets (
  integration_id text not null,
  name           text not null check (name ~ '^[a-z0-9_]{2,40}$'),
  ciphertext     bytea not null,
  last4          text not null,
  updated_by     uuid references public.profiles (id),
  updated_at     timestamptz not null default now(),
  primary key (integration_id, name)
);
revoke all on app.integration_secrets from public, anon, authenticated;

create or replace function app.integration_known(p_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.api_integrations where id = p_id)
      or exists (select 1 from public.casino_providers where id = p_id and kind <> 'in_house')
$$;

-- Main Admin check for service-role entry points.
create or replace function public.svc_require_super_admin(p_actor uuid, p_aal text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require_actor(p_actor, p_aal, array['super_admin']::public.app_role[]);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.svc_set_integration_secret(
  p_actor uuid, p_aal text, p_integration text, p_name text, p_value text, p_key text
) returns jsonb
language plpgsql security definer set search_path = public, extensions, app as $$
begin
  perform app.require_actor(p_actor, p_aal, array['super_admin']::public.app_role[]);
  if not app.integration_known(p_integration) then perform app.fail('INTEGRATION_NOT_FOUND'); end if;
  if p_key is null or char_length(p_key) < 32 then perform app.fail('SECRETS_KEY_NOT_CONFIGURED'); end if;
  if p_value is null or char_length(trim(p_value)) = 0 then
    delete from app.integration_secrets where integration_id = p_integration and name = p_name;
    perform app.audit('integration.secret_removed', 'integration', p_integration, 'platform', null,
                      jsonb_build_object('name', p_name), p_actor);
    return jsonb_build_object('configured', false);
  end if;
  if char_length(p_value) > 4096 then perform app.fail('SECRET_TOO_LONG'); end if;
  insert into app.integration_secrets (integration_id, name, ciphertext, last4, updated_by, updated_at)
  values (p_integration, p_name, extensions.pgp_sym_encrypt(trim(p_value), p_key), right(trim(p_value), 4), p_actor, now())
  on conflict (integration_id, name) do update
    set ciphertext = excluded.ciphertext, last4 = excluded.last4, updated_by = excluded.updated_by, updated_at = now();
  update public.api_integrations set key_configured = true, updated_at = now()
   where id = p_integration and p_name = 'api_key';
  -- The value itself is never written to the audit log.
  perform app.audit('integration.secret_set', 'integration', p_integration, 'platform', null,
                    jsonb_build_object('name', p_name, 'last4', right(trim(p_value), 4)), p_actor);
  return jsonb_build_object('configured', true, 'last4', right(trim(p_value), 4));
end $$;

create or replace function public.svc_get_integration_secret(p_integration text, p_name text, p_key text) returns text
language plpgsql stable security definer set search_path = public, extensions, app as $$
declare
  v bytea;
begin
  select ciphertext into v from app.integration_secrets where integration_id = p_integration and name = p_name;
  if v is null then return null; end if;
  return extensions.pgp_sym_decrypt(v, p_key);
end $$;

-- What the Main Admin sees: which secrets exist, never their values.
create or replace function public.integration_secret_status() returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require_user(array['super_admin']::public.app_role[]);
  return coalesce((select jsonb_agg(jsonb_build_object('integration_id', integration_id, 'name', name,
                                                       'last4', last4, 'updated_at', updated_at))
                   from app.integration_secrets), '[]'::jsonb);
end $$;

-- Provider settings (no secrets here). Activation requires the provider's secrets.
create or replace function public.admin_update_provider(
  p_id text, p_status text, p_api_base_url text, p_license_reference text, p_config jsonb
) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_me public.profiles := app.require_user(array['super_admin']::public.app_role[]);
  v_p public.casino_providers;
begin
  select * into v_p from public.casino_providers where id = p_id for update;
  if not found then perform app.fail('PROVIDER_NOT_FOUND'); end if;
  if p_status not in ('active', 'disabled', 'not_configured') then perform app.fail('INVALID_STATUS'); end if;
  if p_config ?| array['api_key', 'apiKey', 'key', 'secret', 'token', 'callback_secret', 'password'] then
    perform app.fail('SECRETS_NOT_ALLOWED');
  end if;
  if p_api_base_url is not null and p_api_base_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$' then
    perform app.fail('INVALID_URL');
  end if;
  if p_status = 'active' and v_p.kind <> 'in_house' then
    if coalesce(p_api_base_url, v_p.api_base_url) is null then perform app.fail('PROVIDER_INCOMPLETE', 'api_base_url'); end if;
    if not exists (select 1 from app.integration_secrets where integration_id = p_id and name = 'api_key')
       or not exists (select 1 from app.integration_secrets where integration_id = p_id and name = 'callback_secret') then
      perform app.fail('PROVIDER_INCOMPLETE', 'api_key and callback_secret are required');
    end if;
  end if;
  update public.casino_providers
     set status = p_status,
         api_base_url = coalesce(p_api_base_url, api_base_url),
         license_reference = coalesce(p_license_reference, license_reference),
         config = coalesce(p_config, config)
   where id = p_id;
  perform app.audit('provider.update', 'provider', p_id, 'platform', null,
                    jsonb_build_object('status', p_status, 'api_base_url', p_api_base_url, 'config', p_config));
  return jsonb_build_object('ok', true);
end $$;

-- Import / update a provider's game catalogue (JSON array from the aggregator).
-- Item: {external_game_id, name, category?, thumbnail?, rtp?, featured?, new?}
create or replace function public.admin_import_games(p_provider text, p_games jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_me public.profiles := app.require_user(array['super_admin']::public.app_role[]);
  v_g jsonb;
  v_id text;
  v_cat text;
  v_n int := 0;
begin
  if not exists (select 1 from public.casino_providers where id = p_provider and kind <> 'in_house') then
    perform app.fail('PROVIDER_NOT_FOUND');
  end if;
  if jsonb_typeof(p_games) <> 'array' or jsonb_array_length(p_games) > 5000 then perform app.fail('INVALID_PARAMS'); end if;
  for v_g in select * from jsonb_array_elements(p_games) loop
    if coalesce(v_g->>'external_game_id', '') = '' or coalesce(v_g->>'name', '') = '' then
      perform app.fail('INVALID_PARAMS', 'external_game_id and name are required');
    end if;
    if v_g ? 'thumbnail' and coalesce(v_g->>'thumbnail', '') <> '' and v_g->>'thumbnail' !~ '^https://' then
      perform app.fail('INVALID_URL', 'thumbnail must be https');
    end if;
    v_cat := coalesce(nullif(v_g->>'category', ''), 'slots');
    if v_cat not in ('slots', 'table', 'live', 'poker') then v_cat := 'slots'; end if;
    v_id := left(regexp_replace(lower(p_provider || '_' || (v_g->>'external_game_id')), '[^a-z0-9_]', '_', 'g'), 48);
    insert into public.casino_games (id, provider_id, name, category, tags, external_game_id, thumbnail, certified_rtp,
                                     is_featured, is_new, enabled, edge_configurable, sort_order)
    values (v_id, p_provider, left(v_g->>'name', 80), v_cat, array[v_cat], v_g->>'external_game_id',
            nullif(v_g->>'thumbnail', ''), nullif(v_g->>'rtp', '')::numeric,
            coalesce((v_g->>'featured')::boolean, false), coalesce((v_g->>'new')::boolean, false), true, false, 500)
    on conflict (id) do update
      set name = excluded.name, category = excluded.category, tags = excluded.tags, thumbnail = excluded.thumbnail,
          certified_rtp = excluded.certified_rtp, is_featured = excluded.is_featured, is_new = excluded.is_new;
    insert into public.game_configurations (game_id, config) values (v_id, '{}'::jsonb) on conflict do nothing;
    v_n := v_n + 1;
  end loop;
  perform app.audit('provider.import_games', 'provider', p_provider, 'platform', null, jsonb_build_object('count', v_n));
  return jsonb_build_object('imported', v_n);
end $$;

-- Provider context for the launch Edge Function (service role).
create or replace function public.svc_launch_context(p_session uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'session_id', s.id, 'user_id', s.user_id, 'username', p.username, 'tenant_id', s.tenant_id,
    'locale', p.locale, 'provider_id', pr.id, 'api_base_url', pr.api_base_url, 'config', pr.config,
    'external_game_id', g.external_game_id, 'balance', a.balance)
  from public.game_sessions s
  join public.profiles p on p.id = s.user_id
  join public.casino_providers pr on pr.id = s.provider_id
  join public.casino_games g on g.id = s.game_id
  join public.wallets w on w.user_id = s.user_id
  join public.ledger_accounts a on a.id = w.account_id
  where s.id = p_session
$$;

-- Balance query for provider "balance" callbacks.
create or replace function public.svc_provider_balance(p_provider text, p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_s public.game_sessions;
begin
  select * into v_s from public.game_sessions
   where provider_id = p_provider and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if not found or v_s.status <> 'active' or v_s.expires_at < now() then perform app.fail('SESSION_INVALID'); end if;
  return jsonb_build_object('status', 'ok', 'currency', 'CR',
    'balance', (select balance from public.ledger_accounts where id = app.wallet_account(v_s.user_id)));
end $$;
