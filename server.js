const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ─── Demo config (swappable per deployment) ───────────────────────────────
// Resolution order:
//   1. DEMO_CONFIG_PATH (absolute path to a json file)
//   2. DEMO_CLIENT      (loads ./config/demos/<DEMO_CLIENT>.json)
//   3. ./config/demo.json (default)
function resolveDemoConfigPath() {
  if (process.env.DEMO_CONFIG_PATH && fs.existsSync(process.env.DEMO_CONFIG_PATH)) {
    return process.env.DEMO_CONFIG_PATH;
  }
  if (process.env.DEMO_CLIENT) {
    const candidate = path.join(__dirname, 'config', 'demos', `${process.env.DEMO_CLIENT}.json`);
    if (fs.existsSync(candidate)) return candidate;
    console.warn(`warning: DEMO_CLIENT=${process.env.DEMO_CLIENT} but ${candidate} not found.`);
  }
  const fallback = path.join(__dirname, 'config', 'demo.json');
  return fs.existsSync(fallback) ? fallback : null;
}

const DEMO_CONFIG_PATH = resolveDemoConfigPath();
const demoConfig = DEMO_CONFIG_PATH
  ? JSON.parse(fs.readFileSync(DEMO_CONFIG_PATH, 'utf8'))
  : null;
if (demoConfig) console.log(`config: loaded ${DEMO_CONFIG_PATH} (client: ${demoConfig.client?.name || 'unknown'})`);
else            console.log('config: no demo config found, using built-in fallback');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, 'project');
const COOKIE_NAME = 'tend.session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
const IS_PRODUCTION = !!(process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production');

if (!process.env.SESSION_SECRET) {
  console.warn('warning: SESSION_SECRET not set. Using an ephemeral key; existing sessions break on restart.');
}
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
};

// Load system prompt from demo config if available, else fall back to built-in default.
const SYSTEM_PROMPT = (demoConfig && demoConfig.systemPrompt)
  ? demoConfig.systemPrompt
  : `You are tend, an AI business partner embedded in the Quiet Golf workspace. Quiet Golf is a direct-to-consumer premium golf apparel brand.

Connected data systems: Shopify (orders, customers, products), Stripe (payments, payouts, disputes), QuickBooks (accounting, bank feeds, P&L), ShipStation (fulfillment, shipments, tracking), Stocky (inventory levels, purchase orders), Inventory Planner (demand forecasting, reorder recommendations), Loop Returns (returns and exchanges).

Current workspace snapshot:
- Shopify: 1,240 orders MTD, $128.4K revenue, AOV $103.5, repeat rate 38%, cart-to-checkout 14.8%. Overnight: 47 orders, $4,820.
- Stripe: next payout $18,420 on Wednesday. 0.18% dispute rate. One declined-card retry succeeded.
- QuickBooks: May MTD $184K sales, $72K expenses. Bank feeds reconciled through May 27. May close is 3 days ahead of last month's pace.
- ShipStation: 1,840 shipments in May. Median order-to-label 6.4 hours. 2 delays: Toronto Cart Bag (USPS, 4 days) and Chicago Heritage Hat (label never scanned).
- Stocky: 72 active SKUs. 3 at critical low stock: Players Glove M (8 units, ~1 day cover), Heritage Hat Olive (12 units, 6 days cover), Performance Polo Sage XL (6 units, 1.5 days cover). 4 POs pending approval, $10,528 total.
- Inventory Planner: ~3,400 orders forecast next 30 days (+20% vs prior period).
- Loop Returns: 38 returns MTD, 3.1% return rate, 58% chose exchange. Top reason: color expectation mismatch on Performance Polo Stone.
- Top sellers 7d: Performance Polo Sage (84 units, $7,560), Heritage Hat Navy (62 units, $2,170), Tour Towel (51 units, $1,275), Players Glove M (47 units, $1,175).
- Team today: Sam closed Q2 returns planning doc and approved Olive Hat reorder. Jordan resolved two ShipStation tracking issues. Alex reconciled books through May 27 and flagged 4 international tax-code orders.

Respond as a knowledgeable business operator. Be concise and specific. Use numbers from the snapshot above when relevant. Do not use em dashes. Format with clear structure when it helps. You are not a general assistant — stay focused on operations, revenue, inventory, fulfillment, and finance for Quiet Golf.`;

// ─── Database ─────────────────────────────────────────────────────────────

const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
}) : null;

async function migrate() {
  if (!pool) {
    console.warn('warning: DATABASE_URL not set. Auth and conversation persistence disabled.');
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'New chat',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS conversations_user_updated
      ON conversations (user_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS messages_conv_created
      ON messages (conversation_id, created_at);
  `);
  console.log('db: migrations complete');
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  });
  return out;
}

function signToken(userId, demo = false) {
  const payload = demo ? { sub: userId, demo: true } : { sub: userId };
  return jwt.sign(payload, SESSION_SECRET, { expiresIn: '30d' });
}

function setSessionCookie(res, token) {
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${COOKIE_MAX_AGE}`];
  if (IS_PRODUCTION) flags.push('Secure');
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; ${flags.join('; ')}`);
}

function clearSessionCookie(res) {
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (IS_PRODUCTION) flags.push('Secure');
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; ${flags.join('; ')}`);
}

async function userFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  let claims;
  try { claims = jwt.verify(token, SESSION_SECRET); } catch { return null; }
  if (claims.demo || !pool) {
    return { id: 0, email: claims.sub, demo: true };
  }
  const { rows } = await pool.query(
    'SELECT id, email, created_at FROM users WHERE id = $1',
    [claims.sub]
  );
  return rows[0] || null;
}

// ─── Auth endpoints ───────────────────────────────────────────────────────

async function handleSignup(req, res) {
  const { email, password } = await readJson(req);
  if (!email || !password) return send(res, 400, { error: 'email and password are required' });
  if (typeof password !== 'string' || password.length < 6) {
    return send(res, 400, { error: 'password must be at least 6 characters' });
  }
  const normalized = String(email).trim().toLowerCase();
  if (!pool) {
    setSessionCookie(res, signToken(normalized, true));
    return send(res, 200, { user: { id: 0, email: normalized } });
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
      [normalized, hash]
    );
    setSessionCookie(res, signToken(rows[0].id));
    send(res, 200, { user: rows[0] });
  } catch (e) {
    if (e.code === '23505') return send(res, 409, { error: 'that email is already registered' });
    throw e;
  }
}

async function handleLogin(req, res) {
  const { email, password } = await readJson(req);
  if (!email || !password) return send(res, 400, { error: 'email and password are required' });
  const normalized = String(email).trim().toLowerCase();
  if (!pool) {
    setSessionCookie(res, signToken(normalized, true));
    return send(res, 200, { user: { id: 0, email: normalized } });
  }
  const { rows } = await pool.query(
    'SELECT id, email, password_hash, created_at FROM users WHERE email = $1',
    [normalized]
  );
  if (!rows[0]) return send(res, 401, { error: 'invalid credentials' });
  const ok = await bcrypt.compare(password, rows[0].password_hash);
  if (!ok) return send(res, 401, { error: 'invalid credentials' });
  setSessionCookie(res, signToken(rows[0].id));
  send(res, 200, { user: { id: rows[0].id, email: rows[0].email, created_at: rows[0].created_at } });
}

function handleLogout(res) {
  clearSessionCookie(res);
  res.writeHead(204);
  res.end();
}

async function handleMe(req, res) {
  const user = await userFromRequest(req);
  if (!user) return send(res, 401, { error: 'not signed in' });
  send(res, 200, { user });
}

// ─── Conversations ────────────────────────────────────────────────────────

async function listConversations(user, res) {
  if (!pool) return send(res, 200, { conversations: [] });
  const { rows } = await pool.query(
    'SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50',
    [user.id]
  );
  send(res, 200, { conversations: rows });
}

async function createConversation(user, res) {
  if (!pool) {
    const now = new Date().toISOString();
    return send(res, 200, { conversation: { id: 0, title: 'New chat', created_at: now, updated_at: now } });
  }
  const { rows } = await pool.query(
    'INSERT INTO conversations (user_id) VALUES ($1) RETURNING id, title, created_at, updated_at',
    [user.id]
  );
  send(res, 200, { conversation: rows[0] });
}

async function getConversation(user, convId, res) {
  if (!pool) {
    const now = new Date().toISOString();
    return send(res, 200, { conversation: { id: convId, title: 'New chat', created_at: now, updated_at: now, messages: [] } });
  }
  const { rows: convRows } = await pool.query(
    'SELECT id, title, created_at, updated_at FROM conversations WHERE id = $1 AND user_id = $2',
    [convId, user.id]
  );
  if (!convRows[0]) return send(res, 404, { error: 'conversation not found' });
  const { rows: msgRows } = await pool.query(
    'SELECT role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at',
    [convId]
  );
  send(res, 200, { conversation: { ...convRows[0], messages: msgRows } });
}

async function deleteConversation(user, convId, res) {
  if (!pool) { res.writeHead(204); res.end(); return; }
  const { rowCount } = await pool.query(
    'DELETE FROM conversations WHERE id = $1 AND user_id = $2',
    [convId, user.id]
  );
  if (!rowCount) return send(res, 404, { error: 'conversation not found' });
  res.writeHead(204);
  res.end();
}

// ─── Chat ─────────────────────────────────────────────────────────────────

async function handleChat(req, res, convId) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return send(res, 503, { error: 'ANTHROPIC_API_KEY not set' });

  const user = await userFromRequest(req);
  if (!user) return send(res, 401, { error: 'not signed in' });

  let message, clientHistory;
  try { ({ message, history: clientHistory } = await readJson(req)); } catch { return send(res, 400, { error: 'invalid body' }); }
  if (!message) return send(res, 400, { error: 'message is required' });

  let messages;
  if (!pool) {
    // Demo mode: use history sent by client, no DB persistence
    const prior = Array.isArray(clientHistory) ? clientHistory.slice(-20) : [];
    messages = [...prior, { role: 'user', content: message }];
  } else {
    const { rows: convRows } = await pool.query(
      'SELECT id, title FROM conversations WHERE id = $1 AND user_id = $2',
      [convId, user.id]
    );
    if (!convRows[0]) return send(res, 404, { error: 'conversation not found' });
    const isFirstMessage = convRows[0].title === 'New chat';

    await pool.query(
      'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
      [convId, 'user', message]
    );
    if (isFirstMessage) {
      const title = String(message).slice(0, 60).trim() || 'New chat';
      await pool.query('UPDATE conversations SET title = $1 WHERE id = $2', [title, convId]);
    }

    const { rows: history } = await pool.query(
      `SELECT role, content FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [convId]
    );
    messages = history.reverse().map((m) => ({ role: m.role, content: m.content }));
  }

  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        stream: true,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });
  } catch (e) {
    return send(res, 502, { error: 'upstream fetch failed: ' + e.message });
  }
  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '');
    return send(res, 502, { error: errText || `upstream ${upstream.status}` });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const decoder = new TextDecoder();
  let buf = '';
  let assistantText = '';
  try {
    for await (const chunk of upstream.body) {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const obj = JSON.parse(payload);
          if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') {
            assistantText += obj.delta.text;
            res.write(`data: ${JSON.stringify({ delta: obj.delta.text })}\n\n`);
          }
        } catch {}
      }
    }
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
  }

  if (assistantText && pool) {
    await pool.query(
      'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
      [convId, 'assistant', assistantText]
    );
    await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [convId]);
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

// ─── Router ───────────────────────────────────────────────────────────────

async function handleApi(req, res) {
  const url = req.url.split('?')[0];

  if (url === '/api/auth/signup' && req.method === 'POST') return handleSignup(req, res);
  if (url === '/api/auth/login'  && req.method === 'POST') return handleLogin(req, res);
  if (url === '/api/auth/logout' && req.method === 'POST') return handleLogout(res);
  if (url === '/api/auth/me'     && req.method === 'GET')  return handleMe(req, res);

  // Returns client config + system prompt (for the context panel in app.html)
  if (url === '/api/config' && req.method === 'GET') {
    const user = await userFromRequest(req);
    if (!user) return send(res, 401, { error: 'not signed in' });
    return send(res, 200, {
      client: demoConfig?.client || { name: 'Quiet Golf', slug: 'quiet-golf' },
      connectors: demoConfig?.connectors || [],
      kpis: demoConfig?.kpis || [],
      systemPrompt: SYSTEM_PROMPT,
    });
  }

  if (url === '/api/conversations') {
    const user = await userFromRequest(req);
    if (!user) return send(res, 401, { error: 'not signed in' });
    if (req.method === 'GET') return listConversations(user, res);
    if (req.method === 'POST') return createConversation(user, res);
    return send(res, 405, { error: 'method not allowed' });
  }

  const convMatch = url.match(/^\/api\/conversations\/(\d+)$/);
  if (convMatch) {
    const user = await userFromRequest(req);
    if (!user) return send(res, 401, { error: 'not signed in' });
    const convId = Number(convMatch[1]);
    if (req.method === 'GET') return getConversation(user, convId, res);
    if (req.method === 'DELETE') return deleteConversation(user, convId, res);
    return send(res, 405, { error: 'method not allowed' });
  }

  const chatMatch = url.match(/^\/api\/chat\/(\d+)$/);
  if (chatMatch) {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    return handleChat(req, res, Number(chatMatch[1]));
  }

  send(res, 404, { error: 'not found' });
}

// ─── Static file serving ──────────────────────────────────────────────────

function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const safe = path.normalize(decoded).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(ROOT, safe);
  if (!filePath.startsWith(ROOT)) return null;
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    if (!path.extname(filePath)) {
      const withHtml = filePath + '.html';
      if (fs.existsSync(withHtml)) filePath = withHtml;
    }
  }
  return filePath;
}

function serveStatic(req, res) {
  const filePath = resolveFile(req.url || '/');
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';
  const cacheControl = ext === '.html' || ext === '.css' || ext === '.js'
    ? 'no-cache'
    : 'public, max-age=3600';

  if (req.headers.range && (ext === '.mp4' || ext === '.mov' || ext === '.webm')) {
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (start >= stat.size || end >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      'Content-Type': contentType,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
  });
  fs.createReadStream(filePath).pipe(res);
}

// ─── Boot ─────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    if (req.url && req.url.startsWith('/api/')) return await handleApi(req, res);
    return serveStatic(req, res);
  } catch (e) {
    console.error('unhandled error:', e);
    if (!res.headersSent) send(res, 500, { error: 'internal error' });
    else { try { res.end(); } catch {} }
  }
});

migrate()
  .catch((e) => { console.error('migration failed:', e); })
  .finally(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`tend on port ${PORT} (${IS_PRODUCTION ? 'production' : 'dev'})`);
    });
  });
