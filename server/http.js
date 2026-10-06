import fs from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

function compile(pattern) {
  const keys = [];
  const re = pattern.replace(/\/:([a-zA-Z_]+)/g, (_, key) => {
    keys.push(key);
    return '/([^/]+)';
  });
  return { re: new RegExp(`^${re}/?$`), keys };
}

async function readBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('Body must be valid JSON');
  }
}

export function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function createRouter() {
  const routes = [];
  const add = (method) => (pattern, handler) => {
    routes.push({ method, ...compile(pattern), handler });
  };

  return {
    get: add('GET'),
    post: add('POST'),
    patch: add('PATCH'),
    put: add('PUT'),
    delete: add('DELETE'),

    // Returns true when a route matched (and the response was handled).
    async handle(req, res) {
      const url = new URL(req.url, 'http://localhost');
      const candidates = routes.filter((r) => r.re.test(url.pathname));
      if (!candidates.length) return false;
      const route = candidates.find((r) => r.method === req.method);
      if (!route) {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      const match = url.pathname.match(route.re);
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
      const query = Object.fromEntries(url.searchParams);
      try {
        const body = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : {};
        const result = await route.handler({ req, res, params, query, body });
        if (!res.headersSent) sendJson(res, 200, result ?? { ok: true });
      } catch (err) {
        if (res.headersSent) return true;
        const status = err instanceof HttpError ? err.status : 500;
        if (status === 500) console.error(err);
        sendJson(res, status, {
          error: status === 500 ? 'Something went wrong on the server.' : err.message,
          ...(err.details ? { details: err.details } : {}),
        });
      }
      return true;
    },
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

// Serves the built frontend with a single-page-app fallback to index.html.
export function createStatic(root) {
  const index = path.join(root, 'index.html');
  return function serve(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (!fs.existsSync(index)) return false;
    const url = new URL(req.url, 'http://localhost');
    let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) return false;
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      const nested = path.join(file, 'index.html');
      file = fs.existsSync(nested) ? nested : index;
    }
    const ext = path.extname(file);
    const immutable = file.includes(`${path.sep}assets${path.sep}`);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') return res.end(), true;
    fs.createReadStream(file).pipe(res);
    return true;
  };
}
