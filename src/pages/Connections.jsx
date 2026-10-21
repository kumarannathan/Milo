import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app-context.jsx';
import { useNow, useResource } from '../lib/live.js';
import { formatAgoLong } from '../lib/format.js';
import { tagFor } from '../lib/tags.js';
import { ConfirmDialog, Dialog, useAction } from '../components/feedback.jsx';
import { ConnectionForm, ProviderPicker } from '../components/ConnectionForm.jsx';
import { Button, EmptyState, PageHeader, Select, SkeletonRows, StatusPill } from '../components/ui.jsx';
import { modelOptions } from './agents-shared.js';
import './connections.css';

const DOT = { ok: 'var(--success)', untested: 'var(--idle)', expired: 'var(--destructive)', error: 'var(--destructive)' };

export default function Connections() {
  const app = useApp();
  const now = useNow();
  const conns = useResource('/api/connections', ['connections', 'agents', 'workspace']);
  const agents = useResource('/api/agents', ['agents', 'connections']);
  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState(null);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);

  const connections = conns.data?.connections ?? [];
  const providers = app.providers.filter((p) => p.playbooks.includes(app.playbook.id));
  const providerById = Object.fromEntries(app.providers.map((p) => [p.id, p]));
  const agentList = agents.data?.agents ?? [];
  const agentById = Object.fromEntries(agentList.map((a) => [a.id, a]));

  const [test] = useAction((id) => api.post(`/api/connections/${id}/test`), {
    success: (r) => (r.connection.status === 'ok' ? `${r.connection.label} is working.` : `${r.connection.label}: ${r.connection.lastError?.message ?? 'test failed'}`),
  });
  const [remove, removingBusy] = useAction((id) => api.del(`/api/connections/${id}`), { success: 'Connection removed.', onDone: () => setRemoving(null) });
  const [setDefaultModel] = useAction((value) => {
    const [connectionId, ...rest] = value.split('::');
    return api.patch('/api/workspace', { defaultModel: value ? { connectionId, model: rest.join('::') } : null });
  }, { success: 'Default model saved.' });

  // What enabled agents still need: one line per missing action, with the agents that want it.
  const missing = new Map();
  for (const a of agentList) {
    if (!a.enabled) continue;
    for (const c of a.capabilities) {
      if (c.status !== 'missing') continue;
      const m = missing.get(c.key) ?? { key: c.key, label: c.label, agents: [] };
      m.agents.push(a.name);
      missing.set(c.key, m);
    }
  }
  const needed = new Set(missing.keys());

  const ws = app.workspace;
  const models = connections.filter((c) => c.capabilities.includes('llm.complete'));
  const defaultValue = ws.defaultModel ? `${ws.defaultModel.connectionId}::${ws.defaultModel.model ?? ''}` : '';
  const modelOpts = modelOptions(connections, app.providers, null).map((o) => (o.value === '' ? { value: '', label: 'First model connection' } : o));

  return (
    <div className="page">
      <PageHeader title="Connections" sub={conns.data ? `${connections.length} connected` : undefined}>
        <Button icon={Plus} onClick={() => setAdding(true)}>
          Add
        </Button>
      </PageHeader>

      <div className="page-body conn-body">
        {missing.size > 0 && (
          <div className="conn-need">
            <span>
              Your agents still need connections to <b>{[...missing.values()].map((m) => m.label.toLowerCase()).join(', ')}</b>.
            </span>
            <Button size="sm" onClick={() => setAdding(true)}>
              Add
            </Button>
          </div>
        )}

        {models.length > 1 && (
          <div className="conn-default">
            <span className="strong">Default model</span>
            <Select value={defaultValue} onChange={setDefaultModel} options={modelOpts} aria-label="Default model" className="conn-default-select" />
          </div>
        )}

        <div className="conn-list">
          {!conns.data ? (
            <div className="panel">
              <SkeletonRows rows={4} height={64} />
            </div>
          ) : connections.length === 0 ? (
            <div className="panel">
              <EmptyState title="No connections yet" actions={<Button icon={Plus} onClick={() => setAdding(true)}>Add a connection</Button>} />
            </div>
          ) : (
            connections.map((c) => {
              const t = tagFor('connection', c.status);
              const users = [...new Set(c.usedBy.map((u) => agentById[u.agentId]?.name).filter(Boolean))];
              const p = providerById[c.provider];
              const detail =
                c.status === 'ok' || !c.lastError
                  ? [c.account, c.lastCheckedAt && `checked ${formatAgoLong(c.lastCheckedAt, now)} ago`].filter(Boolean).join(' · ')
                  : c.lastError.message;
              return (
                <section key={c.id} className="panel conn-card">
                  <span className="provider-mark">{(p?.name ?? c.label).slice(0, 2)}</span>
                  <div className="conn-card-text">
                    <div className="conn-card-title">
                      <span className="strong">{c.label}</span>
                      {c.label !== c.providerName && <span className="muted">{c.providerName}</span>}
                      <StatusPill color={DOT[c.status] ?? DOT.untested}>{t.label}</StatusPill>
                    </div>
                    <span className={c.status === 'ok' || !c.lastError ? 'muted small truncate' : 'error-text small truncate'}>{detail || '—'}</span>
                    <span className="muted small truncate">
                      {c.capabilities.length} {c.capabilities.length === 1 ? 'action' : 'actions'}
                      {users.length ? ` · used by ${users.join(', ')}` : ' · not used yet'}
                    </span>
                  </div>
                  <RowMenu
                    items={[
                      { label: 'Test', run: () => test(c.id) },
                      p?.fields.length > 0 && { label: 'Edit', run: () => setEditing(c) },
                      { label: 'Remove', run: () => setRemoving(c), danger: true },
                    ].filter(Boolean)}
                  />
                </section>
              );
            })
          )}
        </div>
      </div>

      <Dialog
        open={adding}
        onClose={() => {
          setAdding(false);
          setProvider(null);
        }}
        title={provider ? `Connect ${provider.name}` : 'Add a connection'}
        width={provider ? 560 : 760}
      >
        {provider ? (
          <ConnectionForm
            provider={provider}
            onCancel={() => setProvider(null)}
            onSaved={(c, opts) => {
              if (!opts?.failed) {
                setAdding(false);
                setProvider(null);
              }
            }}
          />
        ) : (
          <ProviderPicker providers={providers} connections={connections} needed={needed} onPick={setProvider} />
        )}
      </Dialog>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing ? `Edit ${editing.label}` : ''} width={560}>
        {editing && <ConnectionForm provider={providerById[editing.provider]} connection={editing} onCancel={() => setEditing(null)} onSaved={() => setEditing(null)} />}
      </Dialog>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => remove(removing.id)}
        busy={removingBusy}
        destructive
        title={removing ? `Remove ${removing.label}?` : ''}
        description="Agents that use it stop until another connection can do the same thing."
        confirmLabel="Remove"
      />
    </div>
  );
}

function RowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="row-menu" ref={ref}>
      <button type="button" className="icon-btn" aria-label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="row-menu-pop" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={it.danger ? 'row-menu-item danger' : 'row-menu-item'}
              onClick={() => {
                setOpen(false);
                it.run();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
