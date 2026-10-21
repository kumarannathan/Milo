// One store, runner and event bus per user. Created on first request, unloaded after a quiet half hour.
import path from 'node:path';
import { createStore } from './store.js';
import { createEventBus } from './events.js';
import { createRunner } from './runner/runner.js';

const IDLE_MS = 30 * 60 * 1000;

export function createTenants({ dataDir, log = console, idleMs = IDLE_MS } = {}) {
  const tenants = new Map();
  let autoStart = false; // runners only tick once the app is started (tests drive ticks by hand)

  const sweep = setInterval(() => {
    const cutoff = Date.now() - idleMs;
    for (const [id, t] of tenants) {
      if (t.lastUsed < cutoff && t.runner.activeCount() === 0 && t.bus.size() === 0) unload(id);
    }
  }, 60_000);
  sweep.unref();

  function unload(id) {
    const t = tenants.get(id);
    if (!t) return;
    tenants.delete(id);
    t.runner.stop().catch((err) => log.error(err));
    t.bus.close();
    t.store.flush();
  }

  function dirFor(userId) {
    if (!dataDir) return null;
    // 'local' is the single-user layout (data/milo.json); everyone else gets data/tenants/<id>/.
    return userId === 'local' ? dataDir : path.join(dataDir, 'tenants', encodeURIComponent(userId));
  }

  return {
    for(userId) {
      let t = tenants.get(userId);
      if (!t) {
        const bus = createEventBus();
        const store = createStore({ dir: dirFor(userId), onChange: (topics) => bus.publish(topics), log });
        const runner = createRunner({ store, log });
        if (autoStart) runner.start();
        t = { id: userId, store, runner, bus, lastUsed: Date.now() };
        tenants.set(userId, t);
      }
      t.lastUsed = Date.now();
      return t;
    },

    start() {
      autoStart = true;
      for (const t of tenants.values()) t.runner.start();
    },

    has: (userId) => tenants.has(userId),
    size: () => tenants.size,

    async close() {
      clearInterval(sweep);
      for (const t of tenants.values()) {
        await t.runner.stop();
        t.bus.close();
        t.store.flush();
      }
      tenants.clear();
    },
  };
}
