const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, 'project');

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

const SYSTEM_PROMPT = `You are tend, an AI business partner embedded in the Quiet Golf workspace. Quiet Golf is a direct-to-consumer premium golf apparel brand.

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

const server = http.createServer(async (req, res) => {
  // Chat API endpoint: POST /api/chat/:user
  if (req.url && req.url.startsWith('/api/chat/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let message, history;
      try {
        const parsed = JSON.parse(body);
        message = parsed.message;
        history = parsed.history || [];
      } catch (_) {
        res.writeHead(400); res.end(); return;
      }
      if (!message) { res.writeHead(400); res.end(); return; }

      const messages = [
        ...history.slice(-10),
        { role: 'user', content: message }
      ];

      try {
        const upstream = await fetch('https://api.anthropic.com/v1/messages', {
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
          })
        });

        if (!upstream.ok) {
          const err = await upstream.text();
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err }));
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        const decoder = new TextDecoder();
        let buf = '';
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
                res.write(`data: ${JSON.stringify({ delta: obj.delta.text })}\n\n`);
              }
            } catch (_) {}
          }
        }
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (e) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        } else {
          res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
          res.end();
        }
      }
    });
    return;
  }

  // Static file serving
  const filePath = resolveFile(req.url || '/');
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';
  const cacheControl = ext === '.html' || ext === '.css' || ext === '.js' ? 'no-cache' : 'public, max-age=3600';

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
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`tend site serving ${ROOT} on port ${PORT}`);
});
