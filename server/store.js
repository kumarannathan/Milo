import fs from 'node:fs';
import path from 'node:path';
import { newId } from './lib/ids.js';

// Every collection the app persists, with the id prefix used for new records.
export const COLLECTIONS = {
  connections: 'cn',
  agents: null, // keyed by agent id from the playbook
  tasks: 'tsk',
  runs: 'run',
  toolCalls: 'tc',
  activity: 'act',
  notes: 'note',
  // Sales development
  accounts: 'acc',
  contacts: 'con',
  approvals: 'apr',
  threads: 'thr',
  meetings: 'mtg',
  // Markets
  markets: 'mkt',
  signals: 'sig',
  positions: 'pos',
  equity: 'eq',
};

// Oldest records are dropped past these sizes so the data file stays small.
const RETENTION = {
  runs: 2000,
  toolCalls: 4000,
  activity: 3000,
  tasks: 5000,
  equity: 5000,
  signals: 3000,
  notes: 500,
};

function emptyData() {
  const data = { version: 1, workspace: null, wallet: null };
  for (const name of Object.keys(COLLECTIONS)) data[name] = [];
  return data;
}

export function createStore({ dir, file = 'milo.json', onChange = () => {}, log = console } = {}) {
  const filePath = dir ? path.join(dir, file) : null;
  let data = emptyData();
  let saveTimer = null;
  let pendingTopics = new Set();
  let notifyScheduled = false;

  if (filePath && fs.existsSync(filePath)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      data = { ...emptyData(), ...loaded };
    } catch (err) {
      // A half-written or corrupt file must not take the whole server down: keep it aside and start clean.
      const backup = `${filePath}.corrupt-${Date.now()}`;
      fs.renameSync(filePath, backup);
      log.error?.(`[store] ${filePath} could not be read (${err.message}); moved to ${backup} and starting empty.`);
    }
  }

  function writeNow() {
    if (!filePath) return;
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(tmp, filePath);
    } catch (err) {
      // Disk full or permissions: keep running with the in-memory copy and try again on the next change.
      log.error?.(`[store] could not save ${filePath}: ${err.message}`);
    }
  }

  function scheduleSave() {
    if (!filePath || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      writeNow();
    }, 250);
  }

  function changed(...topics) {
    for (const t of topics) pendingTopics.add(t);
    scheduleSave();
    if (notifyScheduled) return;
    notifyScheduled = true;
    setImmediate(() => {
      notifyScheduled = false;
      const list = [...pendingTopics];
      pendingTopics = new Set();
      if (list.length) onChange(list);
    });
  }

  function trim(name) {
    const max = RETENTION[name];
    if (max && data[name].length > max) data[name].splice(0, data[name].length - max);
  }

  function matches(rec, where) {
    if (!where) return true;
    if (typeof where === 'function') return where(rec);
    return Object.entries(where).every(([k, v]) => rec[k] === v);
  }

  return {
    get data() {
      return data;
    },

    list(name, where) {
      const rows = data[name];
      return where ? rows.filter((r) => matches(r, where)) : rows.slice();
    },

    get(name, id) {
      return data[name].find((r) => r.id === id) ?? null;
    },

    find(name, where) {
      return data[name].find((r) => matches(r, where)) ?? null;
    },

    count(name, where) {
      return where ? data[name].filter((r) => matches(r, where)).length : data[name].length;
    },

    insert(name, rec) {
      const prefix = COLLECTIONS[name];
      const now = new Date().toISOString();
      const row = { id: rec.id ?? (prefix ? newId(prefix) : undefined), createdAt: now, ...rec };
      data[name].push(row);
      trim(name);
      changed(name);
      return row;
    },

    update(name, id, patch) {
      const row = data[name].find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, typeof patch === 'function' ? patch(row) : patch, {
        updatedAt: new Date().toISOString(),
      });
      changed(name);
      return row;
    },

    remove(name, id) {
      const i = data[name].findIndex((r) => r.id === id);
      if (i === -1) return false;
      data[name].splice(i, 1);
      changed(name);
      return true;
    },

    removeWhere(name, where) {
      const before = data[name].length;
      data[name] = data[name].filter((r) => !matches(r, where));
      if (data[name].length !== before) changed(name);
      return before - data[name].length;
    },

    // Singletons: workspace, wallet.
    getValue(key) {
      return data[key];
    },

    setValue(key, value) {
      data[key] = value;
      changed(key);
      return value;
    },

    patchValue(key, patch) {
      data[key] = { ...(data[key] ?? {}), ...patch };
      changed(key);
      return data[key];
    },

    reset() {
      data = emptyData();
      changed('workspace', ...Object.keys(COLLECTIONS));
    },

    changed,

    flush() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      writeNow();
    },
  };
}
