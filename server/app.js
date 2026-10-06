import http from 'node:http';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRouter, createStatic, sendJson } from './http.js';
import { createStore } from './store.js';
import { createEventBus } from './events.js';
import { createRunner } from './runner/runner.js';
import { loadProviders } from './providers/index.js';
import { registerCoreRoutes } from './api/core.js';
import { registerApprovalRoutes } from './api/approvals.js';
import { PLAYBOOKS } from './playbooks/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * @param {{ dataDir?: string|null, password?: string, staticDir?: string|null, log?: Console }} [opts]
 *   dataDir null keeps everything in memory (tests).
 */
export async function createApp({ dataDir = path.join(root, 'data'), password = '', staticDir = path.join(root, 'dist'), log = console } = {}) {
  await loadProviders();
  const bus = createEventBus();
  const store = createStore({ dir: dataDir, onChange: (topics) => bus.publish(topics) });
  const runner = createRunner({ store, log });
  const router = createRouter();
  const deps = { store, runner, bus };

  registerCoreRoutes(router, deps);
  registerApprovalRoutes(router, deps);
  for (const pb of Object.values(PLAYBOOKS)) pb.routes?.(router, deps);

  const serveStatic = staticDir ? createStatic(staticDir) : () => false;

  const server = http.createServer(async (req, res) => {
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
    try {
      if (await router.handle(req, res)) return;
      if (req.url.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
      if (serveStatic(req, res)) return;
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found. Run "npm run build" to build the app, or use "npm run dev".');
    } catch (err) {
      log.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong on the server.' });
    }
  });

  return {
    server,
    store,
    runner,
    bus,
    router,
    async close() {
      await runner.stop();
      bus.close();
      store.flush();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
