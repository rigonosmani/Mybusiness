-- =============================================================================
-- KOMETA — explicit function allowlist.
-- Nothing is executable by API roles unless listed here. Keep this file last.
-- =============================================================================

revoke execute on all functions in schema public from public, anon, authenticated, service_role;
revoke execute on all functions in schema app from public, anon, authenticated, service_role;

-- Helpers referenced by RLS policies (they only describe the calling user).
grant execute on function
  app.current_role(), app.is_super_admin(), app.is_admin(), app.current_tenant(),
  app.can_view_owner(uuid), app.can_view_account(uuid), app.can_view_tx(uuid)
to authenticated;

-- End-user RPCs (each function performs its own role/tenant authorization).
grant execute on function
  -- wallet
  public.issue_credits(bigint, text, text),
  public.allocate_credits(uuid, bigint, text, text),
  public.reclaim_credits(uuid, bigint, text, text),
  public.transfer_to_player(uuid, bigint, text, text),
  public.reclaim_from_player(uuid, bigint, text, text),
  public.reverse_transaction(uuid, text, text),
  public.my_balance(),
  public.reconcile_ledger(),
  -- administration
  public.set_account_status(uuid, public.account_status),
  public.update_account(uuid, text),
  public.set_admin_permissions(uuid, jsonb),
  public.update_my_profile(text, text),
  public.list_admins(),
  public.list_my_players(),
  public.set_my_limits(bigint, bigint, bigint),
  public.request_self_exclusion(int),
  -- sportsbook
  public.place_bets(jsonb, text),
  public.admin_settle_market(uuid, jsonb),
  public.admin_void_market(uuid, text),
  public.admin_set_market_status(uuid, public.market_status),
  public.admin_cancel_fixture(uuid, text),
  public.admin_update_integration(text, boolean, jsonb),
  -- casino core
  public.get_fairness(),
  public.rotate_seed(text),
  public.admin_set_house_edge(text, int),
  public.admin_set_global_house_edge(int),
  public.admin_set_game_enabled(text, boolean),
  public.admin_update_setting(text, jsonb),
  public.toggle_favorite(text),
  public.get_active_round(text),
  public.casino_create_session(text),
  -- games
  public.play_dice(bigint, numeric, text, text),
  public.play_limbo(bigint, numeric, text),
  public.play_coinflip(bigint, text, text),
  public.play_roulette(jsonb, text),
  public.plinko_table(int, text),
  public.play_plinko(bigint, int, text, text),
  public.keno_table(int),
  public.play_keno(bigint, int[], text),
  public.mines_start(bigint, int, text),
  public.mines_reveal(uuid, int),
  public.mines_cashout(uuid),
  public.crash_start(bigint, numeric, text),
  public.crash_cashout(uuid),
  public.crash_status(uuid),
  public.hilo_start(bigint, text),
  public.hilo_guess(uuid, text),
  public.hilo_cashout(uuid),
  public.blackjack_start(bigint, text),
  public.blackjack_action(uuid, text),
  public.play_baccarat(jsonb, text),
  public.videopoker_deal(bigint, text),
  public.videopoker_draw(uuid, boolean[]),
  public.slot_paytable(text),
  public.play_slot(text, bigint, text),
  -- reports
  public.super_admin_overview(timestamptz, timestamptz),
  public.admin_overview(timestamptz, timestamptz),
  public.admin_player_report(uuid),
  public.my_overview(),
  public.list_security_events(int),
  public.report_security_event(text, jsonb)
to authenticated;

-- Service-role entry points (Edge Functions, scheduled jobs). Never exposed to browsers.
grant execute on function
  public.svc_bootstrap_super_admin(uuid, text, text, bigint),
  public.svc_provision_account(uuid, text, uuid, public.app_role, text, text),
  public.svc_check_can_provision(uuid, text, public.app_role, text),
  public.svc_authorize_manage(uuid, text, uuid, text),
  public.svc_record_password_reset(uuid, uuid),
  public.svc_upsert_odds(text, jsonb),
  public.svc_update_scores(text, jsonb),
  public.svc_suspend_stale_markets(),
  public.svc_settle_fixture(uuid),
  public.svc_record_sync(text, text, text, int, int, int, text, jsonb),
  public.svc_provider_wallet(text, text, text, text, text, bigint, text),
  public.svc_security_event(uuid, text, text, jsonb),
  public.svc_detect_suspicious_activity()
to service_role;
