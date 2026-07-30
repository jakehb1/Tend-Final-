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
const SITE_ORIGIN = 'https://www.withtend.ai';
const BOOKING_MEETING_URL = 'https://cal.com/team/withtend/demo';
const BOOKING_DEFAULT_GUESTS = [];
const COOKIE_NAME = 'tend.session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
const IS_PRODUCTION = !!(process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production');

const SEO_DEFAULT_IMAGE = `${SITE_ORIGIN}/images/landing/dashboard-mockup.webp`;
const SEO_ORGANIZATION_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Tend',
  url: SITE_ORIGIN,
  logo: `${SITE_ORIGIN}/images/tend-logo.png`,
  description: 'Tend builds AI business partners that connect to company tools, surface what matters, and run operational work with approval gates and audit trails.',
};

const SEO_SOFTWARE_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Tend',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  url: SITE_ORIGIN,
  description: 'An AI operating layer for teams that connects to business tools, understands company context, and runs repetitive operational workflows.',
};

const SEO_PRODUCT_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Tend',
  brand: {
    '@type': 'Brand',
    name: 'Tend',
  },
  category: 'AI business operations software',
  url: SITE_ORIGIN,
  description: 'Tend is an AI business partner for teams that need to automate repetitive operational workflows across existing tools.',
};

const SEO_FAQ_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What can Tend actually do for my business?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Tend runs repetitive work that crosses business tools, such as renewal follow-ups, lead follow-ups, ticket routing, invoice and contract reconciliation, and churn-risk surfacing.',
      },
    },
    {
      '@type': 'Question',
      name: 'Do we have to rip out our existing tools?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'No. Tend connects to the tools a team already uses, including CRM, billing, helpdesk, and documentation systems.',
      },
    },
    {
      '@type': 'Question',
      name: 'How long until we see value?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Most teams start with a narrow workflow, put the first agent live in two to three weeks, and measure ROI during the first month.',
      },
    },
    {
      '@type': 'Question',
      name: 'What about security and compliance?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Tend uses encryption in transit and at rest, role-based access, audit logs, scoped permissions, approval gates, and tenant-level data boundaries.',
      },
    },
    {
      '@type': 'Question',
      name: 'Where does the AI actually run?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Tend agents run inside guardrails defined by the customer team, with scoped permissions, reversible actions, dry runs, and logged reasoning.',
      },
    },
  ],
};

const SEO_PAGES = {
  '/': {
    title: 'Tend | AI Business Partner for Ops, Revenue, and Support Teams',
    description: 'Tend connects to your business tools, surfaces what matters, and runs operational workflows like follow-ups, renewals, routing, reconciliation, and approvals.',
    priority: '1.0',
    changefreq: 'weekly',
    schemas: ['organization', 'website', 'software', 'faq'],
  },
  '/platform': {
    title: 'Tend Platform | Data Layer and AI Agents for Business Operations',
    description: 'See how Tend combines a business data layer, governed agent workflows, approvals, and audit trails so teams can automate operational work safely.',
    priority: '0.9',
    changefreq: 'weekly',
    schemas: ['organization', 'software'],
  },
  '/use-cases': {
    title: 'Tend Use Cases | AI Agents for Repetitive Business Work',
    description: 'Explore Tend use cases for revenue operations, customer support, renewals, dispatch, finance workflows, and business follow-ups across your existing tools.',
    priority: '0.8',
    changefreq: 'weekly',
    schemas: ['organization', 'software'],
  },
  '/about': {
    title: 'About Tend | Building the Data Layer and Agents for Modern Work',
    description: 'Learn how Tend is building a business data layer and AI agents that help companies understand context, coordinate work, and act with human oversight.',
    priority: '0.7',
    changefreq: 'monthly',
    schemas: ['organization'],
  },
  '/book': {
    title: 'Book a Tend Demo | Map AI Agents to Your Business Workflows',
    description: 'Book a Tend demo to map where AI agents can reduce repetitive work across your CRM, helpdesk, billing, docs, and operational systems.',
    priority: '0.9',
    changefreq: 'weekly',
    schemas: ['organization', 'software'],
  },
  '/book.html': {
    canonicalPath: '/book',
    title: 'Book a Tend Demo | Map AI Agents to Your Business Workflows',
    description: 'Book a Tend demo to map where AI agents can reduce repetitive work across your CRM, helpdesk, billing, docs, and operational systems.',
    noSitemap: true,
    schemas: ['organization', 'software'],
  },
  '/connect': {
    title: 'Connect Your Tools to Tend | CRM, Billing, Helpdesk, and Docs',
    description: 'Connect Tend to the business systems your team already uses so agents can understand context and run workflows across tools.',
    priority: '0.6',
    changefreq: 'monthly',
    schemas: ['organization', 'software'],
  },
  '/data-layer': {
    title: 'Tend Data Layer | Business Context for AI Agents',
    description: 'Tend creates a business data layer that gives AI agents structured context across customers, orders, tickets, invoices, documents, and workflows.',
    priority: '0.6',
    changefreq: 'monthly',
    schemas: ['organization', 'software'],
  },
  '/docs': {
    title: 'Tend Docs | Guides for the Tend Data Layer and Agent Platform',
    description: 'Read Tend documentation for agents, connectors, entities, workflows, governance, APIs, the CLI, and implementation patterns.',
    priority: '0.7',
    changefreq: 'weekly',
    schemas: ['organization', 'breadcrumb'],
  },
  '/docs/index': {
    canonicalPath: '/docs',
    title: 'Tend Docs | Guides for the Tend Data Layer and Agent Platform',
    description: 'Read Tend documentation for agents, connectors, entities, workflows, governance, APIs, the CLI, and implementation patterns.',
    noSitemap: true,
    schemas: ['organization', 'breadcrumb'],
  },
  '/docs/agents': {
    title: 'Tend Agents | Typed and Governed AI Workflows',
    description: 'Learn how Tend agents are typed, bounded, governed, and connected to business workflows with approvals and auditability.',
    priority: '0.55',
    changefreq: 'monthly',
    schemas: ['organization', 'breadcrumb'],
  },
  '/docs/api': {
    title: 'Tend API Reference | Build with the Tend Platform',
    description: 'Reference Tend API concepts for integrating agents, entities, workflows, connectors, policies, and operational data.',
    priority: '0.55',
    changefreq: 'monthly',
    schemas: ['organization', 'breadcrumb'],
  },
  '/docs/cli': {
    title: 'Tend CLI | Command Line Tools for Tend Workspaces',
    description: 'Use the Tend CLI to manage projects, render workspace assets, and support local development for Tend implementations.',
    priority: '0.5',
    changefreq: 'monthly',
    schemas: ['organization', 'breadcrumb'],
  },
  '/docs/connectors': {
    title: 'Tend Connectors | Ingest Business Data from Existing Tools',
    description: 'Understand how Tend connectors ingest and normalize data from business systems so agents can operate with context.',
    priority: '0.55',
    changefreq: 'monthly',
    schemas: ['organization', 'breadcrumb'],
  },
  '/docs/entities': {
    title: 'Tend Entities and Types | Structured Business Context',
    description: 'Learn how Tend models customers, orders, tickets, invoices, documents, and other operational entities for AI agents.',
    priority: '0.5',
    changefreq: 'monthly',
    schemas: ['organization', 'breadcrumb'],
  },
  '/docs/getting-started': {
    title: 'Getting Started with Tend | Configure Your First AI Agent Workflow',
    description: 'Start with Tend by connecting tools, mapping business context, defining policies, and launching the first governed agent workflow.',
    priority: '0.6',
    changefreq: 'monthly',
    schemas: ['organization', 'breadcrumb'],
  },
  '/docs/limits': {
    title: 'Tend Limits and SLAs | Platform Boundaries and Reliability',
    description: 'Review Tend platform limits, reliability expectations, operational boundaries, and service-level patterns for agent workflows.',
    priority: '0.45',
    changefreq: 'monthly',
    schemas: ['organization', 'breadcrumb'],
  },
  '/docs/mental-model': {
    title: 'Tend Mental Model | How the Data Layer and Agents Work Together',
    description: 'Understand the Tend mental model for business context, connectors, entities, governed agents, workflows, and human oversight.',
    priority: '0.55',
    changefreq: 'monthly',
    schemas: ['organization', 'breadcrumb'],
  },
  '/docs/ontology': {
    title: 'Tend Ontology | Shared Business Language for AI Agents',
    description: 'Learn how the Tend ontology gives agents a shared language for business entities, relationships, policies, and workflows.',
    priority: '0.5',
    changefreq: 'monthly',
    schemas: ['organization', 'breadcrumb'],
  },
  '/docs/policy': {
    title: 'Tend Policy and Governance | Approval Gates for AI Agents',
    description: 'See how Tend uses scoped permissions, policy controls, approval gates, audit trails, and governance for business AI agents.',
    priority: '0.55',
    changefreq: 'monthly',
    schemas: ['organization', 'breadcrumb'],
  },
  '/docs/resolution': {
    title: 'Tend Entity Resolution | Match Business Records Across Tools',
    description: 'Learn how Tend resolves entities across CRM, billing, support, documents, and other systems to give agents reliable context.',
    priority: '0.5',
    changefreq: 'monthly',
    schemas: ['organization', 'breadcrumb'],
  },
  '/docs/sdk': {
    title: 'Tend SDK Reference | Build Tend Agents and Integrations',
    description: 'Use the Tend SDK reference to build integrations, define entities, configure agents, and connect workflows to business systems.',
    priority: '0.5',
    changefreq: 'monthly',
    schemas: ['organization', 'breadcrumb'],
  },
  '/docs/workflows': {
    title: 'Tend Workflows | Sagas, Retries, and Governed Agent Actions',
    description: 'Understand Tend workflows for multi-step business processes, retries, approvals, reversibility, and agent execution.',
    priority: '0.55',
    changefreq: 'monthly',
    schemas: ['organization', 'breadcrumb'],
  },
  '/docs/changelog': {
    title: 'Tend Changelog | Platform Updates and Product Notes',
    description: 'Track Tend platform updates, documentation changes, product notes, and improvements to agents, workflows, and connectors.',
    priority: '0.35',
    changefreq: 'monthly',
    schemas: ['organization', 'breadcrumb'],
  },
  '/app': {
    title: 'Tend Workspace | AI Business Partner Demo',
    description: 'Tend workspace demo for AI-assisted business operations, conversations, and workflow execution.',
    robots: 'noindex,nofollow',
    noSitemap: true,
    schemas: ['organization', 'software'],
  },
  '/dashboard': {
    title: 'Tend Dashboard | AI Business Operations Demo',
    description: 'Tend dashboard demo showing operational signals, priorities, and business workflow context.',
    robots: 'noindex,nofollow',
    noSitemap: true,
    schemas: ['organization', 'software'],
  },
  '/login': {
    title: 'Sign in to Tend',
    description: 'Sign in to the Tend workspace.',
    robots: 'noindex,nofollow',
    noSitemap: true,
    schemas: ['organization'],
  },
  '/onboarding': {
    title: 'Tend Onboarding',
    description: 'Onboarding flow for Tend workspaces.',
    robots: 'noindex,nofollow',
    noSitemap: true,
    schemas: ['organization'],
  },
  '/org': {
    title: 'Tend Organization Demo',
    description: 'Vertical organization demo for Tend AI business partners.',
    robots: 'noindex,nofollow',
    noSitemap: true,
    schemas: ['organization', 'software'],
  },
  '/org-light': {
    title: 'Tend Organization Demo',
    description: 'Light organization demo for Tend AI business partners.',
    robots: 'noindex,nofollow',
    noSitemap: true,
    schemas: ['organization', 'software'],
  },
};

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

const TRACKING_HEAD_TAGS = `
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-FM18D1E3YB"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-FM18D1E3YB');
</script>
<!-- Meta Pixel Code -->
<script>
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', '1577161653585270');
  fbq('track', 'PageView');
</script>`;

const TRACKING_BODY_TAGS = `
<!-- Meta Pixel Code -->
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=1577161653585270&ev=PageView&noscript=1" /></noscript>`;

function injectTrackingTags(html) {
  if (html.includes('G-FM18D1E3YB') || html.includes('1577161653585270')) return html;

  let next = html;
  if (next.includes('</head>')) {
    next = next.replace('</head>', `${TRACKING_HEAD_TAGS}\n</head>`);
  } else {
    next = `${TRACKING_HEAD_TAGS}\n${next}`;
  }

  if (/<body\b[^>]*>/i.test(next)) {
    next = next.replace(/(<body\b[^>]*>)/i, `$1\n${TRACKING_BODY_TAGS}`);
  }
  return next;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeSeoPath(requestPath) {
  let routePath = decodeURIComponent((requestPath || '/').split('?')[0].split('#')[0]);
  if (routePath !== '/' && routePath.endsWith('/')) routePath = routePath.slice(0, -1);
  if (routePath.endsWith('.html')) routePath = routePath.slice(0, -5);
  if (routePath === '/index') routePath = '/';
  if (routePath === '/docs/index') routePath = '/docs';
  return routePath || '/';
}

function getSeoConfig(requestPath) {
  const routePath = normalizeSeoPath(requestPath);
  return SEO_PAGES[routePath] || SEO_PAGES[`${routePath}.html`] || null;
}

function schemaForPage(config, routePath) {
  const schemaKeys = config.schemas || [];
  const schemas = [];
  if (schemaKeys.includes('organization')) schemas.push(SEO_ORGANIZATION_SCHEMA);
  if (schemaKeys.includes('website')) {
    schemas.push({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Tend',
      url: SITE_ORIGIN,
    });
  }
  if (schemaKeys.includes('software')) schemas.push(SEO_SOFTWARE_SCHEMA, SEO_PRODUCT_SCHEMA);
  if (schemaKeys.includes('faq')) schemas.push(SEO_FAQ_SCHEMA);
  if (schemaKeys.includes('breadcrumb')) {
    const parts = routePath.split('/').filter(Boolean);
    schemas.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: SITE_ORIGIN,
        },
        ...parts.map((part, index) => ({
          '@type': 'ListItem',
          position: index + 2,
          name: part
            .split('-')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' '),
          item: `${SITE_ORIGIN}/${parts.slice(0, index + 1).join('/')}`,
        })),
      ],
    });
  }
  return schemas;
}

function seoHeadTags(config, routePath) {
  const canonicalPath = config.canonicalPath || routePath;
  const canonicalUrl = `${SITE_ORIGIN}${canonicalPath === '/' ? '/' : canonicalPath}`;
  const title = escapeHtml(config.title);
  const description = escapeHtml(config.description);
  const image = escapeHtml(config.image || SEO_DEFAULT_IMAGE);
  const robots = config.robots || 'index,follow';
  const schemas = schemaForPage(config, canonicalPath);

  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta name="robots" content="${escapeHtml(robots)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Tend" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    ...schemas.map((schema) => `<script type="application/ld+json">${JSON.stringify(schema)}</script>`),
  ].join('\n');
}

function injectSeoTags(html, requestPath) {
  const routePath = normalizeSeoPath(requestPath);
  const config = getSeoConfig(requestPath);
  if (!config || !html.includes('</head>')) return html;

  const tags = seoHeadTags(config, routePath);
  return html
    .replace(/<title[^>]*>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+[^>]*(?:name|property)=["'](?:description|robots|og:type|og:site_name|og:title|og:description|og:url|og:image|twitter:card|twitter:title|twitter:description|twitter:image)["'][^>]*>\s*/gi, '')
    .replace(/<link\s+[^>]*rel=["']canonical["'][^>]*>\s*/gi, '')
    .replace(/<script\s+type=["']application\/ld\+json["'][\s\S]*?<\/script>\s*/gi, '')
    .replace('</head>', `${tags}\n</head>`);
}

function serveText(res, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

function serveRobots(res) {
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /app',
    'Disallow: /dashboard',
    'Disallow: /login',
    'Disallow: /onboarding',
    'Disallow: /org',
    'Disallow: /org-light',
    '',
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    '',
  ].join('\n');
  serveText(res, body);
}

function serveSitemap(res) {
  const now = new Date().toISOString().slice(0, 10);
  const urls = Object.entries(SEO_PAGES)
    .filter(([, config]) => !config.noSitemap && !config.robots)
    .map(([routePath, config]) => {
      const loc = `${SITE_ORIGIN}${routePath === '/' ? '/' : routePath}`;
      return [
        '  <url>',
        `    <loc>${escapeHtml(loc)}</loc>`,
        `    <lastmod>${now}</lastmod>`,
        `    <changefreq>${config.changefreq || 'monthly'}</changefreq>`,
        `    <priority>${config.priority || '0.5'}</priority>`,
        '  </url>',
      ].join('\n');
    })
    .join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  serveText(res, body, 'application/xml; charset=utf-8');
}

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

const HUBSPOT_SERVICE_KEY = process.env.HUBSPOT_SERVICE_KEY || process.env.HUBSPOT_PRIVATE_APP_TOKEN || process.env.HUBSPOT_ACCESS_TOKEN;
const HUBSPOT_FREE_TRIAL_EVENT_NAME = process.env.HUBSPOT_FREE_TRIAL_EVENT_NAME || 'free_trial_signup';
const HUBSPOT_DEMO_BOOKED_EVENT_NAME = process.env.HUBSPOT_DEMO_BOOKED_EVENT_NAME || '';
const CAL_WEBHOOK_SECRET = process.env.CAL_WEBHOOK_SECRET || process.env.CALCOM_WEBHOOK_SECRET || '';

async function hubSpotRequest(method, endpoint, body) {
  if (!HUBSPOT_SERVICE_KEY) return null;
  const response = await fetch(`https://api.hubapi.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${HUBSPOT_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }
  return { ok: response.ok, status: response.status, data };
}

async function syncHubSpotContact(email, details = {}, lifecycleStage = 'customer') {
  if (!HUBSPOT_SERVICE_KEY) {
    console.warn('hubspot: HUBSPOT_SERVICE_KEY not set; skipping contact sync.');
    return;
  }

  const properties = {
    email,
    lifecyclestage: lifecycleStage,
  };
  if (details.firstName) properties.firstname = String(details.firstName).trim();
  if (details.lastName) properties.lastname = String(details.lastName).trim();
  if (details.company) properties.company = String(details.company).trim();
  if (details.website) properties.website = String(details.website).trim();

  try {
    const create = await hubSpotRequest('POST', '/crm/v3/objects/contacts', { properties });
    if (create?.ok) return create.data?.id || null;

    if (create?.status !== 409) {
      console.warn('hubspot: contact create failed', create?.status, create?.data?.message || create?.data?.raw || 'unknown error');
      return null;
    }

    const search = await hubSpotRequest('POST', '/crm/v3/objects/contacts/search', {
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
      properties: ['email'],
      limit: 1,
    });
    const existingId = search?.data?.results?.[0]?.id;
    if (!existingId) {
      console.warn('hubspot: duplicate contact found but lookup returned no id');
      return null;
    }

    const update = await hubSpotRequest('PATCH', `/crm/v3/objects/contacts/${existingId}`, { properties });
    if (!update?.ok) {
      console.warn('hubspot: contact update failed', update?.status, update?.data?.message || update?.data?.raw || 'unknown error');
      return null;
    }
    return existingId;
  } catch (e) {
    console.warn('hubspot: contact sync failed', e.message);
    return null;
  }
}

async function createHubSpotNote(contactId, body) {
  if (!HUBSPOT_SERVICE_KEY || !contactId || !body) return;

  try {
    const note = await hubSpotRequest('POST', '/crm/v3/objects/notes', {
      properties: {
        hs_timestamp: new Date().toISOString(),
        hs_note_body: body,
      },
      associations: [{
        to: { id: contactId },
        types: [{
          associationCategory: 'HUBSPOT_DEFINED',
          associationTypeId: 202,
        }],
      }],
    });
    if (!note?.ok) {
      console.warn('hubspot: note sync failed', note?.status, note?.data?.message || note?.data?.raw || 'unknown error');
    }
  } catch (e) {
    console.warn('hubspot: note sync failed', e.message);
  }
}

async function sendHubSpotEvent(eventName, email, properties = {}) {
  if (!HUBSPOT_SERVICE_KEY) {
    console.warn('hubspot: HUBSPOT_SERVICE_KEY not set; skipping event sync.');
    return;
  }
  if (!eventName) {
    console.warn('hubspot: event name not set; skipping event sync.');
    return;
  }

  try {
    const event = await hubSpotRequest('POST', '/events/v3/send', {
      eventName,
      email,
      properties,
    });
    if (!event?.ok) {
      console.warn('hubspot: event sync failed', eventName, event?.status, event?.data?.message || event?.data?.raw || 'unknown error');
      return;
    }
    console.log('hubspot: event synced', eventName, email);
  } catch (e) {
    console.warn('hubspot: event sync failed', e.message);
  }
}

function verifyCalWebhook(req) {
  if (!CAL_WEBHOOK_SECRET) return true;

  const url = new URL(req.url, 'http://localhost');
  const provided = req.headers['x-cal-secret']
    || req.headers['x-webhook-secret']
    || req.headers['cal-webhook-secret']
    || url.searchParams.get('secret');
  return provided === CAL_WEBHOOK_SECRET;
}

function extractCalBooking(payload) {
  const event = payload?.payload || payload || {};
  const attendee = Array.isArray(event.attendees) ? event.attendees[0] : null;
  const responses = event.responses || event.bookingFieldsResponses || {};
  const email = String(attendee?.email || event.email || responses.email?.value || responses.email || '').trim().toLowerCase();
  const fullName = String(attendee?.name || event.name || responses.name?.value || responses.name || '').trim();
  const [firstName, ...lastParts] = fullName.split(/\s+/).filter(Boolean);
  const company = responses.company?.value || responses.company || responses.companyName?.value || responses.companyName || '';
  const website = responses.website?.value || responses.website || responses.companyWebsite?.value || responses.companyWebsite || '';

  return {
    email,
    firstName,
    lastName: lastParts.join(' '),
    company,
    website,
    title: event.title || event.eventType?.title || 'Demo call',
    startTime: event.startTime || event.start || event.start_time || '',
    endTime: event.endTime || event.end || event.end_time || '',
    bookingId: event.uid || event.id || event.bookingId || '',
  };
}

async function handleCalBookingWebhook(req, res) {
  if (!verifyCalWebhook(req)) return send(res, 401, { error: 'invalid webhook secret' });

  const body = await readJson(req);
  const trigger = String(body.triggerEvent || body.event || body.type || '').toLowerCase();
  if (trigger && !trigger.includes('booking') && !trigger.includes('created')) {
    return send(res, 200, { ok: true, ignored: true });
  }

  const booking = extractCalBooking(body);
  if (!/^\S+@\S+\.\S+$/.test(booking.email)) {
    console.warn('cal: booking webhook missing valid attendee email');
    return send(res, 400, { error: 'valid attendee email is required' });
  }

  const contactId = await syncHubSpotContact(booking.email, booking, 'lead');
  if (HUBSPOT_DEMO_BOOKED_EVENT_NAME) {
    await sendHubSpotEvent(HUBSPOT_DEMO_BOOKED_EVENT_NAME, booking.email, {
      title: booking.title,
      start_time: booking.startTime,
      end_time: booking.endTime,
      booking_id: booking.bookingId,
    });
  }
  await createHubSpotNote(contactId, [
    'Demo booked via Cal.com',
    booking.title ? 'Call: ' + booking.title : '',
    booking.startTime ? 'Start: ' + booking.startTime : '',
    booking.endTime ? 'End: ' + booking.endTime : '',
    booking.bookingId ? 'Booking ID: ' + booking.bookingId : '',
  ].filter(Boolean).join('<br>'));

  console.log('hubspot: cal booking synced', booking.email, booking.startTime || 'no start time');
  send(res, 200, { ok: true });
}

async function handleBookCallLead(req, res) {
  const { firstName, lastName, email, companyName, companyWebsite, aiGoal } = await readJson(req);
  const normalized = String(email || '').trim().toLowerCase();
  const required = [firstName, normalized, companyName, aiGoal].every((value) => String(value || '').trim());
  if (!required) return send(res, 400, { error: 'first name, work email, company name, and AI improvement goal are required' });
  if (!/^\S+@\S+\.\S+$/.test(normalized)) return send(res, 400, { error: 'valid work email is required' });

  await syncHubSpotContact(normalized, {
    firstName,
    lastName,
    company: companyName,
    website: companyWebsite,
  }, 'lead');

  console.log('hubspot: pre-call lead synced', normalized, String(companyName || '').trim(), String(aiGoal || '').trim().slice(0, 160));
  send(res, 200, { ok: true });
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
  const { email, password, firstName, lastName } = await readJson(req);
  if (!email || !password) return send(res, 400, { error: 'email and password are required' });
  if (typeof password !== 'string' || password.length < 6) {
    return send(res, 400, { error: 'password must be at least 6 characters' });
  }
  const normalized = String(email).trim().toLowerCase();
  if (!pool) {
    await syncHubSpotContact(normalized, { firstName, lastName });
    await sendHubSpotEvent(HUBSPOT_FREE_TRIAL_EVENT_NAME, normalized);
    setSessionCookie(res, signToken(normalized, true));
    return send(res, 200, { user: { id: 0, email: normalized } });
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
      [normalized, hash]
    );
    await syncHubSpotContact(normalized, { firstName, lastName });
    await sendHubSpotEvent(HUBSPOT_FREE_TRIAL_EVENT_NAME, normalized);
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
  if (url === '/api/book-call-lead' && req.method === 'POST') return handleBookCallLead(req, res);
  if ((url === '/api/cal-booking-webhook' || url === '/api/webhooks/cal') && req.method === 'POST') return handleCalBookingWebhook(req, res);

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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function bookingPageHtml() {
  const meetingUrl = BOOKING_MEETING_URL;
  const defaultGuests = JSON.stringify(BOOKING_DEFAULT_GUESTS);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Book a call | Tend</title>
<style>
  :root { color-scheme: dark; --bg:#0f0f10; --panel:#171719; --text:#f4f1ea; --muted:#a8a29a; --line:#2b2927; --accent:#e7d8bd; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:var(--bg); color:var(--text); }
  main { min-height:100vh; display:grid; place-items:center; padding:40px 18px; }
  .wrap { width:min(920px, 100%); display:grid; grid-template-columns:0.9fr 1.1fr; gap:28px; align-items:start; }
  .intro { padding:22px 0; }
  a.logo { color:var(--text); text-decoration:none; font-weight:700; letter-spacing:0; font-size:22px; }
  h1 { margin:60px 0 18px; font-size:clamp(34px, 5vw, 58px); line-height:0.98; letter-spacing:0; }
  p { color:var(--muted); line-height:1.6; font-size:16px; margin:0; }
  .form-card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:22px; box-shadow:0 20px 60px rgba(0,0,0,.28); }
  form { display:grid; gap:14px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  label { display:grid; gap:7px; color:var(--muted); font-size:13px; }
  input, textarea { width:100%; border:1px solid #35322e; border-radius:6px; background:#101011; color:var(--text); padding:12px 12px; font:inherit; outline:none; }
  textarea { min-height:118px; resize:vertical; }
  input:focus, textarea:focus { border-color:var(--accent); }
  button { border:0; border-radius:6px; background:var(--accent); color:#14110c; padding:13px 16px; font-weight:700; font:inherit; cursor:pointer; }
  button[disabled] { opacity:.65; cursor:wait; }
  .status { min-height:20px; color:var(--muted); font-size:13px; }
  .wrap.hidden { display:none; }
  .scheduler { display:none; width:min(1080px, 100%); }
  .scheduler.active { display:block; }
  .scheduler h2 { margin:26px 0 18px; font-size:clamp(26px, 4vw, 40px); line-height:1.05; letter-spacing:0; }
  #cal-inline { width:100%; min-height:640px; background:var(--panel); border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  @media (max-width: 760px) { .wrap { grid-template-columns:1fr; } h1 { margin-top:34px; } .grid { grid-template-columns:1fr; } #cal-inline { min-height:540px; } }
</style>
</head>
<body>
<main>
  <div class="wrap">
    <section class="intro">
      <a class="logo" href="/">tend</a>
      <h1>Tell us what you want AI to fix.</h1>
      <p>Share a little context first. Then we will send you straight to the meeting scheduler so the call starts with the useful stuff already clear.</p>
    </section>
    <section class="form-card">
      <form id="bookForm">
        <div class="grid">
          <label>First name <input name="firstName" autocomplete="given-name" required /></label>
          <label>Last name <input name="lastName" autocomplete="family-name" /></label>
        </div>
        <label>Work email <input name="email" type="email" autocomplete="email" required /></label>
        <label>Company name <input name="companyName" autocomplete="organization" required /></label>
        <label>Company website <input name="companyWebsite" type="text" inputmode="url" autocomplete="url" placeholder="company.com" /></label>
        <label>What are you looking to improve with AI? <textarea name="aiGoal" required></textarea></label>
        <button type="submit">Continue to scheduler</button>
        <div class="status" id="status" aria-live="polite"></div>
      </form>
    </section>
  </div>
  <section class="scheduler" id="schedulerView">
    <a class="logo" href="/">tend</a>
    <h2>Pick a time that works for you.</h2>
    <div id="cal-inline"></div>
    <div class="status" id="schedulerStatus" aria-live="polite"></div>
  </section>
</main>
<script>
  (function (C, A, L) {
    let p = function (a, ar) { a.q.push(ar); };
    let d = C.document;
    C.Cal = C.Cal || function () {
      let cal = C.Cal;
      let ar = arguments;
      if (!cal.loaded) {
        cal.ns = {};
        cal.q = cal.q || [];
        d.head.appendChild(d.createElement('script')).src = A;
        cal.loaded = true;
      }
      if (ar[0] === L) {
        const api = function () { p(api, arguments); };
        const namespace = ar[1];
        api.q = api.q || [];
        if (typeof namespace === 'string') {
          cal.ns[namespace] = cal.ns[namespace] || api;
          p(cal.ns[namespace], ar);
          p(cal, ['initNamespace', namespace]);
        } else p(cal, ar);
        return;
      }
      p(cal, ar);
    };
  })(window, 'https://app.cal.com/embed/embed.js', 'init');

  const form = document.getElementById('bookForm');
  const status = document.getElementById('status');
  const websiteInput = form.elements.companyWebsite;
  const meetingUrl = '${meetingUrl}';
  const defaultGuests = ${defaultGuests};

  function normalizeWebsiteUrl(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    if (/[,\\s]/.test(trimmed)) return null;

    const candidate = /^[a-z][a-z0-9+.-]*:\\/\\//i.test(trimmed)
      ? trimmed
      : 'https://' + trimmed;

    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      return null;
    }

    const hostname = parsed.hostname;
    const labels = hostname.split('.');
    const hasValidHost = /^https?:$/.test(parsed.protocol)
      && labels.length > 1
      && !hostname.includes('..')
      && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));

    return hasValidHost ? parsed.href : null;
  }

  websiteInput.addEventListener('input', () => {
    if (status.textContent === 'Please enter a valid website URL.') status.textContent = '';
  });

  function getStoredAttribution() {
    try {
      return JSON.parse(window.sessionStorage.getItem('tend_attribution') || '{}') || {};
    } catch {
      return {};
    }
  }

  function setStoredAttribution(attribution) {
    try {
      window.sessionStorage.setItem('tend_attribution', JSON.stringify(attribution));
    } catch {}
  }

  function inferAttributionSource(urlParams, referrer) {
    const utmSource = String(urlParams.get('utm_source') || '').trim();
    const utmMedium = String(urlParams.get('utm_medium') || '').trim();
    if (utmSource || utmMedium) {
      return {
        source: utmSource || '(not set)',
        medium: utmMedium || '(not set)',
      };
    }

    if (urlParams.get('gclid') || urlParams.get('gbraid') || urlParams.get('wbraid')) {
      return { source: 'google', medium: 'cpc' };
    }
    if (urlParams.get('fbclid')) {
      return { source: 'facebook', medium: 'paid_social' };
    }
    if (urlParams.get('li_fat_id')) {
      return { source: 'linkedin', medium: 'paid_social' };
    }

    if (referrer) {
      try {
        const referrerUrl = new URL(referrer);
        const source = referrerUrl.hostname.replace(/^www\\./, '');
        const searchHosts = ['google.', 'bing.', 'yahoo.', 'duckduckgo.', 'ecosia.'];
        const socialHosts = ['linkedin.', 'facebook.', 'instagram.', 'x.com', 'twitter.', 't.co'];
        const medium = searchHosts.some((host) => source.includes(host))
          ? 'organic'
          : (socialHosts.some((host) => source.includes(host)) ? 'social' : 'referral');
        return { source, medium };
      } catch {}
    }

    return { source: '(direct)', medium: '(none)' };
  }

  function captureAttribution() {
    const params = new URLSearchParams(window.location.search);
    const existing = getStoredAttribution();
    const hasNewAttribution = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'gclid',
      'gbraid',
      'wbraid',
      'fbclid',
      'li_fat_id'
    ].some((key) => params.has(key));

    if (existing.session_source && !hasNewAttribution) return existing;

    const referrer = document.referrer || existing.referrer || '';
    const inferred = inferAttributionSource(params, referrer);
    const attribution = {
      utm_source: String(params.get('utm_source') || existing.utm_source || inferred.source || '').trim(),
      utm_medium: String(params.get('utm_medium') || existing.utm_medium || inferred.medium || '').trim(),
      utm_campaign: String(params.get('utm_campaign') || existing.utm_campaign || '').trim(),
      utm_content: String(params.get('utm_content') || existing.utm_content || '').trim(),
      utm_term: String(params.get('utm_term') || existing.utm_term || '').trim(),
      gclid: String(params.get('gclid') || existing.gclid || '').trim(),
      gbraid: String(params.get('gbraid') || existing.gbraid || '').trim(),
      wbraid: String(params.get('wbraid') || existing.wbraid || '').trim(),
      fbclid: String(params.get('fbclid') || existing.fbclid || '').trim(),
      li_fat_id: String(params.get('li_fat_id') || existing.li_fat_id || '').trim(),
      referrer,
      landing_page: existing.landing_page || window.location.href,
      session_source: inferred.source,
      session_medium: inferred.medium,
      session_source_medium: inferred.source + ' / ' + inferred.medium
    };

    setStoredAttribution(attribution);
    return attribution;
  }

  const bookingAttribution = captureAttribution();

  function trackBookingFormCompleted() {
    return new Promise((resolve) => {
      if (typeof window.gtag !== 'function') {
        resolve();
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      window.gtag('event', 'book_a_demo', {
        ...bookingAttribution,
        debug_mode: true,
        transport_type: 'beacon',
        event_callback: finish,
        event_timeout: 1500
      });
      setTimeout(finish, 1800);
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    const data = Object.fromEntries(new FormData(form).entries());
    const normalizedWebsite = normalizeWebsiteUrl(data.companyWebsite);
    if (normalizedWebsite === null) {
      status.textContent = 'Please enter a valid website URL.';
      websiteInput.focus();
      return;
    }
    data.companyWebsite = normalizedWebsite;
    websiteInput.value = normalizedWebsite;
    button.disabled = true;
    status.textContent = 'Saving your details...';
    try {
      const leadResponse = await fetch('/api/book-call-lead', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
      if (!leadResponse.ok) throw new Error('lead submission failed');
    } catch (error) {
      console.warn(error);
      status.textContent = 'Something went wrong. Please try again.';
      button.disabled = false;
      return;
    }
    status.textContent = 'Opening scheduler...';
    await trackBookingFormCompleted();
    const params = new URLSearchParams();
    params.set('firstname', data.firstName || '');
    params.set('lastname', data.lastName || '');
    params.set('email', data.email || '');
    params.set('company', data.companyName || '');
    params.set('website', data.companyWebsite || '');
    params.set('message', data.aiGoal || '');
    defaultGuests.forEach((email) => params.append('guests', email));
    openInlineScheduler(params);
  });

  function fallbackToCalRedirect(params) {
    window.location.href = meetingUrl + '?' + params.toString();
  }

  function openInlineScheduler(params) {
    const calLink = meetingUrl.replace('https://cal.com/', '');
    const config = { theme: 'dark' };
    params.forEach((value, key) => {
      if (!value) return;
      if (key === 'guests') {
        config.guests = config.guests || [];
        config.guests.push(value);
        return;
      }
      config[key] = value;
    });
    try {
      Cal('init', 'demo', { origin: 'https://app.cal.com' });
      Cal.ns.demo('ui', {
        theme: 'dark',
        hideEventTypeDetails: false,
        layout: 'month_view',
        styles: { branding: { brandColor: '#e7d8bd' } }
      });
      Cal.ns.demo('inline', {
        elementOrSelector: '#cal-inline',
        calLink: calLink,
        config: config
      });
    } catch (error) {
      console.warn(error);
      fallbackToCalRedirect(params);
      return;
    }
    document.querySelector('.wrap').classList.add('hidden');
    document.getElementById('schedulerView').classList.add('active');
    window.scrollTo({ top: 0 });
    setTimeout(() => {
      if (!document.querySelector('#cal-inline iframe')) fallbackToCalRedirect(params);
    }, 6000);
  }
</script>
</body>
</html>`;
}

function serveBookingPage(res) {
  const html = injectTrackingTags(injectSeoTags(bookingPageHtml(), '/book'));
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-cache',
  });
  res.end(html);
}

function rewriteBookingLinks(html) {
  return html
    .replace(/<button([^>]*)data-cal-link="[^"]+"([^>]*)>([\s\S]*?)<\/button>/g, '<a$1href="/book.html"$2>$3</a>')
    .replace(/https:\/\/cal\.com\/withtend\/demo/g, '/book.html')
    .replace(/https:\/\/cal\.com\/kyros-sync\/30min/g, '/book.html')
    .replace(/\sdata-cal-link="[^"]*"/g, '')
    .replace(/\sdata-cal-namespace="[^"]*"/g, '')
    .replace(/\sdata-cal-config='[^']*'/g, '')
    .replace(/<a([^>]*)\stype="button"([^>]*)>/g, '<a$1$2>')
    .replace(/\n?<!-- Cal\.com modal init:[\s\S]*?<\/script>\n?/g, '\n')
    .replace(/\n?<!-- Cal overlay init -->\s*/g, '\n')
    .replace(/\n?<script(?:\s+type="text\/javascript")?>\s*\(function \(C, A, L\)[\s\S]*?app\.cal\.com\/embed\/embed\.js[\s\S]*?<\/script>\n?/g, '\n');
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
  const requestPath = (req.url || '/').split('?')[0];
  if (requestPath === '/robots.txt') return serveRobots(res);
  if (requestPath === '/sitemap.xml') return serveSitemap(res);
  if (requestPath === '/book.html' || requestPath === '/book') return serveBookingPage(res);

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

  if (ext === '.html') {
    const html = injectTrackingTags(injectSeoTags(rewriteBookingLinks(fs.readFileSync(filePath, 'utf8')), requestPath));
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': Buffer.byteLength(html),
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl,
    });
    res.end(html);
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
