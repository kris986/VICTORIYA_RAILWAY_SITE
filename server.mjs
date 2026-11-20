import { createReadStream, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const port = Number(process.env.PORT || 3000);
const indexingEnabled = process.env.INDEXING_ENABLED === 'true';
const robotsMeta = '<meta name="robots" content="noindex,nofollow">';
const htmlTemplate = readFileSync(resolve(publicDir, 'index.html'), 'utf8');

if (!htmlTemplate.includes(robotsMeta)) {
  throw new Error('The HTML template must keep its pre-launch noindex tag');
}

function contactUrl(variable, allowedHosts) {
  const value = process.env[variable]?.trim();
  if (!value) return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variable} must be a valid HTTPS profile URL`);
  }
  if (url.protocol !== 'https:' || !allowedHosts.includes(url.hostname) || url.username || url.password || url.port || url.pathname === '/') {
    throw new Error(`${variable} must be an HTTPS profile URL on ${allowedHosts.join(' or ')}`);
  }
  return url.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

const contactUrls = {
  telegram: contactUrl('TELEGRAM_URL', ['t.me']),
  instagram: contactUrl('INSTAGRAM_URL', ['instagram.com', 'www.instagram.com'])
};

const contactHtml = htmlTemplate.replace(/<a\b[^>]*\bdata-contact="(telegram|instagram)"[^>]*>/g, (tag, channel) => {
  const url = contactUrls[channel];
  if (!url) return tag;
  if (!/\bhref="[^"]*"/.test(tag)) throw new Error(`Missing href for ${channel} contact link`);
  return tag.replace(/\bhref="[^"]*"/, `href="${url}"`);
});

let publicSiteUrl;
if (indexingEnabled) {
  let url;
  try {
    url = new URL(process.env.PUBLIC_SITE_URL || '');
  } catch {
    throw new Error('PUBLIC_SITE_URL must be the final HTTPS site origin before enabling indexing');
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_SITE_URL must be a final HTTPS origin without a path, query or fragment');
  }
  publicSiteUrl = `${url.origin}/`;
}

const indexHtml = indexingEnabled
  ? contactHtml.replace(robotsMeta, '<meta name="robots" content="index,follow">')
  : contactHtml;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port');
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function respond(res, status, body, method = 'GET') {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(method === 'HEAD' ? undefined : body);
}

function respondPage(res, body, contentType, method = 'GET', extraHeaders = {}) {
  const bytes = Buffer.from(body, 'utf8');
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': bytes.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(method === 'HEAD' ? undefined : bytes);
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    respond(res, 405, 'Method Not Allowed', req.method);
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  } catch {
    respond(res, 400, 'Bad Request', req.method);
    return;
  }

  if (pathname === '/healthz') {
    respond(res, 200, 'ok', req.method);
    return;
  }

  if (pathname === '/robots.txt') {
    const body = `User-agent: *\nAllow: /\n${indexingEnabled ? `Sitemap: ${publicSiteUrl}sitemap.xml\n` : ''}`;
    respondPage(res, body, 'text/plain; charset=utf-8', req.method);
    return;
  }

  if (pathname === '/sitemap.xml') {
    if (!indexingEnabled) {
      respond(res, 404, 'Not Found', req.method);
      return;
    }
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${publicSiteUrl}</loc></url>\n</urlset>\n`;
    respondPage(res, body, 'application/xml; charset=utf-8', req.method);
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    respondPage(res, indexHtml, 'text/html; charset=utf-8', req.method,
      indexingEnabled ? {} : { 'X-Robots-Tag': 'noindex, nofollow' });
    return;
  }

  if (pathname.endsWith('/')) pathname += 'index.html';
  const filePath = resolve(publicDir, `.${pathname}`);
  const rel = relative(publicDir, filePath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    respond(res, 403, 'Forbidden', req.method);
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      respond(res, 404, 'Not Found', req.method);
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
  } catch {
    respond(res, 404, 'Not Found', req.method);
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Viktoria site ready on port ${port}`);
});

process.on('SIGTERM', () => server.close());
