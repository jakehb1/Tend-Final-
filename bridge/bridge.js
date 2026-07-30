/**
 * tend bridge. Small Node service that sits between the tend frontend
 * (withtend.ai/connect, withtend.ai/app) and:
 *   - Nango           (OAuth + scheduled provider syncs)
 *   - Hermes sidecar  (per-tenant AI agent runtime, Python)
 *
 * Runs on a VPS alongside Nango + Caddy. Pure Node built-ins, no deps.
 *
 * Env vars:
 *   PORT                   http port (default 8000)
 *   NANGO_HOST             internal URL of nango-server (default http://nango-server:3003)
 *   NANGO_SECRET_KEY       secret key minted by Nango on first boot
 *   HERMES_SIDECAR_URL     URL of the Hermes Python sidecar (default http://hermes-sidecar:8500)
 *   HERMES_AGENT_DEFAULT   fallback agent name when a user has no provisioned agent
 *   STATE_FILE             path to JSON state file (default ./data/state.json)
 *   ALLOW_ORIGIN           CORS allow-origin (default *)
 *
 * Endpoints:
 *   GET  /healthz
 *   GET  /api/connectors/state?user=email             list connectors
 *   POST /api/connectors/:id/connect    {user}        start Nango OAuth
 *   POST /api/connectors/:id/disconnect {user}        revoke + delete
 *   POST /api/webhooks/nango                          Nango auth + sync events
 *   POST /api/chat/:user        {message}             proxy to Hermes agent (SSE response)
 *   GET  /api/data/:user/:dataset?since=&limit=       records from synced data
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8000);
const NANGO_HOST = process.env.NANGO_HOST || 'http://nango-server:3003';
const NANGO_SECRET_KEY = process.env.NANGO_SECRET_KEY || '';
const HERMES_SIDECAR_URL = process.env.HERMES_SIDECAR_URL || 'http://hermes-sidecar:8500';
const HERMES_AGENT_DEFAULT = process.env.HERMES_AGENT_DEFAULT || 'main';
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

let state = { users: {}, data: {} };
try {
  if (fs.existsSync(STATE_FILE)) {
    state = Object.assign({ users: {}, data: {} }, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
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

function getUserData(email) {
  if (!state.data[email]) state.data[email] = {};
  return state.data[email];
}

function connectorIdFromProviderKey(providerKey) {
  return Object.keys(PROVIDERS).find((k) => PROVIDERS[k] === providerKey);
}

// Map a user email to an OpenClaw agent name. The real implementation would
// look up a tenant -> agent mapping in the DB. For now we slugify the email
// local part so it's deterministic.
function agentNameForUser(email) {
  const local = (email || '').split('@')[0] || HERMES_AGENT_DEFAULT;
  return local.toLowerCase().replace(/[^a-z0-9-]/g, '-') || HERMES_AGENT_DEFAULT;
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

// ---------- Hermes ----------
//
// Hermes is a Python agent runtime (https://github.com/NousResearch/hermes-agent).
// We don't talk to it directly from Node. Instead we run a thin Python
// sidecar that imports Hermes and exposes one HTTP endpoint:
//
//   POST /chat  {agent, message, stream: true}  ->  SSE stream
//
// The sidecar code lives in bridge/hermes-sidecar/. When you wire the
// real Hermes Python API, edit sidecar.py and nothing in this file
// should need to change.

async function hermesChat(agent, message, onChunk) {
  const url = HERMES_SIDECAR_URL.replace(/\/$/, '') + '/chat';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent, message, stream: true })
  });
  if (!res.ok) throw new Error(`hermes ${res.status}: ${await res.text().catch(() => '')}`);
  if (!res.body) throw new Error('hermes returned no body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
      if (payload === '[DONE]') return;
      try {
        const obj = JSON.parse(payload);
        const chunk = obj.text || obj.delta || obj.content || obj.message;
        if (chunk) onChunk(String(chunk));
      } catch (_) {
        if (payload) onChunk(payload);
      }
    }
  }
  if (buf.trim()) onChunk(buf.trim());
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
          }
          // Upsert records into the data store keyed by user + dataset.
          // Dataset is Nango's model name (e.g. "orders", "products").
          const records = Array.isArray(event.records) ? event.records : [];
          if (records.length) {
            const dataset = event.modelName || event.model || connectorId;
            const data = getUserData(email);
            if (!data[dataset]) data[dataset] = [];
            const index = new Map(data[dataset].map((r, i) => [r.id ?? r._id ?? i, i]));
            for (const r of records) {
              const id = r.id ?? r._id;
              if (id !== undefined && index.has(id)) {
                data[dataset][index.get(id)] = r;
              } else {
                data[dataset].push(r);
              }
            }
            // Cap at 50k records per dataset per user (rough safety bound)
            if (data[dataset].length > 50000) {
              data[dataset] = data[dataset].slice(-50000);
            }
          }
          save();
          console.log(`[bridge] sync ok: ${email} -> ${connectorId} ${event.modelName || ''} (${records.length} records)`);
        }
      }

      return send(res, 200, { ok: true });
    }

    // POST /api/chat/:user  {message}
    // Streams the agent's response back as SSE.
    const chatMatch = p.match(/^\/api\/chat\/([^/]+)$/);
    if (req.method === 'POST' && chatMatch) {
      const user = decodeURIComponent(chatMatch[1]);
      const body = await readJson(req);
      const message = String(body.message || '').slice(0, 8000);
      if (!message) return send(res, 400, { error: 'message required' });

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': ALLOW_ORIGIN,
        'X-Accel-Buffering': 'no'
      });

      const agent = body.agent || agentNameForUser(user);
      try {
        await hermesChat(agent, message, (chunk) => {
          res.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
        });
        res.write('data: [DONE]\n\n');
      } catch (e) {
        console.error('[bridge] chat error:', e);
        res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
      }
      res.end();
      return;
    }

    // GET /api/data/:user/:dataset?since=ISO&limit=N
    // Returns records from the user's synced data. Pull pattern: agent skills
    // call this when they need fresh numbers.
    const dataMatch = p.match(/^\/api\/data\/([^/]+)\/([^/]+)$/);
    if (req.method === 'GET' && dataMatch) {
      const user = decodeURIComponent(dataMatch[1]);
      const dataset = decodeURIComponent(dataMatch[2]);
      const records = state.data?.[user]?.[dataset] || [];

      let filtered = records;
      const sinceParam = url.searchParams.get('since');
      if (sinceParam) {
        const sinceTs = Number(sinceParam) || Date.parse(sinceParam);
        if (sinceTs) {
          filtered = records.filter((r) => {
            const ts = Date.parse(r.created_at || r.createdAt || r.updated_at || r.updatedAt || '');
            return ts && ts >= sinceTs;
          });
        }
      }
      const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 5000);
      filtered = filtered.slice(0, limit);

      return send(res, 200, {
        user,
        dataset,
        count: filtered.length,
        total: records.length,
        records: filtered
      });
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
