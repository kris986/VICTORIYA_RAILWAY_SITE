import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const projectDir = fileURLToPath(new URL('../', import.meta.url));
const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));

async function freePort() {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function withServer(variables, inspect) {
  const port = await freePort();
  const child = spawn(process.execPath, [serverPath], {
    cwd: projectDir,
    env: { ...process.env, INDEXING_ENABLED: 'false', PUBLIC_SITE_URL: '', TELEGRAM_URL: '', INSTAGRAM_URL: '', ...variables, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let errorOutput = '';
  child.stderr.on('data', chunk => { errorOutput += chunk; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${errorOutput}`)), 5000);
    child.stdout.on('data', chunk => {
      if (String(chunk).includes('ready on port')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Server exited with ${code}: ${errorOutput}`));
    });
  });

  try {
    await inspect(`http://127.0.0.1:${port}`);
  } finally {
    child.kill('SIGTERM');
  }
}

test('pre-launch mode keeps the page out of the index and has no sitemap', async () => {
  await withServer({}, async base => {
    const page = await fetch(base);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /content="noindex,nofollow"/);
    assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
    assert.match(html, /rel="canonical" href="https:\/\/www\.vektortaro\.com\/"/);
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    assert.match(html, /<h1 id="hero-title" class="eyebrow">[\s\S]*?Виктория · консультации Таро онлайн<\/h1>/);
    assert.match(html, /<p class="hero-slogan">Посмотреть на ситуацию <em>с другой стороны\.<\/em><\/p>/);
    assert.match(html, /<title>Консультации Таро онлайн, нумерология — Виктория<\/title>/);
    assert.equal((html.match(/<title>/g) || []).length, 1);
    assert.equal((html.match(/name="description"/g) || []).length, 1);
    assert.match(html, /<meta property="og:type" content="website">/);
    assert.match(html, /<meta property="og:locale" content="ru_RU">/);
    assert.match(html, /<meta property="og:url" content="https:\/\/www\.vektortaro\.com\/">/);
    assert.equal((html.match(/property="og:image"/g) || []).length, 1);
    assert.match(html, /<meta property="og:image" content="https:\/\/www\.vektortaro\.com\/og-cover\.png">/);
    assert.match(html, /href="https:\/\/t\.me\/viktoria_tarotreader"/);
    assert.equal((html.match(/href="https:\/\/www\.instagram\.com\/viktoria_tarotreader"/g) || []).length, 2);
    assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');

    const robots = await (await fetch(`${base}/robots.txt`)).text();
    assert.match(robots, /Allow: \/\n/);
    assert.doesNotMatch(robots, /Sitemap:/);
    assert.equal((await fetch(`${base}/sitemap.xml`)).status, 404);
  });
});

test('launch mode serves configured contacts, canonical URL and sitemap', async () => {
  await withServer({
    INDEXING_ENABLED: 'true',
    PUBLIC_SITE_URL: 'https://www.vektortaro.com/',
    TELEGRAM_URL: 'https://t.me/new_profile',
    INSTAGRAM_URL: 'https://t.me/new_bot'
  }, async base => {
    const page = await fetch(base);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /content="index,follow"/);
    assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
    assert.match(html, /rel="canonical" href="https:\/\/www\.vektortaro\.com\/"/);
    assert.match(html, /<meta property="og:title" content="Консультации Таро онлайн, нумерология — Виктория">/);
    assert.match(html, /<meta property="og:description" content="Онлайн-консультации Таро с Викторией:/);
    assert.match(html, /rel="icon" type="image\/png" sizes="64x64" href="favicon-64\.png"/);
    assert.match(html, /href="https:\/\/t\.me\/new_profile" data-contact="telegram" target="_blank"/);
    assert.equal((html.match(/href="https:\/\/t\.me\/new_bot" data-contact="instagram"/g) || []).length, 1);
    assert.match(html, /href="https:\/\/www\.instagram\.com\/viktoria_tarotreader" target="_blank" rel="noopener noreferrer" aria-label="Instagram Виктории/);
    assert.equal(page.headers.get('x-robots-tag'), null);

    const favicon = await fetch(`${base}/favicon-64.png`);
    assert.equal(favicon.status, 200);
    assert.equal(favicon.headers.get('content-type'), 'image/png');

    const cover = await fetch(`${base}/og-cover.png`);
    assert.equal(cover.status, 200);
    assert.equal(cover.headers.get('content-type'), 'image/png');

    const robots = await (await fetch(`${base}/robots.txt`)).text();
    assert.match(robots, /Sitemap: https:\/\/www\.vektortaro\.com\/sitemap\.xml/);
    const sitemap = await fetch(`${base}/sitemap.xml`);
    assert.equal(sitemap.status, 200);
    assert.match(await sitemap.text(), /<loc>https:\/\/www\.vektortaro\.com\/<\/loc>/);
  });
});
