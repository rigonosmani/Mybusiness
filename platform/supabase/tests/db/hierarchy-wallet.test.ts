import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, expectError, key } from "./harness";

const CR = (n: number) => BigInt(n) * 100n; // 1 Cr = 100 units

let db: TestDb;
let owner: string, adminA: string, adminB: string, playerA1: string, playerB1: string;

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.bootstrapSuperAdmin(CR(1000));
});
afterAll(async () => db.destroy());

describe("Test A — hierarchy", () => {
  it("Main Admin creates Administrator A and B; admins create their players", async () => {
    adminA = await db.provision(owner, "admin", "admin_a");
    adminB = await db.provision(owner, "admin", "admin_b");
    playerA1 = await db.provision(adminA, "player", "player_a1");
    playerB1 = await db.provision(adminB, "player", "player_b1");

    const [a1] = await db.sql(`select tenant_id from profiles where id = $1`, [playerA1]);
    const [a] = await db.sql(`select tenant_id from profiles where id = $1`, [adminA]);
    expect(a1.tenant_id).toBe(a.tenant_id);
    const [link] = await db.sql(`select admin_id from administrator_players where player_id = $1`, [playerA1]);
    expect(link.admin_id).toBe(adminA);
  });

  it("only one Main Administrator can ever exist", async () => {
    const other = await db.newAuthUser("owner2");
    await expectError(db.service(`select svc_bootstrap_super_admin($1, 'owner2', 'x', 0)`, [other]), "SUPER_ADMIN_EXISTS");
  });

  it("administrators cannot create administrators", async () => {
    const id = await db.newAuthUser("rogue");
    await expectError(
      db.service(`select svc_provision_account($1, 'aal1', $2, 'admin', 'rogue', 'Rogue')`, [adminA, id]),
      "FORBIDDEN",
    );
    await expectError(
      db.service(`select svc_provision_account($1, 'aal1', $2, 'super_admin', 'rogue', 'Rogue')`, [owner, id]),
      "FORBIDDEN",
    );
  });

  it("Main Admin cannot create players and players cannot create anyone", async () => {
    const id = await db.newAuthUser("p_x");
    await expectError(db.service(`select svc_provision_account($1, 'aal1', $2, 'player', 'p_x', 'x')`, [owner, id]), "FORBIDDEN");
    await expectError(db.service(`select svc_provision_account($1, 'aal1', $2, 'player', 'p_x', 'x')`, [playerA1, id]), "FORBIDDEN");
  });

  it("provisioning functions are not callable by end users", async () => {
    const id = await db.newAuthUser("p_y");
    await expectError(
      db.user(owner, `select svc_provision_account($1, 'aal2', $2, 'admin', 'p_y', 'x')`, [owner, id]),
      /permission denied/,
    );
  });

  it("Administrator A cannot see or manage Player B1 (and vice versa)", async () => {
    expect(await db.user(adminA, `select id from profiles where id = $1`, [playerB1])).toHaveLength(0);
    expect(await db.user(adminB, `select id from profiles where id = $1`, [playerA1])).toHaveLength(0);
    await expectError(db.user(adminA, `select set_account_status($1, 'suspended')`, [playerB1]), "TARGET_NOT_FOUND");
    await expectError(db.user(adminB, `select update_account($1, 'hacked')`, [playerA1]), "TARGET_NOT_FOUND");
    await expectError(
      db.service(`select svc_authorize_manage($1, 'aal1', $2, 'players.reset_password')`, [adminA, playerB1]),
      "TARGET_NOT_FOUND",
    );
    const players = await db.user(adminA, `select username from list_my_players()`);
    expect(players.map((p) => p.username)).toEqual(["player_a1"]);
  });

  it("users cannot write to role or profile tables directly", async () => {
    await expectError(db.user(playerA1, `update profiles set role = 'super_admin' where id = $1`, [playerA1]), /permission denied/);
    await expectError(db.user(adminA, `update user_roles set role = 'super_admin' where user_id = $1`, [adminA]), /permission denied/);
    await expectError(db.user(adminA, `insert into administrator_players (player_id, group_id, admin_id) select $1, tenant_id, $2 from profiles where id = $2`, [playerB1, adminA]), /permission denied/);
  });
});

describe("Test B — credit flow", () => {
  it("1000 → allocate 100 to A → A gives 10 to A1", async () => {
    expect(await db.balance(owner)).toBe(CR(1000));

    await db.user(owner, `select allocate_credits($1, $2, 'float', $3)`, [adminA, CR(100).toString(), key()]);
    expect(await db.balance(owner)).toBe(CR(900));
    expect(await db.balance(adminA)).toBe(CR(100));

    const [res] = await db.user(adminA, `select transfer_to_player($1, $2, 'welcome', $3) as r`, [playerA1, CR(10).toString(), key()]);
    expect(BigInt(res.r.balance)).toBe(CR(90));
    expect(await db.balance(adminA)).toBe(CR(90));
    expect(await db.balance(playerA1)).toBe(CR(10));

    // Second player as in the specification.
    const playerA2 = await db.provision(adminA, "player", "player_a2");
    await db.user(adminA, `select transfer_to_player($1, $2, null, $3)`, [playerA2, CR(20).toString(), key()]);
    expect(await db.balance(adminA)).toBe(CR(70));
    expect(await db.balance(playerA2)).toBe(CR(20));
  });

  it("every movement is in the double-entry ledger and the books balance", async () => {
    const txs = await db.sql(`select tx_type from ledger_transactions order by created_at`);
    expect(txs.map((t) => t.tx_type)).toEqual(["issuance", "allocation", "player_credit", "player_credit"]);
    const [unbalanced] = await db.sql(
      `select count(*)::int n from (select tx_id from ledger_entries group by tx_id having sum(amount) <> 0) x`,
    );
    expect(unbalanced.n).toBe(0);
    const [rec] = await db.user(owner, `select reconcile_ledger() r`);
    expect(rec.r.ok).toBe(true);
  });

  it("idempotency keys prevent duplicate transfers", async () => {
    const k = key();
    const before = await db.balance(adminA);
    const [r1] = await db.user(adminA, `select transfer_to_player($1, 100, null, $2) r`, [playerA1, k]);
    const [r2] = await db.user(adminA, `select transfer_to_player($1, 100, null, $2) r`, [playerA1, k]);
    expect(r1.r.transaction_id).toBe(r2.r.transaction_id);
    expect(await db.balance(adminA)).toBe(before - 100n);
    // Same key, different payload is rejected.
    await expectError(db.user(adminA, `select transfer_to_player($1, 999, null, $2)`, [playerA1, k]), "IDEMPOTENCY_KEY_REUSED");
  });

  it("concurrent transfers never overdraw (row locking)", async () => {
    const adminC = await db.provision(owner, "admin", "admin_c");
    const pc = await db.provision(adminC, "player", "player_c1");
    await db.user(owner, `select allocate_credits($1, 1000, null, $2)`, [adminC, key()]);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => db.user(adminC, `select transfer_to_player($1, 300, null, $2)`, [pc, key()])),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(3);
    expect(await db.balance(adminC)).toBe(100n);
    expect(await db.balance(pc)).toBe(900n);
  });
});

describe("Test C — invalid transfers", () => {
  it("A cannot send 150 Cr while holding less; nothing changes", async () => {
    const aBefore = await db.balance(adminA);
    const pBefore = await db.balance(playerA1);
    expect(aBefore < CR(150)).toBe(true);
    await expectError(db.user(adminA, `select transfer_to_player($1, $2, null, $3)`, [playerA1, CR(150).toString(), key()]), "INSUFFICIENT_FUNDS");
    expect(await db.balance(adminA)).toBe(aBefore);
    expect(await db.balance(playerA1)).toBe(pBefore);
  });

  it("rejects zero/negative amounts, cross-tenant targets and admin→admin transfers", async () => {
    await expectError(db.user(adminA, `select transfer_to_player($1, 0, null, $2)`, [playerA1, key()]), "INVALID_AMOUNT");
    await expectError(db.user(adminA, `select transfer_to_player($1, -500, null, $2)`, [playerA1, key()]), "INVALID_AMOUNT");
    await expectError(db.user(adminA, `select transfer_to_player($1, 100, null, $2)`, [playerB1, key()]), "PLAYER_NOT_FOUND");
    await expectError(db.user(adminA, `select transfer_to_player($1, 100, null, $2)`, [adminB, key()]), "PLAYER_NOT_FOUND");
    await expectError(db.user(adminA, `select allocate_credits($1, 100, null, $2)`, [adminB, key()]), "FORBIDDEN");
    await expectError(db.user(adminA, `select issue_credits(100, 'free money', $1)`, [key()]), "FORBIDDEN");
  });

  it("players cannot move credits and nobody can write balances directly", async () => {
    await expectError(db.user(playerA1, `select transfer_to_player($1, 100, null, $2)`, [playerB1, key()]), "FORBIDDEN");
    await expectError(db.user(playerA1, `update ledger_accounts set balance = 999999`), /permission denied/);
    await expectError(db.user(adminA, `insert into ledger_entries (tx_id, account_id, amount, balance_after) values (gen_random_uuid(), gen_random_uuid(), 1, 1)`), /permission denied/);
    await expectError(db.user(playerA1, `select app.post_transaction('issuance', null, null, null, null, null, '[]'::jsonb)`), /permission denied/);
  });

  it("ledger history is append-only even for privileged roles", async () => {
    await expectError(db.service(`update ledger_entries set amount = 1`), "APPEND_ONLY");
    await expectError(db.service(`delete from ledger_transactions`), "APPEND_ONLY");
  });

  it("suspended administrators cannot transfer", async () => {
    const adminD = await db.provision(owner, "admin", "admin_d");
    const pd = await db.provision(adminD, "player", "player_d1");
    await db.user(owner, `select allocate_credits($1, 500, null, $2)`, [adminD, key()]);
    await db.user(owner, `select set_account_status($1, 'suspended')`, [adminD]);
    await expectError(db.user(adminD, `select transfer_to_player($1, 100, null, $2)`, [pd, key()]), "ACCOUNT_NOT_ACTIVE");
  });
});

describe("reversals and reclaims", () => {
  it("Main Admin reclaims and reverses via compensating entries", async () => {
    const ownerBefore = await db.balance(owner);
    const [r] = await db.user(owner, `select reclaim_credits($1, 1000, 'unused', $2) r`, [adminA, key()]);
    expect(await db.balance(owner)).toBe(ownerBefore + 1000n);
    await db.user(owner, `select reverse_transaction($1, 'mistake', $2)`, [r.r.transaction_id, key()]);
    expect(await db.balance(owner)).toBe(ownerBefore);
    await expectError(db.user(owner, `select reverse_transaction($1, 'again', $2)`, [r.r.transaction_id, key()]), "ALREADY_REVERSED");
    const [n] = await db.sql(`select count(*)::int n from ledger_transactions where id = $1`, [r.r.transaction_id]);
    expect(n.n).toBe(1); // original kept
  });

  it("admin reclaims from own player and can reverse own tenant transfers only", async () => {
    const before = await db.balance(playerA1);
    const [r] = await db.user(adminA, `select reclaim_from_player($1, 100, null, $2) r`, [playerA1, key()]);
    expect(await db.balance(playerA1)).toBe(before - 100n);
    await expectError(db.user(adminB, `select reverse_transaction($1, 'nope', $2)`, [r.r.transaction_id, key()]), "TRANSACTION_NOT_FOUND");
    await expectError(db.user(owner, `select reverse_transaction($1, 'nope', $2)`, [r.r.transaction_id, key()]), "TRANSACTION_NOT_FOUND");
    await db.user(adminA, `select reverse_transaction($1, 'undo', $2)`, [r.r.transaction_id, key()]);
    expect(await db.balance(playerA1)).toBe(before);
  });

  it("a reversal that would make a wallet negative is refused", async () => {
    const adminE = await db.provision(owner, "admin", "admin_e");
    const pe = await db.provision(adminE, "player", "player_e1");
    const [alloc] = await db.user(owner, `select allocate_credits($1, 500, null, $2) r`, [adminE, key()]);
    await db.user(adminE, `select transfer_to_player($1, 400, null, $2)`, [pe, key()]);
    await expectError(db.user(owner, `select reverse_transaction($1, 'undo', $2)`, [alloc.r.transaction_id, key()]), "INSUFFICIENT_FUNDS");
  });
});

describe("Test F — isolation", () => {
  it("Main Admin account management shows administrators only", async () => {
    const rows = await db.user(owner, `select username from list_admins()`);
    expect(rows.every((r) => r.username.startsWith("admin_"))).toBe(true);
    const visible = await db.user(owner, `select role from profiles`);
    expect(visible.every((r) => r.role !== "player")).toBe(true);
    expect(await db.user(owner, `select * from administrator_players`)).toHaveLength(0);
    expect(await db.user(owner, `select * from player_limits`)).toHaveLength(0);
    await expectError(db.user(owner, `select * from list_my_players()`), "FORBIDDEN");
  });

  it("Main Admin cannot see player wallets or player-side ledger entries", async () => {
    const accounts = await db.user(owner, `select owner_id from ledger_accounts`);
    const ids = accounts.map((a) => a.owner_id);
    expect(ids).not.toContain(playerA1);
    expect(ids).not.toContain(playerB1);
    const entries = await db.user(
      owner,
      `select e.* from ledger_entries e join wallets w on w.account_id = e.account_id where w.user_id = $1`,
      [playerA1],
    );
    expect(entries).toHaveLength(0);
    const transfers = await db.user(owner, `select * from credit_transfers where to_user = $1 or from_user = $1`, [playerA1]);
    expect(transfers).toHaveLength(0);
  });

  it("secondary admins see only their tenant's wallets, transfers and audit trail", async () => {
    const accs = await db.user(adminB, `select owner_id from ledger_accounts`);
    expect(accs.map((a) => a.owner_id).sort()).toEqual([adminB, playerB1].sort());
    const transfers = await db.user(adminB, `select * from credit_transfers`);
    expect(transfers.every((t) => [t.from_user, t.to_user].includes(adminB))).toBe(true);
    const audit = await db.user(adminB, `select * from audit_logs`);
    const [b] = await db.sql(`select tenant_id from profiles where id = $1`, [adminB]);
    expect(audit.every((r) => r.scope === "tenant" && r.tenant_id === b.tenant_id)).toBe(true);
    const ownerAudit = await db.user(owner, `select * from audit_logs`);
    expect(ownerAudit.every((r) => r.scope === "platform")).toBe(true);
  });

  it("players see only themselves", async () => {
    expect((await db.user(playerA1, `select id from profiles`)).map((r) => r.id)).toEqual([playerA1]);
    expect((await db.user(playerA1, `select owner_id from ledger_accounts`)).map((r) => r.owner_id)).toEqual([playerA1]);
    expect(await db.user(playerA1, `select * from administrator_groups`)).toHaveLength(0);
  });

  it("anonymous users see nothing", async () => {
    await expectError(db.as({ role: "anon" }, `select * from profiles`), /permission denied/);
    await expectError(db.as({ role: "anon" }, `select * from ledger_accounts`), /permission denied/);
  });
});

describe("MFA enforcement for administrators", () => {
  it("requires aal2 for admin operations when enabled", async () => {
    await db.sql(`update platform_settings set value = 'true' where key = 'security.require_admin_mfa'`);
    await expectError(db.user(owner, `select allocate_credits($1, 1, null, $2)`, [adminA, key()]), "MFA_REQUIRED");
    await db.user(owner, `select allocate_credits($1, 1, null, $2)`, [adminA, key()], "aal2");
    // Players are not affected.
    await db.user(playerA1, `select my_balance()`);
    await db.sql(`update platform_settings set value = 'false' where key = 'security.require_admin_mfa'`);
  });
});
