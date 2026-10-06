import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader so `npm start` works without extra dependencies.
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

loadEnv(path.join(root, '.env'));

const port = Number(process.env.MILO_PORT ?? 4400);
const host = process.env.MILO_HOST ?? '127.0.0.1';
const dataDir = path.resolve(root, process.env.MILO_DATA_DIR ?? 'data');

const app = await createApp({ dataDir, password: process.env.MILO_PASSWORD ?? '' });
app.runner.start();

app.server.listen(port, host, () => {
  const shown = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`Milo is running at http://${shown}:${port}`);
  if (host !== '127.0.0.1' && host !== 'localhost' && !process.env.MILO_PASSWORD) {
    console.warn('Warning: Milo is listening beyond localhost without MILO_PASSWORD set.');
  }
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
