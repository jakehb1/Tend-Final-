# tend

AI partner for small businesses. Static marketing + product surface deployed on
Railway, optional self-hosted VPS backend for OAuth integrations and per-tenant
agent runtime.

Live: https://withtend.ai

---

## What's in this repo

```
project/                  Site source (HTML/CSS/JS). The Railway deploy serves this.
tend/project/             Mirror of project/ kept in sync for the design-bundle layout.
server.js                 Tiny static Node server used by Railway.
package.json              Just enough Node for the static server.
railway.json              Railway deploy config (builder, start cmd, healthcheck).
nixpacks.toml             Pins the Railway build to Node 20. See "Build pinning" below.
.railwayignore            Excludes bridge/, deploy/, cli/ from the Railway build context.

bridge/                   Optional Node service the frontend can call for live data.
bridge/bridge.js          OAuth state + chat SSE proxy + Nango webhook handler.
bridge/Dockerfile         Image for the bridge service (used by docker-compose).
bridge/hermes-sidecar/    Python sidecar wrapping the Hermes agent runtime.

deploy/                   VPS deploy stack (Docker Compose + Caddy).
deploy/docker-compose.yml Nango + Postgres + bridge + hermes-sidecar + Caddy.
deploy/Caddyfile          HTTPS reverse proxy config.
deploy/.env.example       Required env vars.
deploy/agent-templates/   Per-tenant agent + skill YAML templates.
deploy/README.md          Step-by-step VPS install guide.

cli/                      Helper scripts.
```

The frontend works on its own. `project/` is fully static and ships as-is.
The `bridge/` + `deploy/` stack is only required when you want real OAuth
connections and a live agent. Without it, the site runs in demo mode using
`localStorage` and canned chat replies.

---

## Architecture

```
                     Railway (static)
                  ┌──────────────────────┐
   browser ────►  │  project/*.html      │
                  │  server.js (static)  │
                  └──────────────────────┘
                              │
                              │  optional, when window.__TEND_CONFIG__.apiBase is set
                              ▼
                       VPS (Docker Compose)
   ┌──────────────────────────────────────────────────────┐
   │  Caddy (HTTPS, auto-LE)                              │
   │    ├─► bridge (Node) ──► Nango (OAuth + sync)        │
   │    │                  └─► hermes-sidecar (Python)    │
   │    └─► nango-server (dashboard)                      │
   └──────────────────────────────────────────────────────┘
```

- **Frontend** is plain HTML/CSS/JS. No build step. Railway serves
  `project/` via the Node static server in `server.js`.
- **Bridge** is a small Node service (no deps) exposing CORS-safe endpoints
  for connector state, chat (SSE), and a Nango webhook.
- **Nango** handles every OAuth integration and the scheduled sync engine.
- **Hermes sidecar** is a FastAPI wrapper around the Hermes agent runtime
  (https://github.com/NousResearch/hermes-agent). The bridge talks to it
  over plain HTTP+SSE so the Node side never has to load Python.

---

## Key pages

| Path             | What it is                                                  |
| ---------------- | ----------------------------------------------------------- |
| `/`              | Marketing home                                              |
| `/about`         | About                                                       |
| `/platform`      | Product overview                                            |
| `/use-cases`     | Use cases                                                   |
| `/org`           | Lighter-tier marketing variant (smaller teams)              |
| `/org-light`     | Light-theme version of `/org` (current canonical org page)  |
| `/login`         | Demo auth (any email/password)                              |
| `/onboarding`    | Post-login wizard, writes `tend.onboarded` to localStorage  |
| `/connect`       | Connector picker. Drives Nango Connect UI in live mode      |
| `/app`           | Workspace / chat surface (currently Quiet Golf demo data)   |

All pages share `project/shared.css`. Cache-bust by bumping `?v=N` in the
`<link>` tags when you change it.

---

## Run locally

```bash
npm install
node server.js
# open http://localhost:3000
```

That's it for the frontend. Edits to `project/*.html` are reflected on reload.

When editing pages, mirror your changes into `tend/project/` so the design
bundle layout stays consistent. (Both directories ship to Railway; the live
site uses `project/`.)

---

## Demo mode vs live mode

The site has two modes, switched by a single config block on `/connect` and
`/app`:

```html
<script>
  window.__TEND_CONFIG__ = { apiBase: null };
</script>
```

- `apiBase: null` (default) — demo mode. `/connect` uses `localStorage` to
  remember which connectors are toggled; `/app` uses canned chat replies.
  This is what Railway serves today, and it's what runs during the Quiet
  Golf demo.
- `apiBase: 'https://api.withtend.ai'` — live mode. `/connect` opens the
  Nango Connect popup for real OAuth; `/app` streams from
  `bridge ─► hermes-sidecar`.

**Important for handoff:** the Quiet Golf demo expects `apiBase: null`.
Do not flip it on `main` until the VPS backend is in production.

---

## Setup guide

A fresh handoff, from cloning the repo to a live site with a real
backend, in order. Skip Phase 2 + 3 if you only need the static site.

### Phase 1. Local dev (5 min)

```bash
git clone <this-repo> tend && cd tend
npm install
node server.js
# open http://localhost:3000
```

`server.js` is a tiny static file server. Routes are filename-based
(`/org-light` -> `project/org-light.html`). No build step, no
hot-reload — just refresh the browser after edits.

When editing pages, mirror your edits into `tend/project/` to keep the
two trees in sync. Bump `shared.css?v=N` (in the `<link>` tags) so
Railway's HTTP cache invalidates.

### Phase 2. Frontend on Railway (10 min)

The static site is what `withtend.ai` serves. Setup once, then every
push to the configured branch deploys.

1. **Connect the repo.** Railway dashboard -> New Project -> Deploy
   from GitHub -> pick this repo.
2. **Pick the branch.** Settings -> Source -> Branch. Today the live
   site deploys from `claude/prepare-railway-deployment-ujRcM`; move
   it to `main` once you've merged.
3. **No env vars required** for the static frontend. The site reads
   `window.__TEND_CONFIG__.apiBase` from inline `<script>` blocks in
   `connect.html` and `app.html` — see "Demo vs live mode" below.
4. **Build pinning.** `nixpacks.toml` pins Railway to Node 20 and
   `.railwayignore` keeps the bridge/agent code out of the build
   context. Don't delete these — without them Nixpacks flips to a
   Python build target the moment any `.py` or `requirements.txt`
   file lands anywhere in the repo, and the deploy fails.
5. **Verify.** After the first deploy, `https://<your-domain>/` should
   load the home page and `/org-light` should load the four-stage
   page. If you hit 404s, the build probably failed — check the
   Railway deploy log.
6. **Custom domain.** Settings -> Networking -> Custom Domain. Point
   the apex / `www` A or CNAME at Railway and wait for cert issue.

### Phase 3. Backend on a VPS (45 min, optional)

This is what makes `/connect` do real OAuth and `/app` stream from a
real agent. Until this is up, the site runs in demo mode.

Full step-by-step is in `deploy/README.md`. The short version:

1. **Provision** a $10-20/mo VPS (Hetzner, DO, Hostinger). Install
   Docker + Docker Compose.
2. **DNS.** Two A records at the VPS IP:
   - `api.<your-domain>`   bridge API
   - `nango.<your-domain>` Nango dashboard
3. **Clone + env.** `git clone` the repo onto the VPS,
   `cp deploy/.env.example deploy/.env`, fill in secrets
   (`openssl rand -base64 32` for `NANGO_ENCRYPTION_KEY`, strong
   passwords for the DB and dashboard).
4. **First boot.** `docker compose up -d nango-db nango-server`,
   grab the Nango master key from first-boot logs, paste it into
   `NANGO_SECRET_KEY` in `.env`.
5. **Full stack.** `docker compose up -d`. Caddy issues Let's Encrypt
   certs automatically.
6. **Provider OAuth.** In the Nango dashboard, configure each provider
   with its OAuth client id/secret. Each provider's Integration Unique
   Key must exactly match the slug in the `PROVIDERS` map in
   `bridge/bridge.js` (e.g. `shopify`, `stripe`, `quickbooks`).
7. **Hermes.** The sidecar boots with a stub so `/app` streams
   placeholder text. To go live: uncomment the `hermes-agent` line in
   `bridge/hermes-sidecar/requirements.txt`, replace
   `_stream_response()` in `bridge/hermes-sidecar/sidecar.py` with a
   real call to the Hermes runtime
   (https://github.com/NousResearch/hermes-agent), then
   `docker compose build hermes-sidecar && docker compose up -d`.
8. **Verify.** `curl https://api.<your-domain>/healthz` should return
   `{"ok":true,...}`.

### Phase 4. Flip the frontend to live mode

Once the backend is up, point the frontend at it. In
`project/connect.html` AND `project/app.html` (and their mirrors in
`tend/project/`), find the config block at the top:

```html
<script>
  window.__TEND_CONFIG__ = { apiBase: null };
</script>
```

Set `apiBase` to the bridge URL:

```html
<script>
  window.__TEND_CONFIG__ = { apiBase: 'https://api.<your-domain>' };
</script>
```

Commit + push; Railway redeploys.

**Important for handoff:** the Quiet Golf demo expects `apiBase: null`.
Do not flip on `main` until the VPS backend is in production.

### Build pinning, why it matters

Railway uses Nixpacks. Nixpacks auto-detects the build target by
scanning the whole repo. Because this monorepo contains both a Node
frontend AND a Python sidecar under `bridge/hermes-sidecar/`,
Nixpacks's heuristic can flip the build target to Python and the
deploy will fail with 404s on every route.

Two files keep that from happening:

- `nixpacks.toml` — explicitly pins Node 20 and `node server.js`.
- `.railwayignore` — hides `bridge/`, `deploy/`, `cli/`, and `*.md`
  from the build context, so Nixpacks never even sees the Python
  files.

If you add a new build-signal file anywhere in the repo
(`requirements.txt`, `pyproject.toml`, `Dockerfile`, etc.) and the
Railway deploy starts 404'ing, that's the first place to look.

---

## Conventions

- **No em dashes anywhere in user-facing copy.** Use periods, commas, or
  "to" for ranges. This has been a consistent author preference.
- The site is **backend-focused**, not marketing/social. The workspace
  and `/connect` page deliberately exclude marketing/SMS/reviews
  categories. Don't reintroduce them without asking.
- Mirror every page edit into both `project/` and `tend/project/`.
- Bump `shared.css?v=N` whenever you change CSS so Railway's cache
  invalidates.
- Scroll-reveal: add `class="reveal"` to any element you want to fade
  in on scroll. Optional `style="--reveal-delay:0.1s"` for stagger.

---

## Where to find things

- Hero animation + four-stage layout: `project/org-light.html`
- Workspace demo data (Quiet Golf): `project/app.html`
- Connector list + categories: `project/connect.html`
- Provider OAuth map: `bridge/bridge.js` (`PROVIDERS` constant)
- Agent + skill templates: `deploy/agent-templates/templates/`
- Hermes integration seam: `bridge/hermes-sidecar/sidecar.py`
  (`_stream_response`)

---

## Contact

`hello@withtend.ai`
