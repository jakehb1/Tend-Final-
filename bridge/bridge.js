/**
 * tend bridge — small Node service that sits between the tend frontend
 * (withtend.ai/connect) and Nango (OAuth + scheduled sync provider).
 *
 * Runs on a VPS alongside Nango + Caddy. Pure Node built-ins, no deps.
 *
 * Env vars:
 *   PORT             — http port to listen on (default 8000)
 *   NANGO_HOST       — internal URL of the nango-server container
 *                      (default http://nango-server:3003)
 *   NANGO_SECRET_KEY — secret key minted by Nango on first boot
 *   STATE_FILE       — path to JSON state file (default ./data/state.json)
 *   ALLOW_ORIGIN     — CORS allow-origin (default *)
 *
 * Endpoints:
 *   GET  /healthz
 *   GET  /api/connectors/state?user=email             — list connectors for a user
 *   POST /api/connectors/:id/connect    {user}        — start OAuth, returns Nango session token
 *   POST /api/connectors/:id/disconnect {user}        — revoke + delete
 *   POST /api/webhooks/nango                          — Nango webhook (auth + sync events)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8000);
const NANGO_HOST = process.env.NANGO_HOST || 'http://nango-server:3003';
const NANGO_SECRET_KEY = process.env.NANGO_SECRET_KEY || '';
const STATE_FILE = process.env.STATE_FILE || './data/state.json';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

// Map connector id (used by the frontend) -> Nango integration ID
// (the "Provider Config Key" you set up inside Nango's dashboard).
// Adjust the right-hand strings to whatever you name your integrations.
const PROVIDERS = {
  // Revenue & orders
  'shopify':       'shopify',
  'stripe':        'stripe-app',
  'square':        'square',
  // Marketing & ads
  'meta-ads':      'facebook-ads',
  'google-ads':    'google-ads',
  'mailchimp':     'mailchimp',
  'klaviyo':       'klaviyo',
  // Finance & books
  'quickbooks':    'quickbooks',
  'xero':          'xero',
  'netsuite':      'netsuite',
  // Analytics
  'ga4':           'google-analytics',
  'amplitude':     'amplitude',
  // CRM & support
  'salesforce':    'salesforce',
  'hubspot':       'hubspot',
  'zendesk':       'zendesk',
  // Non-profit
  'bloomerang':    'bloomerang',
  'donorbox':      'donorbox',
  'salsa':         'salsa-engage',
  // Workspace & comms
  'slack':         'slack',
  'gmail':         'google-mail',
  'gdrive':        'google-drive',
  // Dental (cloud APIs only — Dentrix / Eaglesoft need a separate on-prem agent)
  'open-dental':   'open-dental',
  'solutionreach': 'solutionreach'
};

// ---------- state (single JSON file, swap for Postgres later) ----------

let state = { users: {} };
try {
  if (fs.existsSync(STATE_FILE)) {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }
} catch (e) {
  console.warn('Could not load state file, starting empty:', e.message);
}

function save() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getUser(email) {
  if (!state.users[email]) state.users[email] = { connectors: {} };
  return state.users[email];
}

function connectorIdFromProviderKey(providerKey) {
  return Object.keys(PROVIDERS).find((k) => PROVIDERS[k] === providerKey);
}

// ---------- Nango ----------

async function nango(pathname, init = {}) {
  if (!NANGO_SECRET_KEY) throw new Error('NANGO_SECRET_KEY not set');
  const url = NANGO_HOST.replace(/\/$/, '') + pathname;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${NANGO_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`nango ${pathname} -> ${res.status} ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

async function createConnectSession(email, connectorId) {
  const providerKey = PROVIDERS[connectorId];
  if (!providerKey) throw new Error(`unknown connector ${connectorId}`);

  const data = await nango('/connect/sessions', {
    method: 'POST',
    body: JSON.stringify({
      end_user: { id: email, email },
      allowed_integrations: [providerKey]
    })
  });
  return data;
}

async function revokeNangoConnection(providerKey, connectionId) {
  try {
    await nango(
      `/connection/${encodeURIComponent(connectionId)}?provider_config_key=${encodeURIComponent(providerKey)}`,
      { method: 'DELETE' }
    );
  } catch (e) {
    console.warn('nango revoke failed:', e.message);
  }
}

// ---------- helpers ----------

function send(res, status, body, contentType = 'application/json') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 256 * 1024) req.destroy(); });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ---------- router ----------

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  try {
    if (req.method === 'GET' && p === '/healthz') {
      return send(res, 200, { ok: true, providers: Object.keys(PROVIDERS).length });
    }

    if (req.method === 'GET' && p === '/api/connectors/state') {
      const user = url.searchParams.get('user');
      if (!user) return send(res, 400, { error: 'user required' });
      return send(res, 200, getUser(user).connectors);
    }

    const m1 = p.match(/^\/api\/connectors\/([^/]+)\/connect$/);
    if (req.method === 'POST' && m1) {
      const connectorId = m1[1];
      const { user } = await readJson(req);
      if (!user) return send(res, 400, { error: 'user required' });
      if (!PROVIDERS[connectorId]) return send(res, 404, { error: 'unknown connector' });

      const session = await createConnectSession(user, connectorId);
      const token = session?.data?.token || session?.token;
      const expiresAt = session?.data?.expires_at || session?.expires_at;
      return send(res, 200, { sessionToken: token, expiresAt, providerKey: PROVIDERS[connectorId] });
    }

    const m2 = p.match(/^\/api\/connectors\/([^/]+)\/disconnect$/);
    if (req.method === 'POST' && m2) {
      const connectorId = m2[1];
      const { user } = await readJson(req);
      if (!user) return send(res, 400, { error: 'user required' });

      const u = getUser(user);
      const conn = u.connectors[connectorId];
      if (conn?.nangoConnectionId && PROVIDERS[connectorId]) {
        await revokeNangoConnection(PROVIDERS[connectorId], conn.nangoConnectionId);
      }
      delete u.connectors[connectorId];
      save();
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && p === '/api/webhooks/nango') {
      const event = await readJson(req);
      const providerKey = event.providerConfigKey || event.provider_config_key;
      const connectorId = connectorIdFromProviderKey(providerKey);
      const email = event.endUser?.endUserId || event.endUser?.id || event.endUser?.email;

      if (connectorId && email) {
        const u = getUser(email);
        const now = Date.now();

        if (event.type === 'auth' && (event.success ?? true)) {
          u.connectors[connectorId] = {
            connected: true,
            connectedAt: now,
            syncedAt: now,
            nangoConnectionId: event.connectionId || event.connection_id || null
          };
          save();
          console.log(`[bridge] auth ok: ${email} -> ${connectorId}`);
        }

        if (event.type === 'sync' && (event.success ?? true)) {
          if (u.connectors[connectorId]) {
            u.connectors[connectorId].syncedAt = now;
            save();
          }
          // TODO: pipe synced records into the user's OpenClaw workspace.
          // For now we just record that a sync happened.
          console.log(`[bridge] sync ok: ${email} -> ${connectorId} (${event.modelName || ''})`);
        }
      }

      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('[bridge] error:', e);
    return send(res, 500, { error: e.message || 'internal' });
  }
});

server.listen(PORT, () => {
  console.log(`[bridge] listening on :${PORT}`);
  console.log(`[bridge] nango host: ${NANGO_HOST}`);
  console.log(`[bridge] providers configured: ${Object.keys(PROVIDERS).length}`);
});
