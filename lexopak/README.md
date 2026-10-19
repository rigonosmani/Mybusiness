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

Requires Node.js 22.13 or newer.

```bash
cd lexopak
npm install
cp .env.example .env     # then fill in ANTHROPIC_API_KEY, ADMIN_PASSWORD, SESSION_SECRET
npm start                # http://localhost:3000, newsroom at /admin
```

Other commands: `npm test` runs the tests, and `npm run poll` checks the sources once and prints the result.

## Put it live on lexopak.com

The app is one process with a SQLite file, so it needs a host with a **persistent disk**. A small VPS works well (Hetzner, DigitalOcean or similar, about $5/month).

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
