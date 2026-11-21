/**
 * Database test harness.
 *
 * Runs the real Supabase migrations against a local PostgreSQL server after
 * loading a small stub of Supabase's auth schema/roles (see ../stub). Each test
 * file gets its own database cloned from a migrated template, so files are
 * fully isolated from each other.
 *
 * Configure with TEST_DATABASE_URL (defaults to postgres://postgres:postgres@localhost:5432/postgres).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

const ROOT = join(__dirname, "..", "..");
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
export const TEMPLATE_DB = "kometa_test_template";

function urlFor(db: string) {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${db}`;
  return u.toString();
}

export async function buildTemplate() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname like 'kometa_t%' and pid <> pg_backend_pid()`);
  const { rows } = await admin.query(`select datname from pg_database where datname like 'kometa_t%'`);
  for (const r of rows) await admin.query(`drop database if exists "${r.datname}"`);
  await admin.query(`create database ${TEMPLATE_DB}`);
  await admin.end();

  const c = new pg.Client({ connectionString: urlFor(TEMPLATE_DB) });
  await c.connect();
  try {
    await c.query(readFileSync(join(ROOT, "tests", "stub", "supabase_stub.sql"), "utf8"));
    const migrations = readdirSync(join(ROOT, "migrations")).filter((f) => f.endsWith(".sql")).sort();
    for (const m of migrations) {
      try {
        await c.query(readFileSync(join(ROOT, "migrations", m), "utf8"));
      } catch (e) {
        throw new Error(`Migration ${m} failed: ${(e as Error).message}`);
      }
    }
    await c.query(readFileSync(join(ROOT, "seed.sql"), "utf8"));
  } finally {
    await c.end();
  }
}

export type Role = "super_admin" | "admin" | "player";

export class TestDb {
  private constructor(public readonly pool: pg.Pool, public readonly name: string) {}

  static async create(): Promise<TestDb> {
    const name = `kometa_t_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${name} template ${TEMPLATE_DB}`);
    await admin.end();
    const pool = new pg.Pool({ connectionString: urlFor(name), max: 8 });
    return new TestDb(pool, name);
  }

  async destroy() {
    await this.pool.end();
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`drop database if exists ${this.name} with (force)`);
    await admin.end();
  }

  /** Run SQL as the database owner (bypasses everything). */
  async sql<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.pool.query(text, params);
    return r.rows as T[];
  }

  /** Run SQL inside a transaction as a given Postgres role + JWT claims. */
  async as<T = any>(
    who: { role: "authenticated" | "service_role" | "anon"; sub?: string; aal?: string },
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const claims = JSON.stringify({ sub: who.sub, role: who.role, aal: who.aal ?? "aal1" });
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
      await client.query(`set local role ${who.role}`);
      const r = await client.query(text, params);
      await client.query("commit");
      return r.rows as T[];
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  /** Shorthand for an authenticated user call. */
  user<T = any>(sub: string, text: string, params: unknown[] = [], aal = "aal1") {
    return this.as<T>({ role: "authenticated", sub, aal }, text, params);
  }

  service<T = any>(text: string, params: unknown[] = []) {
    return this.as<T>({ role: "service_role" }, text, params);
  }

  async newAuthUser(username: string): Promise<string> {
    const [row] = await this.sql<{ id: string }>(
      `insert into auth.users (email) values ($1) returning id`,
      [`${username}@accounts.kometa.test`],
    );
    return row.id;
  }

  async bootstrapSuperAdmin(credits = 100_000n): Promise<string> {
    const id = await this.newAuthUser("owner");
    await this.service(`select public.svc_bootstrap_super_admin($1, 'owner', 'Owner', $2)`, [id, credits.toString()]);
    return id;
  }

  async provision(actor: string, role: Role, username: string): Promise<string> {
    const id = await this.newAuthUser(username);
    await this.service(`select public.svc_provision_account($1, 'aal1', $2, $3, $4, $5)`, [
      actor, id, role, username, username.toUpperCase(),
    ]);
    return id;
  }

  async balance(userId: string): Promise<bigint> {
    const [r] = await this.sql<{ balance: string }>(
      `select a.balance from public.wallets w join public.ledger_accounts a on a.id = w.account_id where w.user_id = $1`,
      [userId],
    );
    return BigInt(r.balance);
  }
}

export const key = () => randomUUID();

/** Assert that a promise rejects with an application error code. */
export async function expectError(p: Promise<unknown>, code: string | RegExp) {
  try {
    await p;
  } catch (e) {
    const msg = (e as Error).message;
    if (typeof code === "string" ? msg.includes(code) : code.test(msg)) return msg;
    throw new Error(`Expected error ${code} but got: ${msg}`);
  }
  throw new Error(`Expected error ${code} but call succeeded`);
}
