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
railway.json              Railway config.

bridge/                   Optional Node service the frontend can call for live data.
bridge/bridge.js          OAuth state + chat SSE proxy + Nango webhook handler.
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

## Deploy

### Frontend (Railway)

Push to `main`. Railway picks up the `railway.json` config and runs
`node server.js`. No build step.

### Backend (VPS) — optional

See `deploy/README.md`. Summary:

1. Provision a small VPS, point two A records at it (`api.withtend.ai`,
   `nango.withtend.ai`).
2. `cp deploy/.env.example deploy/.env` and fill in secrets.
3. `docker compose up -d nango-db nango-server`, grab the Nango secret
   key from the first-boot logs, paste into `.env`.
4. `docker compose up -d`. Caddy issues certs automatically.
5. Configure each provider once in the Nango dashboard. Provider keys must
   match the `PROVIDERS` map in `bridge/bridge.js` and the `data-conn`
   attributes on `/connect.html`.
6. To turn on Hermes: install the `hermes-agent` package inside the
   sidecar image (see `bridge/hermes-sidecar/README.md`) and replace the
   `_stream_response()` stub with a real call.

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
