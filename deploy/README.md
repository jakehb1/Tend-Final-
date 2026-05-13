# tend connectors. VPS deploy

Stack: **Nango** (OAuth + scheduled sync) + **bridge** (small Node API that the
frontend talks to) + **hermes-sidecar** (per-tenant AI agent runtime, Python
FastAPI wrapper around https://github.com/NousResearch/hermes-agent) +
**Caddy** (HTTPS reverse proxy).

Runs on a $10 to $20/mo VPS. Handles dozens of small tenants on one box.

## Prerequisites

- A VPS with Docker + Docker Compose (Hetzner CPX21, Digital Ocean Basic, Hostinger VPS)
- A domain you control (e.g. `withtend.ai`)
- Two A records pointing at the VPS IP:
  - `api.withtend.ai` — the bridge API
  - `nango.withtend.ai` — Nango's dashboard

## First-time setup

```bash
# 1. SSH to the VPS and clone (or scp) the repo
git clone <repo-url> tend && cd tend/deploy

# 2. Copy the env template
cp .env.example .env

# 3. Fill in .env. Generate the encryption key:
openssl rand -base64 32
#    Paste output into NANGO_ENCRYPTION_KEY.
#    Set strong values for DB password and dashboard password.

# 4. First boot. Bridge will fail to start (no secret key yet) — that's expected.
docker compose up -d nango-db nango-server

# 5. Get the Nango secret key from its first-boot logs:
docker compose logs nango-server | grep -i "secret"
#    Or look for "API key" / "Master key" in the logs.
#    Paste it into NANGO_SECRET_KEY in .env.

# 6. Bring up the rest
docker compose up -d
docker compose ps
```

Visit `https://api.withtend.ai/healthz` — should return `{"ok":true,"providers":24}`.
Visit `https://nango.withtend.ai` — log in with the dashboard creds from `.env`.

## Configure providers (one-time per integration)

Inside Nango's dashboard, for each provider you want live, you create an
"Integration" with that provider's OAuth credentials.

For **Shopify** (do this one first, it's the easiest):

1. In Nango dashboard → **Integrations** → **+ Configure new integration**
2. Pick **Shopify** from the list
3. Set the **Integration Unique Key** to exactly `shopify`
   (this must match the `PROVIDERS` map in `bridge/bridge.js`)
4. Get OAuth credentials from your **Shopify Partners** account
   (create a public app at https://partners.shopify.com)
5. Paste **Client ID** and **Client Secret** into Nango
6. Add scopes (e.g. `read_orders,read_products,read_customers`)
7. Save

Repeat for any other providers you want to enable.

The Provider Config Keys (left column of `PROVIDERS` in `bridge.js`) are
intentionally simple lowercase slugs that match the frontend's `data-conn`
attributes on each `/connect.html` row. Keep them in sync.

## Wire the frontend

In `project/connect.html` (and the `tend/project/connect.html` mirror), the
config block at the top is currently:

```html
<script>
  window.__TEND_CONFIG__ = { apiBase: null };
</script>
```

Flip `apiBase` to your bridge URL:

```html
<script>
  window.__TEND_CONFIG__ = { apiBase: 'https://api.withtend.ai' };
</script>
```

When `apiBase` is set, `/connect.html` calls the real bridge and drives the
Nango Connect UI for the actual OAuth popup. When `apiBase` is `null`, the
page falls back to the localStorage demo mode — useful while you're still
provisioning the VPS or showing the page in a static preview.

## Test the round trip

1. Visit `https://withtend.ai/login`
2. Log in (any email + password — demo auth)
3. Skip past onboarding (or finish it)
4. Visit `https://withtend.ai/connect`
5. Click **Connect →** on Shopify
6. Nango opens an OAuth popup → install on a test store → approve
7. Popup closes; the row flips to `● Connected · synced just now`

Under the hood:

```
browser ─► withtend.ai/connect.html
        ─► POST api.withtend.ai/api/connectors/shopify/connect {user}
        ─► bridge calls nango ─► returns short-lived session token
        ◄─ bridge returns token to browser
browser ─► loads Nango Connect UI, opens OAuth popup with token
        ─► user approves on Shopify
        ─► Shopify ─► Nango callback ─► Nango stores tokens
        ─► Nango POSTs auth-event webhook to bridge
        ─► bridge updates state.json: shopify = connected
browser ─► polls GET /api/connectors/state ─► sees connected, flips UI
```

## Where the data ends up

For now, this stack handles **OAuth only**. Once a connection is live,
the next step is per-provider **syncs**, small scripts that pull data
from each provider on a schedule and push it into the customer's
Hermes workspace.

Syncs are authored as TypeScript functions and deployed via the Nango
CLI; see https://docs.nango.dev for the pattern. The bridge's sync
webhook (currently logs only) is where we'll add the Hermes write path.

## Wiring Hermes

The `hermes-sidecar` service starts with a stub so the chat path works
end to end before Hermes is installed. To go live:

1. Install Hermes inside the sidecar image. Uncomment the
   `hermes-agent` line in `bridge/hermes-sidecar/requirements.txt`,
   then `docker compose build hermes-sidecar`.
2. Replace `_stream_response()` in `bridge/hermes-sidecar/sidecar.py`
   with a real call to the Hermes runtime (see the doc comment in that
   file for the recommended pattern).
3. Drop your per-tenant agent + skill YAMLs into `deploy/agent-templates/`.
   They are mounted read-only at `/var/lib/hermes/templates` inside the
   sidecar. The sidecar copies them into `HERMES_CONFIG_DIR` on first
   boot for each tenant.
4. `docker compose up -d hermes-sidecar bridge`. Health-check:
   `curl https://api.withtend.ai/healthz` should still return ok, and
   the bridge's `/api/chat/:user` SSE proxy should stream Hermes deltas
   instead of the stub.

## Updating

```bash
git pull
docker compose pull          # pull new Nango / Caddy images
docker compose build bridge  # rebuild bridge after code changes
docker compose up -d
```

## Backup

The data that matters lives in two volumes:

- `nango_db_data` — encrypted OAuth tokens
- `bridge_data`   — `state.json`

```bash
docker run --rm -v tend_nango_db_data:/data -v $PWD:/backup alpine \
  tar czf /backup/nango_db_$(date +%F).tar.gz -C /data .
docker run --rm -v tend_bridge_data:/data -v $PWD:/backup alpine \
  tar czf /backup/bridge_$(date +%F).tar.gz -C /data .
```

## Troubleshooting

- **`401` from bridge → nango**: the `NANGO_SECRET_KEY` in `.env` is
  wrong or Nango regenerated it. Check `docker compose logs nango-server`.
- **Browser can't reach `api.withtend.ai`**: DNS not propagated yet or
  Caddy hasn't issued the cert. Watch `docker compose logs caddy`.
- **OAuth popup says "redirect URI mismatch"**: the provider's OAuth app
  needs your Nango callback URL added. Each provider config in Nango
  shows the exact URL — paste it into the provider's OAuth settings.
- **Webhook never fires**: confirm `NANGO_WEBHOOK_URL` is set in the
  Nango env and reachable from the nango-server container
  (`http://bridge:8000/api/webhooks/nango`).
