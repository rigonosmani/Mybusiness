# Lexopak

News site for **lexopak.com**. It watches other outlets for breaking stories. For each story, Claude researches it across several sources and drafts an **original** article that credits its sources. An editor reviews the draft and publishes it.

## How it works

1. **Listener.** Every few minutes it checks the sources in `src/sources.js` (VoxKosova and Nacionale). It stores only the headline, the link and the feed teaser, as a *lead* for the newsroom. None of the source's text appears on the public site.
2. **AI drafting.** Click **Draft with AI** on a lead, or set `AUTO_DRAFT=true`. Claude then:
   - searches the web for independent coverage and primary sources
   - writes a new article in its own structure and words
   - attributes each claim and credits the outlet that broke the story
   - flags anything it couldn't confirm
3. **Review.** Drafts wait at `/admin`. Check the facts, edit, and press **Publish**. Nothing goes live automatically.
4. **Tips.** Paste any link in **Add a tip** (any outlet, a press release, a Facebook post by an official) to get a draft from it.

The public site has a home page, category pages, article pages with a sources box and an AI disclosure, `/about`, `/feed.xml`, `/sitemap.xml` and Open Graph/NewsArticle metadata for Google and social sharing.

### Note on Nacionale

nacionale.com sits behind a Cloudflare bot check, so its feed returns `403`. The dashboard shows it as failing. Lexopak does not try to get around that block. If they allow feed readers later, it starts working with no changes. Until then, add their stories through **Add a tip**, or ask them to allowlist `LexopakBot`.

## Run locally

Requires Node.js 20 or newer.

```bash
cd lexopak
npm install
cp .env.example .env     # then fill in ANTHROPIC_API_KEY, ADMIN_PASSWORD, SESSION_SECRET
npm start                # http://localhost:3000, newsroom at /admin
```

Other commands: `npm test` runs the tests, and `npm run poll` checks the sources once and prints the result.

## Put it live on cPanel shared hosting

Your hosting needs **Setup Node.js App** in cPanel (look under *Software*). If it isn't there, the plan can't run Node apps: ask the host to enable it, or use a VPS (next section).

1. **Upload the code.** Download https://github.com/rigonosmani/Mybusiness/archive/refs/heads/lexopak-news-site.zip, upload it in **File Manager** to your home folder and **Extract** it. You now have `Mybusiness-lexopak-news-site/lexopak`.
2. **Create the app.** In **Setup Node.js App**, click **Create Application** and enter:
   - Node.js version: the highest available (20 or newer)
   - Application mode: Production
   - Application root: `Mybusiness-lexopak-news-site/lexopak`
   - Application URL: `lexopak.com`
   - Application startup file: `app.cjs`
3. **Add environment variables** on the same screen (**Add Variable**):
   - `ADMIN_PASSWORD`: your newsroom password
   - `SESSION_SECRET`: 32+ random characters
   - `ANTHROPIC_API_KEY`: your Claude key
   - `POLL_MINUTES` = `0` (cron does the checking, see step 5)

   Click **Save**.
4. Click **Run NPM Install**, then **Restart**. Open https://lexopak.com, and /admin for the newsroom.
5. **Keep the listener running.** cPanel puts idle apps to sleep, so news checking runs from cron instead. At the top of the app's page, cPanel shows a command like `source /home/USER/nodevenv/Mybusiness-lexopak-news-site/lexopak/20/bin/activate && cd ...`. In **Cron Jobs**, add a job that runs every 5 minutes (`*/5 * * * *`) using that same path:
   ```
   cd /home/USER/Mybusiness-lexopak-news-site/lexopak && /home/USER/nodevenv/Mybusiness-lexopak-news-site/lexopak/20/bin/node src/cron.js >> cron.log 2>&1
   ```
   Replace `USER` with your cPanel username and `20` with the Node version you picked.
6. **HTTPS:** in **SSL/TLS Status**, run **AutoSSL** for lexopak.com.

To update later, upload the new files over the old ones and click **Restart**. Your articles are stored in `data/lexopak.db` and are kept; download that file now and then as a backup.

## Put it live on a VPS

The app is one process with a SQLite file, so it needs a host with a **persistent disk** (Hetzner, DigitalOcean or similar, about $5/month).

```bash
# on the server, inside a clone of this repo
cd lexopak
cp .env.example .env && nano .env
docker build -t lexopak .
docker run -d --name lexopak --restart unless-stopped --env-file .env \
  -p 127.0.0.1:3000:3000 -v lexopak-data:/data lexopak
```

For HTTPS, install [Caddy](https://caddyserver.com) and use this `/etc/caddy/Caddyfile`:

```
lexopak.com, www.lexopak.com {
  reverse_proxy 127.0.0.1:3000
}
```

At your domain registrar, add an **A record** for `lexopak.com` and for `www` pointing to the server's IP. Caddy gets the SSL certificate automatically.

Render or Railway also work if you attach a persistent disk mounted at `/data`.

## Costs

Each AI draft is one Claude conversation with up to `MAX_WEB_SEARCHES` web searches. Expect roughly $0.10–$0.40 per article, depending on length and how many searches it runs. With `AUTO_DRAFT=false` (the default) you only pay for stories you choose to draft. Turning auto-draft on means paying for every story the sources publish.

## Editorial notes

- Paraphrasing a single article is still copying. The prompt and the review checklist push for multi-source, original reporting, and drafts that rely on one source get a **single source** flag.
- Only use images you own or have a licence for. Images from the source sites are never copied.
- Credit the outlet that broke the story. The site does this automatically, so keep that source in the list.
