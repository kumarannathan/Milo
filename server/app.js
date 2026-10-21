import http from 'node:http';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HttpError, createRouter, createStatic, sendJson } from './http.js';
import { createTenants } from './tenants.js';
import { createAuth } from './auth/index.js';
import { loadProviders } from './providers/index.js';
import { registerCoreRoutes } from './api/core.js';
import { registerApprovalRoutes } from './api/approvals.js';
import { PLAYBOOKS, enablePlaybooks } from './playbooks/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Routes anyone may call before signing in.
const OPEN = new Set(['/api/health', '/api/meta', '/api/auth/signup', '/api/auth/signin', '/api/auth/signout', '/api/auth/reset', '/api/auth/me']);

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Route handlers were written against one store/runner/bus. These proxies hand each request its own
// tenant's instances, so the handlers don't change as Milo goes multi-user.
function tenantProxy(als, key) {
  return new Proxy(
    {},
    {
      get(_, prop) {
        const t = als.getStore();
        if (!t) throw new HttpError(401, 'Sign in first.');
        const v = t[key][prop];
        return typeof v === 'function' ? v.bind(t[key]) : v;
      },
    },
  );
}

/**
 * @param {{ dataDir?: string|null, auth?: 'none'|'local'|'supabase', authOpts?: object, password?: string,
 *           playbooks?: string[], staticDir?: string|null, log?: Console }} [opts]
 *   dataDir null keeps everything in memory (tests). auth 'none' makes every request the built-in local user.
 */
export async function createApp({
  dataDir = path.join(root, 'data'),
  auth: authMode = 'none',
  authOpts = {},
  password = '',
  playbooks,
  staticDir = path.join(root, 'dist'),
  log = console,
} = {}) {
  await loadProviders();
  if (playbooks) enablePlaybooks(playbooks);

  const als = new AsyncLocalStorage();
  const tenants = createTenants({ dataDir, log });
  const auth = createAuth({ mode: authMode, dir: dataDir, ...authOpts });
  const router = createRouter();
  const deps = { store: tenantProxy(als, 'store'), runner: tenantProxy(als, 'runner'), bus: tenantProxy(als, 'bus'), tenants, auth };

  auth.registerRoutes(router);
  registerCoreRoutes(router, deps);
  registerApprovalRoutes(router, deps);
  for (const pb of Object.values(PLAYBOOKS)) pb.routes?.(router, deps);

  const serveStatic = staticDir ? createStatic(staticDir) : () => false;

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    if (password) {
      const header = req.headers.authorization ?? '';
      const [scheme, encoded] = header.split(' ');
      const supplied = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':') : '';
      if (!safeEqual(supplied, password)) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Milo"' });
        res.end('Sign in required');
        return;
      }
    }
    const pathname = req.url.split('?')[0];
    const isApi = pathname.startsWith('/api/');
    try {
      if (!isApi) {
        if (serveStatic(req, res)) return;
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found. Run "npm run build" to build the app, or use "npm run dev".');
        return;
      }
      // Cookie sessions need a CSRF check: writes must be JSON and, when a browser sends Origin, same-origin.
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const type = String(req.headers['content-type'] ?? '');
        const origin = req.headers.origin;
        const sameOrigin = !origin || origin === `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}` || origin.endsWith(`//${req.headers.host}`);
        const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || !!req.headers['transfer-encoding'];
        if ((hasBody && !type.startsWith('application/json')) || !sameOrigin) {
          return sendJson(res, 403, { error: 'Cross-site request blocked.' });
        }
      }
      req.user = auth.resolveUser(req);
      if (!req.user && !OPEN.has(pathname)) return sendJson(res, 401, { error: 'Sign in first.', code: 'signed_out' });
      const tenant = req.user ? tenants.for(req.user.id) : null;
      const handled = await als.run(tenant, () => router.handle(req, res));
      if (!handled) sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      log.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong on the server.' });
    } finally {
      if (isApi && pathname !== '/api/events' && log.info) {
        log.info(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms${req.user ? ` ${req.user.id}` : ''}`);
      }
    }
  });

  // Single-user conveniences for tests and scripts: the built-in local tenant's pieces.
  const local = () => tenants.for('local');

  return {
    server,
    tenants,
    auth,
    router,
    get store() {
      return local().store;
    },
    get runner() {
      return local().runner;
    },
    get bus() {
      return local().bus;
    },
    start() {
      tenants.start();
    },
    async close() {
      await tenants.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
