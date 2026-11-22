import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";

let db: TestDb;
beforeAll(async () => { db = await TestDb.create(); });
afterAll(async () => db.destroy());

const executable = (role: string, schema: string) => db.sql<{ fn: string }>(
  `select p.proname fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = $1 and has_function_privilege($2, p.oid, 'execute') order by 1`, [schema, role]);

describe("privilege regression", () => {
  it("anon can execute nothing in public or app", async () => {
    expect(await executable("anon", "public")).toEqual([]);
    expect(await executable("anon", "app")).toEqual([]);
  });

  it("authenticated can execute only the documented RPCs and RLS helpers", async () => {
    const pub = (await executable("authenticated", "public")).map((r) => r.fn);
    expect(pub.filter((f) => f.startsWith("svc_"))).toEqual([]);
    // Adding an RPC must be a deliberate change to this list and to 20261121000099_privileges.sql.
    expect(pub).toEqual([
      "admin_cancel_fixture", "admin_import_games", "admin_overview", "admin_player_report", "admin_set_game_enabled", "admin_set_global_house_edge", "admin_set_house_edge", "admin_set_market_status", "admin_settle_market", "admin_update_integration", "admin_update_provider", "admin_update_setting", "admin_void_market", "allocate_credits", "blackjack_action", "blackjack_start", "casino_create_session", "crash_cashout", "crash_start", "crash_status", "get_active_round", "get_fairness", "hilo_cashout", "hilo_guess", "hilo_start", "integration_secret_status", "issue_credits", "keno_table", "list_admins", "list_my_players", "list_security_events", "mines_cashout", "mines_reveal", "mines_start", "my_balance", "my_overview", "place_bets", "play_baccarat", "play_coinflip", "play_dice", "play_keno", "play_limbo", "play_plinko", "play_roulette", "play_slot", "plinko_table", "reclaim_credits", "reclaim_from_player", "reconcile_ledger", "report_security_event", "request_self_exclusion", "reverse_transaction", "rotate_seed", "set_account_status", "set_admin_permissions", "set_my_limits", "slot_paytable", "super_admin_overview", "toggle_favorite", "transfer_to_player", "update_account", "update_my_profile", "videopoker_deal", "videopoker_draw",
    ]);
    const app = (await executable("authenticated", "app")).map((r) => r.fn);
    expect(app).toEqual(["can_view_account", "can_view_owner", "can_view_tx", "current_role", "current_tenant", "is_admin", "is_super_admin"]);
  });

  it("every svc_* entry point is service-role only", async () => {
    const svc = (await executable("service_role", "public")).map((r) => r.fn).filter((f) => f.startsWith("svc_"));
    const all = (await db.sql<{ fn: string }>(`select proname fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace where nspname = 'public' and proname like 'svc\\_%'`)).map((r) => r.fn);
    expect(svc.sort()).toEqual([...new Set(all)].sort());
  });

  it("every public table has RLS enabled and anon has no table access", async () => {
    const noRls = await db.sql(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(noRls).toEqual([]);
    const anon = await db.sql(`select table_name from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'`);
    expect(anon).toEqual([]);
  });

  it("authenticated users have no direct write privileges on any public table", async () => {
    const writes = await db.sql(`select table_name, privilege_type from information_schema.role_table_grants
      where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`);
    expect(writes).toEqual([]);
  });

  it("security definer functions pin their search_path", async () => {
    const loose = await db.sql(`select n.nspname || '.' || p.proname fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app') and p.prosecdef and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(loose).toEqual([]);
  });

  it("the demo-only guarantee is enforced by the schema", async () => {
    await expect(db.sql(`update platform_settings set value = 'true' where key = 'real_money_enabled'`)).rejects.toThrow(/real_money_disabled/);
    await expect(db.sql(`update compliance_jurisdictions set real_money_allowed = true`)).rejects.toThrow(/no_real_money_yet/);
  });
});
