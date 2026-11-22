# Publikimi në Hostinger + Supabase (udhëzues në shqip)

Rendi: **1. Supabase → 2. llogaria e parë → 3. Hostinger → 4. domeni dhe kontrolli.**

---

## 1. Supabase (baza e të dhënave, hyrja, Edge Functions)

1. Hapni https://supabase.com → **New project**. Zgjidhni regjionin më afër (p.sh. *Frankfurt*).
   Ruajeni **fjalëkalimin e databazës**.
2. Te **Project Settings → General** kopjoni **Reference ID** (p.sh. `abcd1234`).
3. Te **Project Settings → API** kopjoni:
   - **Project URL** → `https://abcd1234.supabase.co`
   - **anon public** key (publik, shkon në faqe)
   - **service_role** key (**SEKRET** – vetëm në kompjuterin tuaj, kurrë në Hostinger)
4. Në kompjuterin tuaj (Node 20+ dhe Git të instaluar):
   ```bash
   git clone https://github.com/<llogaria>/Mybusiness.git
   cd Mybusiness/platform
   npm install
   npx supabase login
   PROJECT_REF=abcd1234 SITE_URL=https://domeni-juaj.com scripts/supabase-setup.sh
   ```
   Skripti: lidh projektin, krijon gjithë tabelat/rregullat (migrations), publikon 6 Edge Functions,
   vendos sekretet (`CRON_SECRET`, `INTEGRATION_SECRETS_KEY`) dhe krijon `supabase/cron.local.sql`.
5. Supabase → **SQL Editor** → ngjitni përmbajtjen e `supabase/cron.local.sql` → **Run**
   (sinkronizimi i koeficientëve çdo 15 min dhe mirëmbajtja çdo 5 min).
6. Supabase → **Authentication**:
   - **Sign In / Providers → Email**: çaktivizoni **Allow new users to sign up**
     (llogaritë i krijojnë vetëm administratorët).
   - **URL Configuration → Site URL**: `https://domeni-juaj.com`
   - **Multi-Factor**: aktivizoni **TOTP**.

## 2. Llogaria e Administratorit Kryesor

Në kompjuterin tuaj, në `platform/`, krijoni `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://abcd1234.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_AUTH_EMAIL_DOMAIN=accounts.kometa.local
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
BOOTSTRAP_OWNER_USERNAME=owner
BOOTSTRAP_OWNER_PASSWORD=<fjalëkalim i fortë, 10+ karaktere me shifra>
BOOTSTRAP_INITIAL_CREDITS=1000
```
pastaj: `npm run bootstrap`. Ky është i vetmi vend ku përdoret çelësi `service_role`.

## 3. Hostinger

### Opsioni A – Business ose Cloud hosting (më i thjeshtë)

1. hPanel → **Websites → Add website → Node.js Apps** (ose "Web app") → **Import Git repository**
   → lidhni GitHub-in → zgjidhni repon `Mybusiness` dhe degën.
2. Cilësimet e build-it:
   | Fusha | Vlera |
   |---|---|
   | Root / application directory | `platform` |
   | Node version | 22 (ose 20) |
   | Install | `npm ci` |
   | Build command | `npm run build` |
   | Start command | `npm start` |
3. **Environment variables** (vetëm këto 3, janë publike):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://abcd1234.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   NEXT_PUBLIC_AUTH_EMAIL_DOMAIN=accounts.kometa.local
   ```
4. **Deploy**. Çdo `git push` në atë degë e ripublikon.

> Shënim: Hostinger i ndal aplikacionet që s'përdoren për një kohë dhe i rindez në kërkesën
> e parë, prandaj hapja e parë mund të jetë pak e ngadaltë.

### Opsioni B – VPS (kontroll i plotë)

1. hPanel → VPS → instaloni **Ubuntu 24.04**; lidhuni me SSH si `root`.
2. Drejtojeni domenin te IP-ja e VPS-it (rekord **A**), pastaj:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/<llogaria>/Mybusiness/<dega>/platform/deploy/setup-vps.sh -o setup.sh
   DOMAIN=domeni-juaj.com EMAIL=ju@email.com REPO=https://github.com/<llogaria>/Mybusiness.git BRANCH=<dega> bash setup.sh
   ```
   (instalon Node 22, PM2, Nginx, firewall dhe certifikatën HTTPS).
3. Si përdoruesi `kometa`:
   ```bash
   cp ~/app/platform/deploy/env.production.example ~/app/platform/.env.production
   nano ~/app/platform/.env.production        # vendosni URL dhe anon key
   bash ~/app/platform/deploy/deploy.sh
   ```
   Për përditësime: `bash ~/app/platform/deploy/deploy.sh` (bën pull, build, restart).

## 4. Domeni dhe kontrolli final

1. Supabase → Edge Function secret `ALLOWED_ORIGINS` duhet të jetë domeni i saktë
   (`https://domeni-juaj.com`) – e vendos skripti nga `SITE_URL`.
2. Hapni `https://domeni-juaj.com/login` → hyni me `owner`.
3. Paneli → **Verifikimi me dy faktorë**: skanoni QR-në; pastaj **Cilësimet**:
   `security.require_admin_mfa = true`.
4. **Integrimet**: vendosni çelësin e The Odds API → aktivizoni → **Sinkronizo tani**.
5. **Administratorët**: krijoni administratorin e parë dhe ndani kredite.

## Probleme të shpeshta

| Simptoma | Shkaku / zgjidhja |
|---|---|
| "Emër përdoruesi ose fjalëkalim i pasaktë" për owner | `NEXT_PUBLIC_AUTH_EMAIL_DOMAIN` ndryshon nga ai i përdorur në `bootstrap`. |
| Krijimi i lojtarit/administratorit jep gabim | Edge Function `admin-users` nuk është publikuar ose `ALLOWED_ORIGINS` është gabim. |
| Bilanci nuk rifreskohet live | Supabase → Database → Replication: sigurohuni që `supabase_realtime` është aktiv. |
| Nuk ka ndeshje | Integrimi i The Odds API jo aktiv / pa çelës; shikoni *Integrimet → Regjistri i sinkronizimit*. |
| Ndryshova variablat NEXT_PUBLIC_ në Hostinger por s'ka efekt | Duhet **rebuild/redeploy** – këto vlera futen gjatë build-it. |
