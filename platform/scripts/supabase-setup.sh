#!/usr/bin/env bash
# One-time setup of a hosted Supabase project for Kometa.
# Run on your own computer from the platform/ folder:
#   npx supabase login            (once)
#   PROJECT_REF=abcd1234 SITE_URL=https://your-domain.com scripts/supabase-setup.sh
# It links the project, applies all migrations, deploys the Edge Functions, sets
# their secrets and prints the SQL that schedules the background jobs.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PROJECT_REF:?Set PROJECT_REF (Supabase → Project Settings → General → Reference ID)}"
: "${SITE_URL:?Set SITE_URL, e.g. https://kometa.example.com}"
SB="npx --yes supabase@latest"

echo "▸ Linking project $PROJECT_REF (you will be asked for the database password)"
$SB link --project-ref "$PROJECT_REF"

echo "▸ Applying database migrations"
$SB db push

echo "▸ Deploying Edge Functions"
for fn in admin-users admin-integrations odds-sync casino-launch casino-provider-callback maintenance; do
  $SB functions deploy "$fn" --project-ref "$PROJECT_REF"
done

SECRETS_FILE=.supabase-secrets.local
if [ ! -f "$SECRETS_FILE" ]; then
  echo "CRON_SECRET=$(openssl rand -hex 32)" > "$SECRETS_FILE"
  echo "INTEGRATION_SECRETS_KEY=$(openssl rand -hex 32)" >> "$SECRETS_FILE"
  chmod 600 "$SECRETS_FILE"
fi
# shellcheck disable=SC1090
. "$SECRETS_FILE"

echo "▸ Setting Edge Function secrets"
$SB secrets set --project-ref "$PROJECT_REF" \
  AUTH_EMAIL_DOMAIN="${AUTH_EMAIL_DOMAIN:-accounts.kometa.local}" \
  ALLOWED_ORIGINS="$SITE_URL" \
  CRON_SECRET="$CRON_SECRET" \
  INTEGRATION_SECRETS_KEY="$INTEGRATION_SECRETS_KEY"

FN_URL="https://$PROJECT_REF.supabase.co/functions/v1"
cat > supabase/cron.local.sql <<SQL
-- Run once in Supabase → SQL Editor (needs extensions pg_cron and pg_net enabled).
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname in ('kometa-odds-sync', 'kometa-maintenance');
select cron.schedule('kometa-odds-sync', '*/15 * * * *', \$\$
  select net.http_post('$FN_URL/odds-sync', '{}'::jsonb, '{}'::jsonb,
    jsonb_build_object('x-cron-secret', '$CRON_SECRET', 'content-type', 'application/json'))\$\$);
select cron.schedule('kometa-maintenance', '*/5 * * * *', \$\$
  select net.http_post('$FN_URL/maintenance', '{}'::jsonb, '{}'::jsonb,
    jsonb_build_object('x-cron-secret', '$CRON_SECRET', 'content-type', 'application/json'))\$\$);
SQL

cat <<DONE

✔ Supabase is set up.
  Secrets were saved to $SECRETS_FILE (keep it private, it is git-ignored).
  Next:
   1. Open supabase/cron.local.sql, paste it in Supabase → SQL Editor → Run.
   2. Supabase → Authentication → Sign In / Providers → Email: turn OFF "Allow new users to sign up".
      Authentication → URL Configuration → Site URL: $SITE_URL
      Authentication → Multi-Factor: enable TOTP.
   3. On your computer: fill .env.local (URL, anon key, service_role key) and run  npm run bootstrap
DONE
