#!/usr/bin/env bash
# Runs a Docker-free local backend for end-to-end testing:
#   PostgreSQL (must already be running)  +  Supabase Auth (GoTrue)  +  PostgREST
#   + the admin-users Edge Function (Deno)  +  a tiny gateway on :54321.
# Realtime is not included (the app degrades gracefully: balances refresh after each RPC).
# For day-to-day development prefer the official `supabase start` (Docker).
#
# Usage: PGPASSWORD=postgres scripts/local-stack.sh up | down
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=.local-stack
DB=${E2E_DB:-kometa_e2e}
PGHOST=${PGHOST:-localhost}
JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
mkdir -p "$DIR"

jwt() { node -e '
const c=require("crypto"),s=process.argv[1],b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const h=b({alg:"HS256",typ:"JWT"}),p=b({iss:"local",role:process.argv[2],exp:1983812996});
console.log(h+"."+p+"."+c.createHmac("sha256",s).update(h+"."+p).digest("base64url"))' "$JWT_SECRET" "$1"; }

if [ "${1:-up}" = "down" ]; then
  pkill -f "$DIR/auth" || true; pkill -f "$DIR/postgrest" || true; pkill -f "$DIR/gateway.mjs" || true; pkill -f "supabase/functions" || true; pkill -f "/index.ts" || true
  exit 0
fi

[ -x "$DIR/auth" ] || curl -sSL https://github.com/supabase/auth/releases/download/v2.164.0/auth-v2.164.0-x86.tar.gz | tar -xz -C "$DIR"
[ -x "$DIR/postgrest" ] || curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar -xJ -C "$DIR"

psql -h "$PGHOST" -U postgres -qc "drop database if exists $DB with (force)" -c "create database $DB"
psql -h "$PGHOST" -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit password 'pw'; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin login createrole password 'pw'; end if;
end \$\$;
grant anon, authenticated, service_role to authenticator;
create schema if not exists auth authorization supabase_auth_admin;
grant create on database $DB to supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role, supabase_auth_admin;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
do \$\$ begin if not exists (select 1 from pg_publication where pubname='supabase_realtime') then create publication supabase_realtime; end if; end \$\$;
SQL

( set -a
  GOTRUE_API_HOST=127.0.0.1 PORT=9999 API_EXTERNAL_URL=http://localhost:54321/auth/v1 GOTRUE_DB_DRIVER=postgres
  DATABASE_URL="postgres://supabase_auth_admin:pw@$PGHOST:5432/$DB?search_path=auth" GOTRUE_SITE_URL=http://localhost:3000
  GOTRUE_JWT_SECRET=$JWT_SECRET GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role
  GOTRUE_DISABLE_SIGNUP=true GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_MFA_TOTP_ENROLL_ENABLED=true GOTRUE_MFA_TOTP_VERIFY_ENABLED=true
  GOTRUE_PASSWORD_MIN_LENGTH=10 GOTRUE_LOG_LEVEL=warn GOTRUE_DB_MIGRATIONS_PATH=$DIR/migrations
  nohup "$DIR/auth" > "$DIR/auth.log" 2>&1 & )
for i in $(seq 1 30); do curl -sf localhost:9999/health >/dev/null && break; sleep 1; done

psql -h "$PGHOST" -U postgres -d "$DB" -qc "grant usage on schema auth to anon, authenticated, service_role"
for f in supabase/migrations/*.sql supabase/seed.sql; do psql -h "$PGHOST" -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>"$DIR/migrate.err" || { cat "$DIR/migrate.err"; exit 1; }; done

cat > "$DIR/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:pw@$PGHOST:5432/$DB"
db-schemas = "public"
db-anon-role = "anon"
db-extra-search-path = "public, extensions"
jwt-secret = "$JWT_SECRET"
server-port = 3001
server-host = "127.0.0.1"
CONF
nohup "$DIR/postgrest" "$DIR/postgrest.conf" > "$DIR/postgrest.log" 2>&1 &

cat > "$DIR/gateway.mjs" <<'JS'
import http from "node:http";
const routes = [["/rest/v1", 3001], ["/auth/v1", 9999], ["/functions/v1/admin-users", 8000], ["/functions/v1/admin-integrations", 8001],
  ["/functions/v1/casino-launch", 8002], ["/functions/v1/casino-provider-callback", 8003]];
http.createServer((req, res) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const r = routes.find(([p]) => req.url.startsWith(p));
  if (!r) { res.writeHead(404, cors); return res.end(); }
  const path = r[0].startsWith("/functions") ? "/" : req.url.slice(r[0].length) || "/";
  const p = http.request({ host: "127.0.0.1", port: r[1], path, method: req.method, headers: { ...req.headers, host: "localhost" } }, (pr) => {
    res.writeHead(pr.statusCode, { ...pr.headers, ...cors }); pr.pipe(res);
  });
  p.on("error", (e) => { res.writeHead(502, cors); res.end(String(e)); });
  req.pipe(p);
}).listen(54321);
JS
nohup node "$DIR/gateway.mjs" > "$DIR/gateway.log" 2>&1 &

ANON=$(jwt anon); SERVICE=$(jwt service_role)
SECRETS_KEY=${INTEGRATION_SECRETS_KEY:-$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')}
port=8000
for fn in admin-users admin-integrations casino-launch casino-provider-callback; do
  ( cd supabase/functions && SUPABASE_URL=http://localhost:54321 SUPABASE_ANON_KEY=$ANON SUPABASE_SERVICE_ROLE_KEY=$SERVICE \
    AUTH_EMAIL_DOMAIN=accounts.kometa.local ALLOWED_ORIGINS=http://localhost:3000 INTEGRATION_SECRETS_KEY=$SECRETS_KEY \
    DENO_SERVE_ADDRESS=tcp:127.0.0.1:$port nohup deno run ${DENO_EXTRA_FLAGS:-} --allow-net --allow-env --allow-read $fn/index.ts > "../../$DIR/$fn.log" 2>&1 & )
  port=$((port + 1))
done

cat > .env.local <<ENV
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON
NEXT_PUBLIC_AUTH_EMAIL_DOMAIN=accounts.kometa.local
SUPABASE_SERVICE_ROLE_KEY=$SERVICE
BOOTSTRAP_OWNER_USERNAME=owner
BOOTSTRAP_OWNER_PASSWORD=Owner-Passw0rd
BOOTSTRAP_INITIAL_CREDITS=1000
BOOTSTRAP_DEMO_ACCOUNTS=true
BOOTSTRAP_DEMO_PASSWORD=Demo-Passw0rd
ENV
sleep 3
npx tsx scripts/bootstrap.ts
echo "Local stack ready on http://localhost:54321 — now: npm run build && npm start, then npm run e2e"
