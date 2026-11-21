-- =============================================================================
-- KOMETA — Phase 3: double-entry demo-credit ledger
--
-- Amounts are stored as BIGINT "units": 1 Cr = 100 units. No floating point.
-- Every transaction is a set of ledger entries that sums to zero. Balances are
-- cached on ledger_accounts and updated in the same database transaction as the
-- entries, under row locks, so they can be reconciled at any time.
-- =============================================================================

create type public.ledger_account_type as enum (
  'user_wallet', 'issuance', 'house_casino', 'house_sportsbook', 'provider_settlement'
);

create type public.ledger_tx_type as enum (
  'issuance', 'allocation', 'reclaim', 'player_credit', 'player_return',
  'bet_stake', 'bet_payout', 'bet_refund',
  'game_stake', 'game_payout', 'game_refund',
  'reversal', 'adjustment'
);

create table public.ledger_accounts (
  id             uuid primary key default gen_random_uuid(),
  account_type   public.ledger_account_type not null,
  owner_id       uuid references public.profiles (id) on delete restrict,
  code           text unique,
  tenant_id      uuid,
  balance        bigint not null default 0,
  allow_negative boolean not null default false,
  currency       text not null default 'CR' check (currency = 'CR'),
  created_at     timestamptz not null default now(),
  constraint balance_non_negative check (allow_negative or balance >= 0),
  constraint wallet_has_owner check ((account_type = 'user_wallet') = (owner_id is not null)),
  constraint only_system_negative check (not allow_negative or account_type <> 'user_wallet')
);
create unique index ledger_accounts_one_wallet on public.ledger_accounts (owner_id) where account_type = 'user_wallet';

create table public.wallets (
  user_id    uuid primary key references public.profiles (id) on delete restrict,
  account_id uuid not null unique references public.ledger_accounts (id),
  status     text not null default 'active' check (status in ('active', 'frozen')),
  created_at timestamptz not null default now()
);

create table public.ledger_transactions (
  id              uuid primary key default gen_random_uuid(),
  tx_type         public.ledger_tx_type not null,
  actor_id        uuid references public.profiles (id),
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 8 and 128),
  reference       text,
  description     text,
  tenant_id       uuid,
  reverses_tx_id  uuid unique references public.ledger_transactions (id),
  amount          bigint not null check (amount > 0),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create unique index ledger_tx_idempotency on public.ledger_transactions (actor_id, idempotency_key)
  nulls not distinct where idempotency_key is not null;
create index ledger_tx_created_idx on public.ledger_transactions (created_at desc);
create index ledger_tx_reference_idx on public.ledger_transactions (reference);

create table public.ledger_entries (
  id            bigint generated always as identity primary key,
  tx_id         uuid not null references public.ledger_transactions (id),
  account_id    uuid not null references public.ledger_accounts (id),
  amount        bigint not null check (amount <> 0),
  balance_after bigint not null,
  created_at    timestamptz not null default now()
);
create index ledger_entries_account_idx on public.ledger_entries (account_id, created_at desc);
create index ledger_entries_tx_idx on public.ledger_entries (tx_id);

create table public.credit_transfers (
  id            uuid primary key default gen_random_uuid(),
  tx_id         uuid not null unique references public.ledger_transactions (id),
  transfer_type text not null check (transfer_type in ('allocation', 'reclaim', 'player_credit', 'player_return')),
  from_user     uuid not null references public.profiles (id),
  to_user       uuid not null references public.profiles (id),
  amount        bigint not null check (amount > 0),
  tenant_id     uuid,
  note          text check (note is null or char_length(note) <= 280),
  created_by    uuid not null references public.profiles (id),
  created_at    timestamptz not null default now(),
  constraint distinct_parties check (from_user <> to_user)
);
create index credit_transfers_from_idx on public.credit_transfers (from_user, created_at desc);
create index credit_transfers_to_idx on public.credit_transfers (to_user, created_at desc);
create index credit_transfers_tenant_idx on public.credit_transfers (tenant_id, created_at desc);

create table public.wallet_adjustments (
  id              uuid primary key default gen_random_uuid(),
  tx_id           uuid not null unique references public.ledger_transactions (id),
  user_id         uuid references public.profiles (id),
  adjustment_type text not null check (adjustment_type in ('issuance', 'reversal', 'correction')),
  amount          bigint not null,
  reason          text not null check (char_length(reason) between 3 and 280),
  created_by      uuid not null references public.profiles (id),
  created_at      timestamptz not null default now()
);

-- Append-only ledger.
create trigger ledger_tx_immutable before update or delete on public.ledger_transactions
  for each row execute function app.forbid_mutation();
create trigger ledger_entries_immutable before update or delete on public.ledger_entries
  for each row execute function app.forbid_mutation();
create trigger credit_transfers_immutable before update or delete on public.credit_transfers
  for each row execute function app.forbid_mutation();
create trigger wallet_adjustments_immutable before update or delete on public.wallet_adjustments
  for each row execute function app.forbid_mutation();

-- Each transaction must balance to zero (checked at commit).
create or replace function app.check_tx_balanced() returns trigger
language plpgsql as $$
declare
  v_sum bigint;
begin
  select coalesce(sum(amount), 0) into v_sum from public.ledger_entries where tx_id = new.tx_id;
  if v_sum <> 0 then
    raise exception 'UNBALANCED_TRANSACTION: % sums to %', new.tx_id, v_sum using errcode = 'P0001';
  end if;
  return null;
end $$;
create constraint trigger ledger_entries_balanced after insert on public.ledger_entries
  deferrable initially deferred for each row execute function app.check_tx_balanced();

-- System accounts
insert into public.ledger_accounts (account_type, code, allow_negative) values
  ('issuance',            'SYS_ISSUANCE',        true),
  ('house_casino',        'SYS_HOUSE_CASINO',    true),
  ('house_sportsbook',    'SYS_HOUSE_SPORTSBOOK', true),
  ('provider_settlement', 'SYS_PROVIDER_SETTLEMENT', true);

create or replace function app.system_account(p_code text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.ledger_accounts where code = p_code
$$;

create or replace function app.wallet_account(p_user uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select account_id from public.wallets where user_id = p_user
$$;

-- -----------------------------------------------------------------------------
-- Core posting engine (internal only).
-- p_legs: jsonb array of {"account_id": uuid, "amount": bigint}; must sum to 0.
-- Returns the transaction id. If (actor, idempotency_key) was already used for an
-- identical request the original transaction id is returned and nothing is posted.
-- -----------------------------------------------------------------------------
create or replace function app.post_transaction(
  p_type public.ledger_tx_type,
  p_actor uuid,
  p_idempotency_key text,
  p_reference text,
  p_description text,
  p_tenant uuid,
  p_legs jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_reverses uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tx uuid;
  v_existing public.ledger_transactions;
  v_leg record;
  v_sum bigint := 0;
  v_amount bigint := 0;
  v_balance bigint;
  v_acc public.ledger_accounts;
begin
  if p_legs is null or jsonb_typeof(p_legs) <> 'array' or jsonb_array_length(p_legs) < 2 then
    perform app.fail('INVALID_LEGS');
  end if;

  for v_leg in select (l->>'account_id')::uuid as account_id, (l->>'amount')::bigint as amount
               from jsonb_array_elements(p_legs) l loop
    if v_leg.account_id is null or v_leg.amount is null or v_leg.amount = 0 then
      perform app.fail('INVALID_LEGS');
    end if;
    v_sum := v_sum + v_leg.amount;
    if v_leg.amount > 0 then v_amount := v_amount + v_leg.amount; end if;
  end loop;
  if v_sum <> 0 then
    perform app.fail('UNBALANCED_TRANSACTION');
  end if;

  -- Idempotency: claim the key first; a concurrent duplicate blocks here until
  -- the first transaction commits, then observes it.
  if p_idempotency_key is not null then
    insert into public.ledger_transactions
      (tx_type, actor_id, idempotency_key, reference, description, tenant_id, reverses_tx_id, amount, metadata)
    values
      (p_type, p_actor, p_idempotency_key, p_reference, p_description, p_tenant, p_reverses, v_amount, coalesce(p_metadata, '{}'::jsonb))
    on conflict (actor_id, idempotency_key) where idempotency_key is not null do nothing
    returning id into v_tx;

    if v_tx is null then
      select * into v_existing from public.ledger_transactions
       where actor_id is not distinct from p_actor and idempotency_key = p_idempotency_key;
      if v_existing.tx_type <> p_type or v_existing.amount <> v_amount
         or v_existing.reference is distinct from p_reference then
        perform app.fail('IDEMPOTENCY_KEY_REUSED');
      end if;
      return v_existing.id;
    end if;
  else
    insert into public.ledger_transactions
      (tx_type, actor_id, reference, description, tenant_id, reverses_tx_id, amount, metadata)
    values
      (p_type, p_actor, p_reference, p_description, p_tenant, p_reverses, v_amount, coalesce(p_metadata, '{}'::jsonb))
    returning id into v_tx;
  end if;

  -- Lock every account in a deterministic order to avoid deadlocks.
  perform 1 from public.ledger_accounts
   where id in (select (l->>'account_id')::uuid from jsonb_array_elements(p_legs) l)
   order by id
   for update;

  for v_leg in
    select (l->>'account_id')::uuid as account_id, sum((l->>'amount')::bigint) as amount
    from jsonb_array_elements(p_legs) l
    group by 1 order by 1
  loop
    continue when v_leg.amount = 0;
    select * into v_acc from public.ledger_accounts where id = v_leg.account_id;
    if not found then
      perform app.fail('ACCOUNT_NOT_FOUND');
    end if;
    v_balance := v_acc.balance + v_leg.amount;
    if v_balance < 0 and not v_acc.allow_negative then
      perform app.fail('INSUFFICIENT_FUNDS');
    end if;
    update public.ledger_accounts set balance = v_balance where id = v_leg.account_id;
    insert into public.ledger_entries (tx_id, account_id, amount, balance_after)
    values (v_tx, v_leg.account_id, v_leg.amount, v_balance);
  end loop;

  return v_tx;
end $$;

-- Simple two-party helper.
create or replace function app.move_credits(
  p_type public.ledger_tx_type, p_actor uuid, p_idempotency_key text,
  p_from_account uuid, p_to_account uuid, p_amount bigint,
  p_reference text, p_description text, p_tenant uuid,
  p_metadata jsonb default '{}'::jsonb, p_reverses uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if p_amount is null or p_amount <= 0 then
    perform app.fail('INVALID_AMOUNT');
  end if;
  if p_from_account is null or p_to_account is null then
    perform app.fail('ACCOUNT_NOT_FOUND');
  end if;
  return app.post_transaction(
    p_type, p_actor, p_idempotency_key, p_reference, p_description, p_tenant,
    jsonb_build_array(
      jsonb_build_object('account_id', p_from_account, 'amount', -p_amount),
      jsonb_build_object('account_id', p_to_account, 'amount', p_amount)
    ),
    p_metadata, p_reverses
  );
end $$;

create or replace function app.validate_amount(p_amount bigint) returns void
language plpgsql immutable as $$
begin
  if p_amount is null or p_amount <= 0 then
    perform app.fail('INVALID_AMOUNT');
  end if;
  if p_amount > 100000000000 then  -- 1,000,000,000 Cr sanity cap
    perform app.fail('AMOUNT_TOO_LARGE');
  end if;
end $$;

create or replace function app.validate_idempotency_key(p_key text) returns void
language plpgsql immutable as $$
begin
  if p_key is null or char_length(p_key) < 8 or char_length(p_key) > 128 then
    perform app.fail('IDEMPOTENCY_KEY_REQUIRED');
  end if;
end $$;

-- Record a transfer row once per transaction (idempotent replays skip it).
create or replace function app.record_transfer(
  p_tx uuid, p_type text, p_from uuid, p_to uuid, p_amount bigint, p_tenant uuid, p_note text, p_actor uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.credit_transfers (tx_id, transfer_type, from_user, to_user, amount, tenant_id, note, created_by)
  values (p_tx, p_type, p_from, p_to, p_amount, p_tenant, nullif(trim(p_note), ''), p_actor)
  on conflict (tx_id) do nothing;
end $$;

create or replace function app.transfer_result(p_tx uuid, p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'transaction_id', p_tx,
    'balance', (select balance from public.ledger_accounts where id = app.wallet_account(p_user))
  )
$$;

-- -----------------------------------------------------------------------------
-- Public RPCs
-- -----------------------------------------------------------------------------

-- Main Admin mints demo credits into their own wallet (non-redeemable).
create or replace function public.issue_credits(p_amount bigint, p_reason text, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['super_admin']::public.app_role[]);
  v_tx uuid;
begin
  perform app.validate_amount(p_amount);
  perform app.validate_idempotency_key(p_idempotency_key);
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    perform app.fail('REASON_REQUIRED');
  end if;
  v_tx := app.move_credits('issuance', v_me.id, p_idempotency_key,
    app.system_account('SYS_ISSUANCE'), app.wallet_account(v_me.id), p_amount,
    'issuance', p_reason, null);
  insert into public.wallet_adjustments (tx_id, user_id, adjustment_type, amount, reason, created_by)
  values (v_tx, v_me.id, 'issuance', p_amount, p_reason, v_me.id)
  on conflict (tx_id) do nothing;
  perform app.audit('credits.issue', 'wallet', v_me.id::text, 'platform', null,
                    jsonb_build_object('amount', p_amount, 'tx', v_tx));
  return app.transfer_result(v_tx, v_me.id);
end $$;

-- Main Admin -> secondary admin.
create or replace function public.allocate_credits(p_admin_id uuid, p_amount bigint, p_note text, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['super_admin']::public.app_role[]);
  v_target public.profiles;
  v_tx uuid;
begin
  perform app.validate_amount(p_amount);
  perform app.validate_idempotency_key(p_idempotency_key);
  select * into v_target from public.profiles where id = p_admin_id and role = 'admin';
  if not found then
    perform app.fail('ADMIN_NOT_FOUND');
  end if;
  if v_target.status <> 'active' then
    perform app.fail('TARGET_NOT_ACTIVE');
  end if;
  v_tx := app.move_credits('allocation', v_me.id, p_idempotency_key,
    app.wallet_account(v_me.id), app.wallet_account(v_target.id), p_amount,
    'allocation', p_note, v_target.tenant_id);
  perform app.record_transfer(v_tx, 'allocation', v_me.id, v_target.id, p_amount, v_target.tenant_id, p_note, v_me.id);
  perform app.audit('credits.allocate', 'admin', v_target.id::text, 'platform', null,
                    jsonb_build_object('amount', p_amount, 'tx', v_tx));
  return app.transfer_result(v_tx, v_me.id);
end $$;

-- Main Admin reclaims unused credits from a secondary admin.
create or replace function public.reclaim_credits(p_admin_id uuid, p_amount bigint, p_note text, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['super_admin']::public.app_role[]);
  v_target public.profiles;
  v_tx uuid;
begin
  perform app.validate_amount(p_amount);
  perform app.validate_idempotency_key(p_idempotency_key);
  select * into v_target from public.profiles where id = p_admin_id and role = 'admin';
  if not found then
    perform app.fail('ADMIN_NOT_FOUND');
  end if;
  v_tx := app.move_credits('reclaim', v_me.id, p_idempotency_key,
    app.wallet_account(v_target.id), app.wallet_account(v_me.id), p_amount,
    'reclaim', p_note, v_target.tenant_id);
  perform app.record_transfer(v_tx, 'reclaim', v_target.id, v_me.id, p_amount, v_target.tenant_id, p_note, v_me.id);
  perform app.audit('credits.reclaim', 'admin', v_target.id::text, 'platform', null,
                    jsonb_build_object('amount', p_amount, 'tx', v_tx));
  return app.transfer_result(v_tx, v_me.id);
end $$;

-- Secondary admin -> own player.
create or replace function public.transfer_to_player(p_player_id uuid, p_amount bigint, p_note text, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['admin']::public.app_role[]);
  v_target public.profiles;
  v_tx uuid;
begin
  perform app.validate_amount(p_amount);
  perform app.validate_idempotency_key(p_idempotency_key);
  if not app.admin_has_permission(v_me.id, 'credits.transfer') then
    perform app.fail('PERMISSION_DENIED');
  end if;
  select * into v_target from public.profiles
   where id = p_player_id and role = 'player' and tenant_id = v_me.tenant_id;
  if not found then
    -- Same error whether the player does not exist or belongs to another tenant.
    perform app.fail('PLAYER_NOT_FOUND');
  end if;
  if v_target.status <> 'active' then
    perform app.fail('TARGET_NOT_ACTIVE');
  end if;
  perform app.enforce_rate_limit('transfer:' || v_me.id, 60, 60);
  v_tx := app.move_credits('player_credit', v_me.id, p_idempotency_key,
    app.wallet_account(v_me.id), app.wallet_account(v_target.id), p_amount,
    'player_credit', null, v_me.tenant_id);
  perform app.record_transfer(v_tx, 'player_credit', v_me.id, v_target.id, p_amount, v_me.tenant_id, p_note, v_me.id);
  perform app.audit('credits.player_credit', 'player', v_target.id::text, 'tenant', v_me.tenant_id,
                    jsonb_build_object('amount', p_amount, 'tx', v_tx));
  return app.transfer_result(v_tx, v_me.id);
end $$;

-- Secondary admin takes credits back from own player (player cannot initiate).
create or replace function public.reclaim_from_player(p_player_id uuid, p_amount bigint, p_note text, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['admin']::public.app_role[]);
  v_target public.profiles;
  v_tx uuid;
begin
  perform app.validate_amount(p_amount);
  perform app.validate_idempotency_key(p_idempotency_key);
  if not app.admin_has_permission(v_me.id, 'credits.reclaim') then
    perform app.fail('PERMISSION_DENIED');
  end if;
  select * into v_target from public.profiles
   where id = p_player_id and role = 'player' and tenant_id = v_me.tenant_id;
  if not found then
    perform app.fail('PLAYER_NOT_FOUND');
  end if;
  v_tx := app.move_credits('player_return', v_me.id, p_idempotency_key,
    app.wallet_account(v_target.id), app.wallet_account(v_me.id), p_amount,
    'player_return', null, v_me.tenant_id);
  perform app.record_transfer(v_tx, 'player_return', v_target.id, v_me.id, p_amount, v_me.tenant_id, p_note, v_me.id);
  perform app.audit('credits.player_return', 'player', v_target.id::text, 'tenant', v_me.tenant_id,
                    jsonb_build_object('amount', p_amount, 'tx', v_tx));
  return app.transfer_result(v_tx, v_me.id);
end $$;

-- Authorized reversal through a compensating transaction. The original stays.
--   * Main Admin may reverse issuance / allocation / reclaim transactions.
--   * A secondary admin may reverse player_credit / player_return in their tenant.
create or replace function public.reverse_transaction(p_tx_id uuid, p_reason text, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles := app.require_user(array['super_admin', 'admin']::public.app_role[]);
  v_orig public.ledger_transactions;
  v_legs jsonb;
  v_tx uuid;
begin
  perform app.validate_idempotency_key(p_idempotency_key);
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    perform app.fail('REASON_REQUIRED');
  end if;
  select * into v_orig from public.ledger_transactions where id = p_tx_id;
  if not found then
    perform app.fail('TRANSACTION_NOT_FOUND');
  end if;
  if v_me.role = 'super_admin' and v_orig.tx_type not in ('issuance', 'allocation', 'reclaim') then
    perform app.fail('TRANSACTION_NOT_FOUND');
  end if;
  if v_me.role = 'admin' and (v_orig.tx_type not in ('player_credit', 'player_return')
                              or v_orig.tenant_id is distinct from v_me.tenant_id) then
    perform app.fail('TRANSACTION_NOT_FOUND');
  end if;
  if exists (select 1 from public.ledger_transactions where reverses_tx_id = p_tx_id)
     and not exists (select 1 from public.ledger_transactions
                      where reverses_tx_id = p_tx_id and actor_id = v_me.id and idempotency_key = p_idempotency_key) then
    perform app.fail('ALREADY_REVERSED');
  end if;

  select jsonb_agg(jsonb_build_object('account_id', account_id, 'amount', -amount))
    into v_legs from public.ledger_entries where tx_id = p_tx_id;

  v_tx := app.post_transaction('reversal', v_me.id, p_idempotency_key, 'reversal:' || p_tx_id,
                               p_reason, v_orig.tenant_id, v_legs,
                               jsonb_build_object('original_type', v_orig.tx_type), p_tx_id);
  insert into public.wallet_adjustments (tx_id, user_id, adjustment_type, amount, reason, created_by)
  values (v_tx, null, 'reversal', v_orig.amount, p_reason, v_me.id)
  on conflict (tx_id) do nothing;
  perform app.audit('credits.reverse', 'transaction', p_tx_id::text,
                    case when v_me.role = 'super_admin' then 'platform' else 'tenant' end,
                    case when v_me.role = 'super_admin' then null else v_me.tenant_id end,
                    jsonb_build_object('reversal_tx', v_tx, 'reason', p_reason));
  return app.transfer_result(v_tx, v_me.id);
end $$;

-- Balance of the calling user (units).
create or replace function public.my_balance() returns bigint
language sql stable security definer set search_path = public as $$
  select balance from public.ledger_accounts where id = app.wallet_account(auth.uid())
$$;

-- Verifies the whole ledger. Main Admin only (returns aggregates, no identities).
create or replace function public.reconcile_ledger() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_mismatches int;
  v_unbalanced int;
  v_total bigint;
begin
  perform app.require_user(array['super_admin']::public.app_role[]);
  select count(*) into v_mismatches
  from public.ledger_accounts a
  left join (select account_id, sum(amount) s from public.ledger_entries group by account_id) e
    on e.account_id = a.id
  where a.balance <> coalesce(e.s, 0);

  select count(*) into v_unbalanced
  from (select tx_id from public.ledger_entries group by tx_id having sum(amount) <> 0) t;

  select coalesce(sum(balance), 0) into v_total from public.ledger_accounts;

  return jsonb_build_object(
    'ok', v_mismatches = 0 and v_unbalanced = 0 and v_total = 0,
    'account_mismatches', v_mismatches,
    'unbalanced_transactions', v_unbalanced,
    'net_total', v_total,
    'checked_at', now()
  );
end $$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.ledger_accounts     enable row level security;
alter table public.wallets             enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.ledger_entries      enable row level security;
alter table public.credit_transfers    enable row level security;
alter table public.wallet_adjustments  enable row level security;

revoke all on public.ledger_accounts, public.wallets, public.ledger_transactions,
  public.ledger_entries, public.credit_transfers, public.wallet_adjustments from anon;
revoke insert, update, delete, truncate on public.ledger_accounts, public.wallets,
  public.ledger_transactions, public.ledger_entries, public.credit_transfers,
  public.wallet_adjustments from authenticated;

create policy ledger_accounts_read on public.ledger_accounts
  for select to authenticated using (owner_id is not null and (select app.can_view_owner(owner_id)));

create policy wallets_read on public.wallets
  for select to authenticated using ((select app.can_view_owner(user_id)));

create or replace function app.can_view_account(p_account uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select app.can_view_owner(owner_id) from public.ledger_accounts where id = p_account), false)
$$;
grant execute on function app.can_view_account(uuid) to authenticated;

create or replace function app.can_view_tx(p_tx uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.ledger_entries e
    join public.ledger_accounts a on a.id = e.account_id
    where e.tx_id = p_tx and a.owner_id is not null and app.can_view_owner(a.owner_id)
  )
$$;
grant execute on function app.can_view_tx(uuid) to authenticated;

create policy ledger_entries_read on public.ledger_entries
  for select to authenticated using ((select app.can_view_account(account_id)));

create policy ledger_tx_read on public.ledger_transactions
  for select to authenticated using (app.can_view_tx(id));

create policy credit_transfers_read on public.credit_transfers
  for select to authenticated using (
    (select app.can_view_owner(from_user)) and (select app.can_view_owner(to_user))
    or from_user = (select auth.uid()) or to_user = (select auth.uid())
  );

create policy wallet_adjustments_read on public.wallet_adjustments
  for select to authenticated using (
    created_by = (select auth.uid()) or (user_id is not null and (select app.can_view_owner(user_id)))
  );

grant execute on function
  public.issue_credits(bigint, text, text),
  public.allocate_credits(uuid, bigint, text, text),
  public.reclaim_credits(uuid, bigint, text, text),
  public.transfer_to_player(uuid, bigint, text, text),
  public.reclaim_from_player(uuid, bigint, text, text),
  public.reverse_transaction(uuid, text, text),
  public.my_balance(),
  public.reconcile_ledger()
to authenticated;

alter publication supabase_realtime add table public.ledger_accounts;
