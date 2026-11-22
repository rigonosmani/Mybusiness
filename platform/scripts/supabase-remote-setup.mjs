/**
 * Sets up a hosted Supabase project entirely over the Management API (no Docker,
 * no database password). Useful from a CI box or a cloud shell.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... PROJECT_REF=xxxx node scripts/supabase-remote-setup.mjs <step...>
 * Steps: migrations | auth | secrets | functions | cron | keys | all
 * Generated secrets are written to .supabase-secrets.local (git-ignored, chmod 600).
 */
import { execSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const REF = process.env.PROJECT_REF;
if (!REF) throw new Error("Set PROJECT_REF");
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? "proxy-injected";
const API = `https://api.supabase.com/v1/projects/${REF}`;
const SECRETS_FILE = ".supabase-secrets.local";

async function api(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => api("POST", "/database/query", { query });

function localSecrets() {
  const s = existsSync(SECRETS_FILE) ? Object.fromEntries(readFileSync(SECRETS_FILE, "utf8").split("\n").filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2))) : {};
  s.CRON_SECRET ??= randomBytes(32).toString("hex");
  s.INTEGRATION_SECRETS_KEY ??= randomBytes(32).toString("hex");
  writeFileSync(SECRETS_FILE, Object.entries(s).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  chmodSync(SECRETS_FILE, 0o600);
  return s;
}

const steps = {
  async migrations() {
    await sql(`create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
    const done = new Set((await sql(`select version from supabase_migrations.schema_migrations`)).map((r) => r.version));
    for (const f of readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()) {
      const [version, ...rest] = f.replace(/\.sql$/, "").split("_");
      if (done.has(version)) { console.log(`  = ${f} (already applied)`); continue; }
      const body = readFileSync(`supabase/migrations/${f}`, "utf8");
      await sql(`begin;\n${body}\n;insert into supabase_migrations.schema_migrations (version, name, statements) values ('${version}', '${rest.join("_")}', array[]::text[]);\ncommit;`);
      console.log(`  ✓ ${f}`);
    }
  },
  async auth() {
    const site = process.env.SITE_URL;
    await api("PATCH", "/config/auth", {
      disable_signup: true, external_email_enabled: true, mailer_autoconfirm: true,
      mfa_totp_enroll_enabled: true, mfa_totp_verify_enabled: true, password_min_length: 10,
      ...(site ? { site_url: site, uri_allow_list: site } : {}),
    });
    console.log("  ✓ auth: sign-ups disabled, TOTP MFA on, min password 10" + (site ? `, site ${site}` : ""));
  },
  async secrets() {
    const s = localSecrets();
    await api("POST", "/secrets", [
      { name: "AUTH_EMAIL_DOMAIN", value: process.env.AUTH_EMAIL_DOMAIN ?? "accounts.kometa.local" },
      { name: "ALLOWED_ORIGINS", value: process.env.ALLOWED_ORIGINS ?? "*" },
      { name: "CRON_SECRET", value: s.CRON_SECRET },
      { name: "INTEGRATION_SECRETS_KEY", value: s.INTEGRATION_SECRETS_KEY },
    ]);
    console.log(`  ✓ function secrets set (ALLOWED_ORIGINS=${process.env.ALLOWED_ORIGINS ?? "*"})`);
  },
  async functions() {
    const fns = ["admin-users", "admin-integrations", "odds-sync", "casino-launch", "casino-provider-callback", "maintenance", "live-engine"];
    for (const fn of fns) {
      execSync(`npx --yes supabase@latest functions deploy ${fn} --project-ref ${REF} --use-api --yes`, {
        stdio: "inherit", env: { ...process.env, SUPABASE_ACCESS_TOKEN: TOKEN.startsWith("sbp_") ? TOKEN : "sbp_" + "0".repeat(40) },
      });
    }
  },
  async cron() {
    const s = localSecrets();
    const fn = `https://${REF}.supabase.co/functions/v1`;
    const hdr = `jsonb_build_object('x-cron-secret', '${s.CRON_SECRET}', 'content-type', 'application/json')`;
    await sql(`create extension if not exists pg_cron; create extension if not exists pg_net;
      select cron.unschedule(jobid) from cron.job where jobname in ('kometa-odds-sync', 'kometa-maintenance', 'kometa-live');
      select cron.schedule('kometa-odds-sync', '*/15 * * * *', $$ select net.http_post('${fn}/odds-sync', '{}'::jsonb, '{}'::jsonb, ${hdr}) $$);
      select cron.schedule('kometa-maintenance', '*/5 * * * *', $$ select net.http_post('${fn}/maintenance', '{}'::jsonb, '{}'::jsonb, ${hdr}) $$);
      select cron.schedule('kometa-live', '* * * * *', $$ select net.http_post('${fn}/live-engine', '{}'::jsonb, '{}'::jsonb, ${hdr}) $$);`);
    console.log("  ✓ cron: odds-sync every 15 min, maintenance every 5 min, live-engine every minute");
  },
  async keys() {
    const keys = await api("GET", "/api-keys?reveal=true");
    const anon = keys.find((k) => k.name === "anon")?.api_key;
    const service = keys.find((k) => k.name === "service_role")?.api_key;
    const s = localSecrets();
    s.ANON_KEY = anon; s.SERVICE_ROLE_KEY = service;
    writeFileSync(SECRETS_FILE, Object.entries(s).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
    console.log("  ✓ API keys stored in " + SECRETS_FILE + " (not printed)");
  },
};

const wanted = process.argv.slice(2);
const order = wanted.includes("all") || wanted.length === 0 ? ["migrations", "auth", "secrets", "keys", "functions", "cron"] : wanted;
for (const step of order) {
  console.log(`▸ ${step}`);
  await steps[step]();
}
