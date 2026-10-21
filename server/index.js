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

const env = process.env;
const port = Number(env.MILO_PORT ?? 4400);
const host = env.MILO_HOST ?? '127.0.0.1';
const dataDir = path.resolve(root, env.MILO_DATA_DIR ?? 'data');
const authMode = env.MILO_AUTH ?? 'local';
const publicUrl = env.MILO_PUBLIC_URL ?? '';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`MILO_PORT must be a port number, got "${env.MILO_PORT}".`);
  process.exit(1);
}

process.on('unhandledRejection', (err) => console.error('[milo] unhandled rejection', err));
process.on('uncaughtException', (err) => {
  console.error('[milo] uncaught exception', err);
  shutdown(1);
});

const app = await createApp({
  dataDir,
  auth: authMode,
  authOpts: {
    secret: env.MILO_SESSION_SECRET,
    signup: env.MILO_SIGNUP ?? 'open',
    secure: publicUrl.startsWith('https://'),
    supabase: { url: env.SUPABASE_URL, jwtSecret: env.SUPABASE_JWT_SECRET },
  },
  password: env.MILO_PASSWORD ?? '',
  log: env.MILO_QUIET ? { error: console.error, warn: console.warn, log() {} } : console,
});
app.start();

app.server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Set MILO_PORT to pick another.` : err);
  process.exit(1);
});

app.server.listen(port, host, () => {
  const shown = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`Milo is running at http://${shown}:${port} (auth: ${authMode})`);
  if (host !== '127.0.0.1' && host !== 'localhost' && authMode === 'none' && !env.MILO_PASSWORD) {
    console.warn('Warning: Milo is listening beyond localhost with no accounts and no MILO_PASSWORD.');
  }
});

let closing = false;
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  const force = setTimeout(() => process.exit(code), 10_000);
  force.unref();
  try {
    await app.close();
  } catch (err) {
    console.error(err);
  }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
