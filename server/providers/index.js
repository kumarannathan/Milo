import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { maskSecret } from './io.js';

/*
 * A provider is a vendor Milo can talk to. Each file in this folder (or folder with an
 * index.js) default-exports one provider:
 *
 * {
 *   id: 'apollo',                       // stable, used in saved connections
 *   name: 'Apollo',
 *   category: 'Data',                   // groups the Connections screen
 *   site: 'apollo.io',
 *   playbooks: ['sales'],               // which setups offer it ('sales', 'markets')
 *   fields: [{ key, label, secret?, required?, placeholder?, help?, type?: 'text'|'number'|'url'|'email' }],
 *   handlers: { 'accounts.search': async (args, { conn, io, model }) => result, ... },
 *   test: async ({ conn, io }) => ({ account: 'shown next to the connection name' }),
 *   models?: ['model-id', ...],         // LLM providers only
 *   defaultModel?: 'model-id',
 *   pricing?: (model) => ({ in, out }) | null,   // USD per million tokens
 * }
 *
 * Capability argument and result shapes are documented in docs/capabilities.md.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SKIP = new Set(['index.js', 'io.js']);

let registry = null;

export async function loadProviders(dir = here) {
  if (registry) return registry;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.js') && !SKIP.has(e.name) && !e.name.endsWith('.test.js')) {
      files.push(path.join(dir, e.name));
    } else if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'index.js'))) {
      files.push(path.join(dir, e.name, 'index.js'));
    }
  }
  const loaded = await Promise.all(files.map((f) => import(pathToFileURL(f).href)));
  registry = new Map();
  for (const mod of loaded) {
    const p = mod.default;
    if (!p?.id || !p.handlers) continue;
    registry.set(p.id, p);
  }
  return registry;
}

export function getProvider(id) {
  return registry?.get(id) ?? null;
}

export function providerCapabilities(provider) {
  return Object.keys(provider?.handlers ?? {});
}

// What the browser sees: no secret values, only whether they are set.
export function describeProvider(p) {
  return {
    id: p.id,
    name: p.name,
    category: p.category ?? 'Other',
    site: p.site ?? null,
    playbooks: p.playbooks ?? ['sales', 'markets'],
    description: p.description ?? null,
    fields: (p.fields ?? []).map(({ key, label, secret, required, placeholder, help, type }) => ({
      key,
      label,
      secret: !!secret,
      required: !!required,
      placeholder: placeholder ?? '',
      help: help ?? '',
      type: type ?? (secret ? 'password' : 'text'),
    })),
    capabilities: providerCapabilities(p),
    models: p.models ?? [],
    defaultModel: p.defaultModel ?? null,
    noSetup: !(p.fields ?? []).some((f) => f.required),
  };
}

export function publicConnection(conn) {
  if (!conn) return null;
  const provider = getProvider(conn.provider);
  const secretKeys = new Set((provider?.fields ?? []).filter((f) => f.secret).map((f) => f.key));
  const values = {};
  for (const [k, v] of Object.entries(conn.values ?? {})) {
    values[k] = secretKeys.has(k) ? (v ? maskSecret(v) : '') : v;
  }
  return {
    id: conn.id,
    provider: conn.provider,
    providerName: provider?.name ?? conn.provider,
    label: conn.label,
    account: conn.account ?? '',
    status: conn.status ?? 'untested',
    lastError: conn.lastError ?? null,
    lastCheckedAt: conn.lastCheckedAt ?? null,
    capabilities: providerCapabilities(provider),
    values,
    createdAt: conn.createdAt,
  };
}
