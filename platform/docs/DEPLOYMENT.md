# Deployment

## Frontend (Vercel)

Root directory `platform`, framework Next.js. Environment variables:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_AUTH_EMAIL_DOMAIN`.
Do **not** add the service-role key to Vercel. Set Supabase Auth *Site URL* and
`ALLOWED_ORIGINS` (Edge Functions) to the production domain.

## Database & functions

```bash
supabase link --project-ref <ref>
supabase db push
supabase functions deploy admin-users admin-integrations odds-sync casino-launch casino-provider-callback maintenance
supabase secrets set AUTH_EMAIL_DOMAIN=... ALLOWED_ORIGINS=https://app.example CRON_SECRET=... \
  INTEGRATION_SECRETS_KEY=$(openssl rand -hex 32)   # encrypts API keys entered in the admin panel
```

Enable Realtime for the database (tables are added to `supabase_realtime` by the migrations).
After deploying: `npm run bootstrap` locally, sign in as the Main Admin, enrol MFA, then
set `security.require_admin_mfa` to `true` under *Settings*.

## Scheduled jobs

With `pg_cron` + `pg_net` (Supabase dashboard → Integrations):

```sql
select cron.schedule('odds-sync', '*/15 * * * *', $$
  select net.http_post('https://<ref>.supabase.co/functions/v1/odds-sync',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>'))$$);
select cron.schedule('maintenance', '*/5 * * * *', $$
  select net.http_post('https://<ref>.supabase.co/functions/v1/maintenance',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>'))$$);
```

`odds-sync` itself enforces per-league intervals and the API budget, so running it often is cheap.

## CI

`.github/workflows/platform-ci.yml` runs type-check, lint, unit + database tests on
PostgreSQL 16, Deno type-check of the Edge Functions and a production build.
