-- Service-role helpers used by Edge Functions.
create or replace function public.svc_rate_limit(p_bucket text, p_limit int, p_window_seconds int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.enforce_rate_limit(p_bucket, p_limit, p_window_seconds);
end $$;

-- Odds-sync bookkeeping: last successful fetch per (integration, job, sport).
create or replace function public.svc_last_sync(p_integration text, p_job text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(sport, last_at), '{}'::jsonb)
  from (
    select details->>'sport' sport, max(finished_at) last_at
    from public.provider_sync_logs
    where integration_id = p_integration and job = p_job and status = 'ok' and details ? 'sport'
      and started_at > now() - interval '7 days'
    group by 1
  ) x
$$;

-- Events that need score checks: started, not finished, within the provider's window.
create or replace function public.svc_fixtures_awaiting_results(p_provider text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(distinct l.provider_key), '[]'::jsonb)
  from public.fixtures f join public.leagues l on l.id = f.league_id
  where f.provider = p_provider and f.status in ('scheduled', 'live')
    and f.commence_time < now() and f.commence_time > now() - interval '3 days'
$$;

revoke execute on function public.svc_rate_limit(text, int, int), public.svc_last_sync(text, text),
  public.svc_fixtures_awaiting_results(text) from public, anon, authenticated;
grant execute on function public.svc_rate_limit(text, int, int), public.svc_last_sync(text, text),
  public.svc_fixtures_awaiting_results(text) to service_role;
