# tend

AI partner for small businesses. Static frontend + a small Node server with
real auth, Postgres-backed conversation persistence, and a Claude chat API.
All deployed on Railway. Optional self-hosted VPS stack adds real OAuth
(Nango) and a per-tenant agent runtime when you want that, but the default
Railway deploy ships an end-to-end product on its own.

Live: https://withtend.ai

---

## TL;DR for a new dev

```bash
git clone <this-repo> tend && cd tend
npm install
export ANTHROPIC_API_KEY=sk-ant-...
export DATABASE_URL=postgres://...        # Railway-style postgres
export SESSION_SECRET=$(openssl rand -base64 32)
node server.js
# open http://localhost:3000/login
```

Create an account, log in, hit `/app`, chat. Conversations persist across
reloads and are scoped to your user. Edits to `project/*.html` are live on
reload (no build step). Without `ANTHROPIC_API_KEY` the chat falls back to
canned replies. Without `DATABASE_URL` the static site still works but
signup/login/conversations return 503.

---

## What's in this repo

```
project/                  Site source (HTML/CSS/JS). The Railway deploy serves this.
tend/project/             Mirror of project/. Edits must land in both trees, see Conventions.
server.js                 Node server. Static files + /api/auth + /api/conversations + /api/chat.
package.json              Engines >= 18. Deps: pg, bcryptjs, jsonwebtoken.
railway.json              Railway deploy config.
nixpacks.toml             Pins Railway to Node 20. See "Build pinning" below.
.railwayignore            Hides bridge/, deploy/, cli/ from the Railway build context.

bridge/                   Optional VPS Node service. OAuth proxy + Hermes agent proxy.
bridge/bridge.js          Nango webhook, OAuth state, chat SSE to hermes-sidecar.
bridge/hermes-sidecar/    Python FastAPI wrapper around the Hermes agent runtime.

deploy/                   Optional Docker Compose stack (Nango + bridge + Caddy).
deploy/agent-templates/   Per-tenant agent + skill YAML templates.
deploy/README.md          VPS install guide.

cli/                      Helper scripts.
```

`project/` is the only directory you need to touch for almost all UI work.
`server.js` is a single file. `bridge/` and `deploy/` are scaffolding for a
future VPS that adds OAuth and on-prem agents; you can ignore them while
working on the product surface.

---

## Architecture

```
                            Railway
                  ┌────────────────────────────────────────┐
   browser ────►  │  project/*.html  (static, no build)    │
                  │                                        │
                  │  server.js                             │
                  │   ├─ static file serving               │
                  │   ├─ /api/auth/{signup,login,...}      │
                  │   ├─ /api/conversations[/:id]          │
                  │   └─ /api/chat/:convId ──┐             │
                  └──────────────────────────┼─────────────┘
                                 │           ▼
                                 │   api.anthropic.com (Claude)
                                 │   streaming Messages API
                                 ▼
                         Railway Postgres
                  ┌──────────────────────────────┐
                  │  users                       │
                  │  conversations               │
                  │  messages                    │
                  └──────────────────────────────┘

   ── optional, only if you stand up the VPS ──────────────────
                                  │
                                  ▼
                         VPS (Docker Compose)
   ┌──────────────────────────────────────────────────────────┐
   │  Caddy (HTTPS)                                           │
   │    ├─► bridge ──► Nango (OAuth + scheduled syncs)        │
   │    │           └─► hermes-sidecar (per-tenant agent)     │
   │    └─► nango-server (admin dashboard)                    │
   └──────────────────────────────────────────────────────────┘
```

- **Frontend**: plain HTML/CSS/JS, no build step. `project/` ships to
  Railway exactly as written. Protected pages (`/app`, `/onboarding`,
  `/connect`, `/data-brain`) check `/api/auth/me` on load and redirect to
  `/login` if no session.
- **Auth**: email + bcrypt-hashed password. Sessions are JWTs signed with
  `SESSION_SECRET`, stored in an httpOnly `tend.session` cookie. 30-day
  expiry. Same-origin only.
- **Chat backend**: `server.js` POST `/api/chat/:convId` is authed.
  Validates the conversation belongs to the current user, persists the
  user message, streams from Anthropic, accumulates the response, and
  persists it on completion.
- **Conversation memory**: stored in Postgres (`conversations`,
  `messages`). The server loads the last 20 messages from the DB for
  context on each turn, so memory persists across reloads and devices.
- **Demo fallback**: if `ANTHROPIC_API_KEY` isn't set, `/api/chat` returns
  503 and the client transparently falls back to canned replies. Without
  `DATABASE_URL`, auth and conversation endpoints return 503 but the
  static site still loads.
- **VPS (optional)**: when you eventually want real OAuth and a per-tenant
  agent, see `deploy/README.md`. The frontend has hooks for it but doesn't
  require it.

---

## Key pages

| Path             | What it is                                                |
| ---------------- | --------------------------------------------------------- |
| `/`              | Marketing home                                            |
| `/about`         | About                                                     |
| `/platform`      | Product overview                                          |
| `/use-cases`     | Use cases                                                 |
| `/org`           | Lighter-tier marketing variant                            |
| `/org-light`     | Light-theme variant of `/org`                             |
| `/login`         | Demo auth. Any email/password works. Writes session.      |
| `/onboarding`    | Post-login wizard. Writes `tend.onboarded` to localStorage|
| `/connect`       | Connector picker. Demo-mode toggles via localStorage.     |
| `/app`           | Workspace + chat surface. Default landing after login.    |
| `/data-brain`    | Connections overview. Accessible from the sidebar gear.   |

All pages share `project/shared.css`. Cache-bust by bumping `?v=N` in the
`<link>` tags after editing.

---

## API reference

All API endpoints live in `server.js`. They share JSON request/response
bodies and use the `tend.session` httpOnly cookie for auth.

### Auth

| Endpoint                  | Method | Auth | Body                            | Response                              |
| ------------------------- | ------ | ---- | ------------------------------- | ------------------------------------- |
| `/api/auth/signup`        | POST   | no   | `{email, password}` (pass ≥ 6)  | `{user}` + sets cookie. 409 if dupe.  |
| `/api/auth/login`         | POST   | no   | `{email, password}`             | `{user}` + sets cookie. 401 if wrong. |
| `/api/auth/logout`        | POST   | no   | —                               | 204, clears cookie.                   |
| `/api/auth/me`            | GET    | yes  | —                               | `{user}` or 401.                      |

`user` shape: `{id, email, created_at}`. The cookie is `tend.session`,
httpOnly + SameSite=Lax + 30-day Max-Age. `Secure` flag is on in
production, off in dev so localhost over HTTP works.

### Conversations

All require a valid session.

| Endpoint                       | Method | Body | Response                                 |
| ------------------------------ | ------ | ---- | ---------------------------------------- |
| `/api/conversations`           | GET    | —    | `{conversations: [{id, title, ...}]}`    |
| `/api/conversations`           | POST   | —    | `{conversation: {...}}` (new, empty)     |
| `/api/conversations/:id`       | GET    | —    | `{conversation: {..., messages: [...]}}` |
| `/api/conversations/:id`       | DELETE | —    | 204                                      |

Conversation shape: `{id, title, created_at, updated_at}`. Message shape:
`{role: 'user'|'assistant', content, created_at}`. Titles auto-populate
from the first 60 chars of the first user message.

### Chat (streaming)

```
POST /api/chat/:conversationId
body: { "message": "..." }
```

Returns an SSE stream:

```
data: {"delta":"chunk of text"}
...
data: [DONE]
```

On error: `data: {"error":"..."}` and the connection closes.

Server-side flow on each request:
1. Verify session, verify conversation ownership.
2. Insert the user message into `messages`.
3. If conversation title is still `New chat`, set it to the first 60
   chars of this message.
4. Load the last 20 messages from the DB → history.
5. Stream from `api.anthropic.com/v1/messages` (`claude-sonnet-4-6`,
   `max_tokens: 1024`, `stream: true`, baked `system` prompt).
6. Re-emit Anthropic's `content_block_delta` as our `{delta}` shape so the
   client doesn't need to know the upstream wire format.
7. Accumulate the streamed text into `assistantText`. On stream end,
   insert it as an `assistant` message and bump `conversations.updated_at`.

### Database schema

Created on boot by `migrate()` in `server.js`. Idempotent
`CREATE TABLE IF NOT EXISTS`, safe to re-run.

```sql
users(id, email UNIQUE, password_hash, created_at)
conversations(id, user_id → users, title, created_at, updated_at)
messages(id, conversation_id → conversations, role, content, created_at)
```

Plus indexes on `conversations(user_id, updated_at DESC)` and
`messages(conversation_id, created_at)`.

### To change the model

Edit `model: 'claude-sonnet-4-6'` in `server.js`. The latest model IDs are:
- `claude-opus-4-7` (most capable)
- `claude-sonnet-4-6` (current default, good balance)
- `claude-haiku-4-5-20251001` (fastest, cheapest)

### To change the system prompt

Edit `SYSTEM_PROMPT` at the top of `server.js`. If you remove the Quiet
Golf snapshot, the agent loses its grounding and starts hallucinating
business data, so leave it in until real connectors are wired.

---

## Run locally

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
export DATABASE_URL=postgres://localhost/tend       # or your Railway URL
export SESSION_SECRET=$(openssl rand -base64 32)
node server.js
# open http://localhost:3000/login
```

On first boot, `server.js` runs `migrate()` and creates the three tables
if they don't exist. Idempotent, safe to re-run.

Without `ANTHROPIC_API_KEY`: `/api/chat` returns 503, the client falls
back to canned demo replies.
Without `DATABASE_URL`: signup/login and conversation endpoints return
503; the static site still loads but you can't sign in or chat.
Without `SESSION_SECRET`: a random one is generated on boot. Existing
sessions break on every restart. Fine for dev, not for prod.

Routes are filename-based: `/data-brain` serves `project/data-brain.html`,
`/about` serves `project/about.html`, etc. No build, no hot reload, just
refresh the browser.

### Local Postgres options

Easiest is to use your Railway DB connection string in dev too (free tier
covers it). Otherwise install Postgres locally and create a `tend`
database: `createdb tend && export DATABASE_URL=postgres://localhost/tend`.

---

## Deploy to Railway

The static site, auth, conversation persistence, and chat API all live on
the same Railway service.

1. **Connect the repo.** Railway dashboard → New Project → Deploy from
   GitHub → pick this repo.
2. **Branch.** Settings → Source → Branch. Live deploys from
   `claude/prepare-railway-deployment-ujRcM` today; move to `main` once
   merged.
3. **Add Postgres.** Project → New → Database → Postgres. Railway sets
   `DATABASE_URL` on the service automatically. The migration runs on the
   next boot and creates the schema.
4. **Set the other env vars.** Service → Variables:
   - `ANTHROPIC_API_KEY` — from console.anthropic.com → API Keys.
   - `SESSION_SECRET` — generate with `openssl rand -base64 32`. Required
     in production so sessions survive restarts and deploys.
5. **Verify.** After deploy, hit `/login`, create an account, log in,
   send a chat message. Reload `/app`; the conversation should still be
   in the sidebar.
6. **Custom domain.** Settings → Networking → Custom Domain. Point apex /
   www at Railway and wait for the cert.

### Production env vars

| Variable             | Required?       | What it does                                    |
| -------------------- | --------------- | ----------------------------------------------- |
| `DATABASE_URL`       | yes for auth    | Postgres connection string. Railway auto-sets.  |
| `ANTHROPIC_API_KEY`  | yes for chat    | Claude API key. Without it, demo fallback.      |
| `SESSION_SECRET`     | yes in prod     | Signs the JWT cookie. Sessions break on change. |
| `PORT`               | optional        | Railway sets this. Defaults to 3000 in dev.     |
| `NODE_ENV`           | optional        | `production` enables `Secure` cookies.          |
| `RAILWAY_ENVIRONMENT`| auto            | Railway sets this. Also enables `Secure`.       |

### Build pinning

Railway uses Nixpacks, which auto-detects the build target by scanning the
whole repo. Because this monorepo has Python under `bridge/hermes-sidecar/`,
Nixpacks's heuristic can flip the build target to Python and the deploy
404s on every route. Two files prevent this:

- `nixpacks.toml` pins Node 20 and `node server.js`.
- `.railwayignore` hides `bridge/`, `deploy/`, `cli/`, `*.md` from the
  build context.

If you add a `requirements.txt`, `pyproject.toml`, `Dockerfile`, etc.
anywhere in the repo and the deploy starts 404'ing, that's the first place
to check.

---

## Optional: VPS for real OAuth and a self-hosted agent

This is what makes `/connect` perform real OAuth and `/app` route through
a per-tenant agent runtime instead of the default Claude pass-through.

Full guide: `deploy/README.md`. Short version:

1. Provision a $10-20/mo VPS, install Docker + Compose.
2. Two A records: `api.<your-domain>` and `nango.<your-domain>` → VPS IP.
3. `cp deploy/.env.example deploy/.env`, fill secrets (`openssl rand
   -base64 32` for `NANGO_ENCRYPTION_KEY`).
4. `docker compose up -d nango-db nango-server`, grab Nango master key
   from logs, paste into `NANGO_SECRET_KEY`.
5. `docker compose up -d` for the full stack. Caddy auto-issues
   Let's Encrypt certs.
6. In the Nango dashboard, configure each provider's OAuth client. Each
   integration's Unique Key must match the slug in the `PROVIDERS` map in
   `bridge/bridge.js` (`shopify`, `stripe`, `quickbooks`, etc.).
7. To use Hermes instead of the default Claude path, replace
   `_stream_from_stub()` in `bridge/hermes-sidecar/sidecar.py` with a real
   call to the Hermes runtime, then update the frontend's `apiBase` to
   point at the VPS bridge URL instead of same-origin.
8. `curl https://api.<your-domain>/healthz` should return `{"ok":true,...}`.

---

## Production roadmap (Hermes / OpenClaw harness)

Today the chat goes Browser → `server.js` → Claude API. That's the
"good enough for the demo" path. The intended production architecture
is per-tenant OpenClaw agents that route through Hermes and have access
to live data via Nango-synced skills. Most of the scaffolding is in the
repo; here's what's actually wired up vs. still stubbed.

### Already in place

- `bridge/bridge.js` — Node service. Has `hermesChat()`, Nango connect
  session creation, connection revoke, and a Nango webhook handler.
- `bridge/hermes-sidecar/sidecar.py` — FastAPI sidecar exposing `/chat`
  with SSE streaming. Talks to the bridge, isolates Python so Node
  doesn't have to load it.
- `deploy/docker-compose.yml` — Nango (server + Postgres) + bridge +
  hermes-sidecar + Caddy.
- `deploy/agent-templates/templates/` — `agent.ecomm.yaml` plus skill
  YAMLs for `query_orders`, `top_skus`, `meta_ads_summary`.
- The frontend already has the seam: flip `apiBase` from
  `window.location.origin` to your VPS bridge URL and the chat starts
  hitting the bridge instead of the local `/api/chat`.

### What's left (in dependency order)

1. **Stand up an OpenClaw Gateway.**
   `deploy/docker-compose.yml` does not include an OpenClaw service yet.
   Add it as a sibling to `hermes-sidecar`. The bridge currently routes
   chat at the *sidecar*; once OpenClaw is the orchestrator, the sidecar
   becomes a backend the Gateway can call.

2. **Replace the Hermes sidecar stub.**
   `bridge/hermes-sidecar/sidecar.py` lines 103-106:

   ```python
   # ---- begin TODO: replace with Hermes call ----
   async for chunk in _stream_from_stub(agent_name, message):
       yield chunk
   # ---- end TODO ----
   ```

   Swap `_stream_from_stub` for a real Hermes runtime call. Uncomment the
   `hermes-agent` line in `bridge/hermes-sidecar/requirements.txt` and
   rebuild the image.

3. **Write `provisionTenant()`.**
   `deploy/agent-templates/README.md` references a provisioner that fills
   the `${TENANT_ID}`, `${TENANT_NAME}`, etc. tokens in
   `agent.ecomm.yaml` and writes the result into the OpenClaw Gateway's
   agents directory. This function does not exist yet. Suggested home:
   `bridge/provisioner.js`, called on first login or from a CLI command.

4. **Expose per-tenant data endpoints in the bridge.**
   The skill YAMLs reference endpoints shaped like
   `GET /api/data/${TENANT_USER}/<dataset>?<filters>` (orders, top_skus,
   etc.). `bridge/bridge.js` does not implement these yet. Each one is
   typically a thin wrapper around Nango sync state in Postgres.

5. **Tenant persistence layer.**
   Nango handles OAuth and scheduled syncs, but the synced data needs a
   home so the bridge's data endpoints (step 4) have something to read.
   No DB schema exists yet for tenant order/inventory/finance state.
   Recommended: one Postgres schema per tenant, populated by Nango
   sync handlers in the webhook.

6. **Flesh out the skill set.**
   Three skill YAMLs ship today (`query_orders`, `top_skus`,
   `meta_ads_summary`). The agent-templates README sketches the full
   e-commerce skill list (`customer_segments`, `inventory_status`, plus
   non-profit and dental verticals). Each new skill is a YAML file + a
   matching bridge endpoint.

7. **Auth and tenant isolation.**
   `/login` currently writes any email/password into sessionStorage. Real
   product needs proper auth (e.g. magic link or OAuth) and tenant
   identifiers that map 1:1 to OpenClaw agent IDs. `agentNameForUser()`
   in `bridge/bridge.js` is a placeholder slugifier of the email.

8. **Flip the frontend.**
   Once steps 1-7 work end-to-end, change
   `window.__TEND_CONFIG__.apiBase` in `project/app.html` from
   `window.location.origin` to your bridge URL
   (e.g. `https://api.withtend.ai`). The existing `replyLive()` function
   already speaks the bridge's SSE format; no client changes required.
   Keep `server.js` `/api/chat` as the fallback so anything that doesn't
   yet route through OpenClaw still works.

### Things that don't need to change

- The frontend chat client. `replyLive()` already streams from any
  SSE endpoint that emits `{delta}` chunks. The bridge speaks this same
  shape on purpose.
- The system prompt. Once tenants are real, move
  `SYSTEM_PROMPT` content into the per-tenant `workspace/business-
  profile.md` and let the OpenClaw agent load it as context per turn.
  `server.js` can keep its baked-in prompt as the fallback path.
- The demo fallback. `replyCanned()` is the safety net when *any* live
  path returns an error. Keep it.

---

## Conventions

- **No em dashes anywhere in user-facing copy.** Use periods, commas, or
  "to" for ranges. Consistent author preference.
- **Mirror every page edit into both `project/` and `tend/project/`.**
  Both directories ship to Railway. The live site reads from `project/`,
  but the design-bundle layout in `tend/project/` must stay in sync. The
  simplest workflow: edit `project/X.html`, then `cp project/X.html
  tend/project/X.html` before committing.
- **Bump `shared.css?v=N`** in the `<link>` tags whenever you change
  `shared.css` so Railway's HTTP cache invalidates.
- **Light theme overrides.** `/app`, `/data-brain`, and `/connect` each
  override the global dark theme via a `:root { --bg: #FAF9F5; ... }`
  block at the top of their inline `<style>`. Match this pattern for any
  new product-surface page. Marketing pages keep the dark theme.
- **No marketing or social connectors** in `/connect` or the workspace.
  The product is backend-focused (orders, inventory, fulfillment, cash).
  Don't reintroduce SMS/reviews/social without asking.
- **Logo on light backgrounds**: add `filter: brightness(0)` to the
  `<img>`. The asset is white by default for the dark theme.

---

## Common tasks

### Add a field to the user record

Edit the `users` schema in `migrate()` in `server.js`. The migration is
`CREATE TABLE IF NOT EXISTS`, so adding columns means writing a separate
`ALTER TABLE IF NOT EXISTS` statement below the `CREATE`. Then update
`handleSignup` / `handleLogin` / `userFromRequest` to read/write the new
field, and update `/api/auth/me` callers in the frontend.

### Reset your local DB

```bash
psql $DATABASE_URL -c 'DROP TABLE messages, conversations, users CASCADE'
node server.js   # migrate() rebuilds them
```

### Change the agent's voice or business context

`SYSTEM_PROMPT` constant at the top of `server.js`. The current prompt
includes the full Quiet Golf demo snapshot (orders, inventory, team
updates) so responses stay grounded.

### Add a suggestion card to the empty chat state

In `project/app.html`, find `<div class="empty-hints" id="hints">`. Each
card is a `<button class="empty-hint" type="button" data-text="...">`.
The `data-text` is what gets sent into the composer on click. Add an SVG
icon in `.eh-icon`, title in `.eh-title`, subtitle in `.eh-sub`. Then
mirror to `tend/project/app.html`.

### Add a slash command to the composer

`CMD_PROMPTS` map in `project/app.html` JS section. Add a new entry like:

```js
'/forecast': {
  ask: "What do you want me to forecast?",
  placeholder: "e.g. next 30 days of Sage Polo demand"
}
```

Then add a matching `<button>` to the `#cmd-menu` div with
`data-cmd="/forecast "`. The paperclip menu opens it.

### Add a new connection to the Data Brain accordion

`project/data-brain.html`, find the `<!-- CONNECTIONS -->` section. Each
connection is a `<details class="db-row">` block. Copy an existing one,
change the name / status / description / link. The accordion is native
`<details>`/`<summary>`, no JS.

### Add a new page

Create `project/<name>.html`. Filename = URL (`/<name>`). Link to
`shared.css?v=N`. If it's a product surface, copy the light-theme
`:root` override from `app.html`. Mirror to `tend/project/`.

### Adjust the canned-reply fallback

`project/app.html` has a `canned` array near the top of the IIFE. Each
entry is `{ match: /regex/i, html: "...", sources: [...] }`. The last
entry with `match: /.*/` is the catch-all. Order matters: first match wins.

---

## Where things live

| Thing                                | File                                              |
| ------------------------------------ | ------------------------------------------------- |
| Auth endpoints + JWT helpers         | `server.js` (handleSignup/Login/Logout/Me)        |
| DB schema + migration                | `server.js` (`migrate()` function)                |
| Conversation endpoints               | `server.js` (list/create/get/delete handlers)     |
| Chat API + Anthropic streaming       | `server.js` (`handleChat`)                        |
| Agent system prompt                  | `server.js` (`SYSTEM_PROMPT` const)               |
| Sign in / sign up UI                 | `project/login.html`                              |
| Workspace UI (chat, sidebar, empty)  | `project/app.html`                                |
| Conversation list (sidebar Recent)   | `project/app.html` (`#conv-list`, `loadConversations`) |
| Auth gate (per protected page)       | inline `<script>` calls `/api/auth/me` on load    |
| Connections accordion + graph        | `project/data-brain.html`                         |
| Connector list (per-provider)        | `project/connect.html`                            |
| Canned replies (demo fallback)       | `project/app.html` (`canned` array)               |
| Slash commands                       | `project/app.html` (`CMD_PROMPTS` map + #cmd-menu)|
| Suggestion cards                     | `project/app.html` (`.empty-hints`)               |
| Hero animation + four-stage layout   | `project/org-light.html`                          |
| Shared light-theme palette           | inline `:root` override at top of each page       |
| Provider OAuth map (VPS-only)        | `bridge/bridge.js` (`PROVIDERS` const)            |
| Agent + skill templates (VPS-only)   | `deploy/agent-templates/templates/`               |
| Hermes integration seam (VPS-only)   | `bridge/hermes-sidecar/sidecar.py`                |

---

## Contact

`hello@withtend.ai`
