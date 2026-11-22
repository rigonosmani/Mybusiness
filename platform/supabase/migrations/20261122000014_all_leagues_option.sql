-- Allow "sports": ["*"] (every active league the provider lists).
create or replace function public.admin_update_integration(p_id text, p_enabled boolean, p_config jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['super_admin']::public.app_role[]);
begin
  -- Secrets are never accepted here.
  if p_config ?| array['api_key', 'apiKey', 'key', 'secret', 'token'] then
    perform app.fail('SECRETS_NOT_ALLOWED', 'store API keys as Edge Function secrets');
  end if;
  -- The sync configuration is an object; a pasted provider response (an array) is refused.
  if p_config is not null and jsonb_typeof(p_config) <> 'object' then
    perform app.fail('INVALID_CONFIG', 'configuration must be a JSON object like {"sports": ["soccer_epl"], ...}');
  end if;
  if p_id = 'the_odds_api' and p_config is not null and (
       jsonb_typeof(p_config->'sports') <> 'array'
       or jsonb_array_length(p_config->'sports') = 0
       or exists (select 1 from jsonb_array_elements(p_config->'sports') s where jsonb_typeof(s) <> 'string' or s #>> '{}' !~ '^([a-z0-9_]{3,64}|\*)$')) then
    perform app.fail('INVALID_CONFIG', '"sports" must be a non-empty list of league keys, e.g. ["soccer_epl", "soccer_italy_serie_a"]');
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
