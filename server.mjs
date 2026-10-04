import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const port = Number(process.env.PORT || 3000);

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
