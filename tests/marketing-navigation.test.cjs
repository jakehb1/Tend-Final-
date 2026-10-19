const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const base = 'http://127.0.0.1:18414';
let server;
before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { PATH: process.env.PATH, PORT: '18414', SESSION_SECRET: 'navigation-test-only', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test server did not start')), 10000);
    server.once('error', reject);
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
    server.stdout.on('data', data => { if (data.toString().includes('tend on port')) { clearTimeout(timer); resolve(); } });
  });
});
after(() => server?.kill());

const pages = ['/', '/about', '/platform', '/use-cases', '/org', '/book'];
const links = html => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
for (const page of pages) {
  test(`${page}: consistent navigation and no placeholder destinations`, async () => {
    const response = await fetch(base + page);
    assert.equal(response.status, 200);
    const html = await response.text();
    const nav = html.match(/<nav class="marketing-links"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    assert.ok(nav);
    assert.deepEqual(links(nav).map(match => [match[1], match[2].trim()]), [
      ['/#how-it-works', 'How it works'], ['/use-cases', 'Use cases'], ['/about', 'About'], ['/book', 'Book a demo'],
    ]);
    for (const match of links(html)) {
      assert.notEqual(match[1], '#');
      assert.ok(!/^https:\/\/(instagram|linkedin)\.com\/?$/.test(match[1]));
      if (match[1] === '/book') {
        assert.match(match[2], /Book a demo/i);
        assert.ok(!match[0].includes('target="_blank"'));
      }
      if (match[1].startsWith('#') || match[1].startsWith('/#')) {
        const target = match[1].startsWith('/#') ? await (await fetch(base)).text() : html;
        assert.ok(target.includes(`id="${match[1].split('#')[1]}"`), `Missing anchor ${match[1]}`);
      }
    }
  });
}
test('legacy addresses redirect without losing campaign parameters', async () => {
  for (const [oldPath, canonical] of [['index', '/'], ['about', '/about'], ['platform', '/platform'], ['use-cases', '/use-cases'], ['org', '/org'], ['book', '/book']]) {
    const response = await fetch(`${base}/${oldPath}.html?utm_source=test`, { redirect: 'manual' });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), `${canonical}?utm_source=test`);
  }
});

test('homepage explains the offer and clearly labels the example', async () => {
  const html = await (await fetch(base)).text();
  assert.match(html, /<title>Tend \| Put AI to work across your business<\/title>/);
  assert.match(html, /Find your first workflow/);
  assert.match(html, /AN EXAMPLE, NOT A LIVE WORKFLOW/);
  assert.match(html, /No systems are connected and no actions are taken on this page/);
  assert.ok(!html.includes('—'));
  assert.ok(!html.includes('src="/home.js"'), 'Do not load the removed diagram interaction');
  const css = await fetch(base + '/home-business-owner.css');
  assert.equal(css.status, 200);
});
