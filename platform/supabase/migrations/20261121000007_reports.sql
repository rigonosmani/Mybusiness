-- =============================================================================
-- KOMETA — Phase 7: reporting. Main Admin reports are aggregate-only and never
-- expose individual player identities. Secondary admin reports are tenant-scoped.
-- =============================================================================

create or replace function app.period_bounds(p_from timestamptz, p_to timestamptz)
returns table (f timestamptz, t timestamptz)
language sql immutable as $$
  select coalesce(p_from, now() - interval '30 days'), coalesce(p_to, now())
$$;

-- Wagering aggregates over ledger entries of a set of wallet accounts.
create or replace function app.wager_stats(p_accounts uuid[], p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'sports_staked',  coalesce(sum(-e.amount) filter (where t.tx_type = 'bet_stake'), 0),
    'sports_returned', coalesce(sum(e.amount) filter (where t.tx_type in ('bet_payout', 'bet_refund')), 0),
    'casino_staked',  coalesce(sum(-e.amount) filter (where t.tx_type = 'game_stake'), 0),
    'casino_returned', coalesce(sum(e.amount) filter (where t.tx_type in ('game_payout', 'game_refund')), 0))
  from public.ledger_entries e
  join public.ledger_transactions t on t.id = e.tx_id
  where e.account_id = any (p_accounts) and e.created_at between p_from and p_to
$$;

create or replace function app.daily_series(p_accounts uuid[], p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'staked', coalesce(x.staked, 0), 'returned', coalesce(x.returned, 0)) order by d), '[]'::jsonb)
  from generate_series(date_trunc('day', p_from), date_trunc('day', p_to), interval '1 day') d
  left join (
    select date_trunc('day', e.created_at) dd,
           sum(-e.amount) filter (where t.tx_type in ('bet_stake', 'game_stake')) staked,
           sum(e.amount) filter (where t.tx_type in ('bet_payout', 'bet_refund', 'game_payout', 'game_refund')) returned
    from public.ledger_entries e
    join public.ledger_transactions t on t.id = e.tx_id
    where e.account_id = any (p_accounts) and e.created_at between p_from and p_to
    group by 1
  ) x on x.dd = d
$$;

create or replace function public.super_admin_overview(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['super_admin']::public.app_role[]);
  v_from timestamptz; v_to timestamptz;
  v_player_accounts uuid[];
begin
  select f, t into v_from, v_to from app.period_bounds(p_from, p_to);
  select array_agg(a.id) into v_player_accounts
    from public.ledger_accounts a join public.profiles p on p.id = a.owner_id where p.role = 'player';
  v_player_accounts := coalesce(v_player_accounts, '{}');

  return jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'admins', (select jsonb_build_object(
        'total', count(*), 'active', count(*) filter (where status = 'active'),
        'suspended', count(*) filter (where status = 'suspended'),
        'deactivated', count(*) filter (where status = 'deactivated'))
      from public.profiles where role = 'admin'),
    'players_total', (select count(*) from public.profiles where role = 'player'),
    'credits', jsonb_build_object(
      'my_balance', (select balance from public.ledger_accounts where id = app.wallet_account(v_me.id)),
      'issued_total', (select coalesce(sum(amount), 0) from public.ledger_transactions where tx_type = 'issuance'),
      'admin_available', (select coalesce(sum(a.balance), 0) from public.ledger_accounts a join public.profiles p on p.id = a.owner_id where p.role = 'admin'),
      'player_held', (select coalesce(sum(balance), 0) from public.ledger_accounts where id = any (v_player_accounts)),
      'allocated_total', (select coalesce(sum(amount), 0) from public.credit_transfers where transfer_type = 'allocation'),
      'reclaimed_total', (select coalesce(sum(amount), 0) from public.credit_transfers where transfer_type = 'reclaim'),
      'allocated_period', (select coalesce(sum(amount), 0) from public.credit_transfers where transfer_type = 'allocation' and created_at between v_from and v_to),
      'reclaimed_period', (select coalesce(sum(amount), 0) from public.credit_transfers where transfer_type = 'reclaim' and created_at between v_from and v_to),
      'house_casino', (select balance from public.ledger_accounts where code = 'SYS_HOUSE_CASINO'),
      'house_sportsbook', (select balance from public.ledger_accounts where code = 'SYS_HOUSE_SPORTSBOOK')),
    'wagering', app.wager_stats(v_player_accounts, v_from, v_to),
    'daily', app.daily_series(v_player_accounts, v_from, v_to),
    'sportsbook', (select jsonb_build_object(
        'open_bets', count(*) filter (where status = 'open'),
        'open_stake', coalesce(sum(stake) filter (where status = 'open'), 0),
        'open_exposure', coalesce(sum(potential_payout) filter (where status = 'open'), 0),
        'settled_period', count(*) filter (where status <> 'open' and settled_at between v_from and v_to))
      from public.bets),
    'games', (select coalesce(jsonb_agg(g order by g->>'game_id'), '[]'::jsonb) from (
        select jsonb_build_object('game_id', game_id, 'rounds', count(*), 'staked', sum(stake), 'paid', sum(payout),
                                  'realized_rtp', case when sum(stake) > 0 then round(sum(payout)::numeric / sum(stake), 4) end) g
        from public.game_results where created_at between v_from and v_to group by game_id) s),
    'games_availability', (select jsonb_build_object('enabled', count(*) filter (where enabled), 'disabled', count(*) filter (where not enabled)) from public.casino_games),
    'integrations', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'enabled', enabled, 'status', status,
                     'last_success_at', last_success_at, 'requests_remaining', requests_remaining)), '[]'::jsonb) from public.api_integrations),
    'per_admin', (select coalesce(jsonb_agg(jsonb_build_object(
        'admin_id', p.id, 'username', p.username, 'players', (select count(*) from public.administrator_players ap where ap.group_id = p.tenant_id),
        'wagered', (select coalesce(sum(-e.amount), 0) from public.ledger_entries e join public.ledger_transactions t on t.id = e.tx_id
                    join public.ledger_accounts a on a.id = e.account_id
                    where a.tenant_id = p.tenant_id and a.owner_id <> p.id and t.tx_type in ('bet_stake', 'game_stake') and e.created_at between v_from and v_to))
        order by p.username), '[]'::jsonb) from public.profiles p where p.role = 'admin')
  );
end $$;

create or replace function public.admin_overview(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['admin']::public.app_role[]);
  v_from timestamptz; v_to timestamptz;
  v_accounts uuid[];
begin
  if not app.admin_has_permission(v_me.id, 'reports.view') then perform app.fail('PERMISSION_DENIED'); end if;
  select f, t into v_from, v_to from app.period_bounds(p_from, p_to);
  select coalesce(array_agg(a.id), '{}') into v_accounts
    from public.ledger_accounts a join public.profiles p on p.id = a.owner_id
   where p.role = 'player' and p.tenant_id = v_me.tenant_id;

  return jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'balance', (select balance from public.ledger_accounts where id = app.wallet_account(v_me.id)),
    'players', (select jsonb_build_object('total', count(*), 'active', count(*) filter (where status = 'active'),
                                          'suspended', count(*) filter (where status = 'suspended'))
                from public.profiles where role = 'player' and tenant_id = v_me.tenant_id),
    'players_balance', (select coalesce(sum(balance), 0) from public.ledger_accounts where id = any (v_accounts)),
    'distributed_total', (select coalesce(sum(amount), 0) from public.credit_transfers where transfer_type = 'player_credit' and from_user = v_me.id),
    'returned_total', (select coalesce(sum(amount), 0) from public.credit_transfers where transfer_type = 'player_return' and to_user = v_me.id),
    'distributed_period', (select coalesce(sum(amount), 0) from public.credit_transfers where transfer_type = 'player_credit' and from_user = v_me.id and created_at between v_from and v_to),
    'returned_period', (select coalesce(sum(amount), 0) from public.credit_transfers where transfer_type = 'player_return' and to_user = v_me.id and created_at between v_from and v_to),
    'received_total', (select coalesce(sum(amount), 0) from public.credit_transfers where transfer_type = 'allocation' and to_user = v_me.id),
    'bets', (select jsonb_build_object('open', count(*) filter (where status = 'open'),
                                       'settled', count(*) filter (where status <> 'open'),
                                       'open_exposure', coalesce(sum(potential_payout) filter (where status = 'open'), 0))
             from public.bets where tenant_id = v_me.tenant_id),
    'wagering', app.wager_stats(v_accounts, v_from, v_to),
    'daily', app.daily_series(v_accounts, v_from, v_to),
    'games', (select coalesce(jsonb_agg(g order by g->>'game_id'), '[]'::jsonb) from (
        select jsonb_build_object('game_id', game_id, 'rounds', count(*), 'staked', sum(stake), 'paid', sum(payout)) g
        from public.game_results where tenant_id = v_me.tenant_id and created_at between v_from and v_to group by game_id) s)
  );
end $$;

-- Player-level report for the owning admin only.
create or replace function public.admin_player_report(p_player_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['admin']::public.app_role[]);
  v_p public.profiles;
  v_acc uuid;
begin
  select * into v_p from public.profiles where id = p_player_id and role = 'player' and tenant_id = v_me.tenant_id;
  if not found then perform app.fail('PLAYER_NOT_FOUND'); end if;
  v_acc := app.wallet_account(p_player_id);
  return jsonb_build_object(
    'profile', jsonb_build_object('id', v_p.id, 'username', v_p.username, 'display_name', v_p.display_name,
                                  'status', v_p.status, 'created_at', v_p.created_at,
                                  'last_login_at', (select last_sign_in_at from auth.users where id = v_p.id)),
    'balance', (select balance from public.ledger_accounts where id = v_acc),
    'limits', (select to_jsonb(l) - 'user_id' from public.player_limits l where l.user_id = p_player_id),
    'lifetime', app.wager_stats(array[v_acc], '-infinity', 'infinity'),
    'bets', (select jsonb_build_object('open', count(*) filter (where status = 'open'), 'won', count(*) filter (where status = 'won'),
                                       'lost', count(*) filter (where status = 'lost'), 'void', count(*) filter (where status = 'void'))
             from public.bets where user_id = p_player_id),
    'rounds', (select count(*) from public.game_results where user_id = p_player_id)
  );
end $$;

-- Player's own summary.
create or replace function public.my_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['player']::public.app_role[]);
  v_acc uuid := app.wallet_account(v_me.id);
begin
  return jsonb_build_object(
    'balance', (select balance from public.ledger_accounts where id = v_acc),
    'today', app.wager_stats(array[v_acc], date_trunc('day', now()), now()),
    'lifetime', app.wager_stats(array[v_acc], '-infinity', 'infinity'),
    'limits', (select to_jsonb(l) - 'user_id' from public.player_limits l where l.user_id = v_me.id),
    'open_bets', (select count(*) from public.bets where user_id = v_me.id and status = 'open'));
end $$;

-- Security events with player identities masked for the Main Admin.
create or replace function public.list_security_events(p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['super_admin', 'admin']::public.app_role[]);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'event_type', e.event_type, 'severity', e.severity, 'created_at', e.created_at,
      'subject_role', e.subject_role, 'resolved', e.resolved,
      'subject', case when v_me.role = 'super_admin' and e.subject_role = 'player' then null
                      else (select username from public.profiles where id = e.user_id) end,
      'tenant', (select username from public.profiles where tenant_id = e.tenant_id and role = 'admin'),
      'details', case when v_me.role = 'super_admin' and e.subject_role = 'player' then '{}'::jsonb else e.details end)
      order by e.created_at desc)
    from (select * from public.security_events s
          where (v_me.role = 'super_admin') or (s.tenant_id = v_me.tenant_id)
          order by s.created_at desc limit least(greatest(p_limit, 1), 500)) e), '[]'::jsonb);
end $$;

-- Record a security event from the application tier (e.g. failed sign-in,
-- repeated forbidden calls). The subject is always the caller.
create or replace function public.report_security_event(p_event_type text, p_details jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then perform app.fail('NOT_AUTHENTICATED'); end if;
  if p_event_type not in ('client.forbidden_action', 'client.mfa_failed', 'client.suspicious_input') then
    perform app.fail('INVALID_EVENT');
  end if;
  perform app.enforce_rate_limit('secevt:' || auth.uid(), 20, 60);
  perform app.security_event(auth.uid(), p_event_type, 'warning', coalesce(p_details, '{}'::jsonb) - 'user_id');
end $$;

create or replace function public.svc_security_event(p_user uuid, p_event_type text, p_severity text, p_details jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.security_event(p_user, p_event_type, p_severity, p_details);
end $$;

-- Automated suspicious-activity detection (run by the scheduled `maintenance` job).
create or replace function public.svc_detect_suspicious_activity() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int := 0;
  v_r record;
begin
  -- Unusually high win ratio in the last hour (possible exploit).
  for v_r in
    select user_id, sum(stake) staked, sum(payout) paid, count(*) rounds
    from public.game_results where created_at > now() - interval '1 hour'
    group by user_id having count(*) >= 50 and sum(payout) > 3 * sum(stake)
  loop
    if not exists (select 1 from public.security_events where user_id = v_r.user_id and event_type = 'casino.anomalous_return'
                   and created_at > now() - interval '1 hour') then
      perform app.security_event(v_r.user_id, 'casino.anomalous_return', 'warning',
        jsonb_build_object('rounds', v_r.rounds, 'staked', v_r.staked, 'paid', v_r.paid));
      v_n := v_n + 1;
    end if;
  end loop;
  -- Ledger integrity.
  if exists (select 1 from public.ledger_accounts a
             left join (select account_id, sum(amount) s from public.ledger_entries group by account_id) e on e.account_id = a.id
             where a.balance <> coalesce(e.s, 0)) then
    perform app.security_event(null, 'ledger.reconciliation_failed', 'critical', '{}'::jsonb);
    v_n := v_n + 1;
  end if;
  -- Rate-limit buckets older than a day are pruned.
  delete from app.rate_limits where window_start < now() - interval '1 day';
  return v_n;
end $$;
