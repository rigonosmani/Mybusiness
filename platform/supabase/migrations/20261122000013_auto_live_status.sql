-- Fixtures switch to 'live' at kick-off (maintenance job), so the Live page lists them.
create or replace function public.svc_suspend_stale_markets() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  -- Kick-off passed: show the fixture as live even before the next odds/scores sync.
  update public.fixtures set status = 'live'
   where status = 'scheduled' and commence_time <= now() and commence_time > now() - interval '5 hours';
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
