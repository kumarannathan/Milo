import { useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app-context.jsx';
import { useNow, useResource } from '../lib/live.js';
import { formatAgoLong } from '../lib/format.js';
import { tagFor } from '../lib/tags.js';
import { ConfirmDialog, Dialog, useAction } from '../components/feedback.jsx';
import { ConnectionForm, ProviderPicker } from '../components/ConnectionForm.jsx';
import { Banner, Button, EmptyState, Mono, PageHeader, Select, SkeletonRows, Tag } from '../components/ui.jsx';
import { modelOptions } from './agents-shared.js';
import './connections.css';

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
  const broken = connections.filter((c) => c.status === 'expired' || c.status === 'error');

  const [test] = useAction((id) => api.post(`/api/connections/${id}/test`), {
    success: (r) => (r.connection.status === 'ok' ? `${r.connection.label} is working.` : `${r.connection.label}: ${r.connection.lastError?.message ?? 'test failed'}`),
  });
  const [remove, removingBusy] = useAction((id) => api.del(`/api/connections/${id}`), {
    success: 'Connection removed.',
    onDone: () => setRemoving(null),
  });
  const [setDefaultModel] = useAction((value) => {
    const [connectionId, ...rest] = value.split('::');
    return api.patch('/api/workspace', { defaultModel: value ? { connectionId, model: rest.join('::') } : null });
  }, { success: 'Default model saved.' });

  // Every capability enabled agents use, and which connection serves it.
  const coverage = new Map();
  for (const a of agentList) {
    if (!a.enabled) continue;
    for (const c of a.capabilities) {
      const entry = coverage.get(c.key) ?? { key: c.key, label: c.label, required: false, agents: [], conns: new Set(), statuses: new Set() };
      entry.required ||= c.required;
      entry.agents.push(a);
      if (c.connection) entry.conns.add(c.connection.label);
      entry.statuses.add(c.status);
      coverage.set(c.key, entry);
    }
  }

  const ws = app.workspace;
  const defaultValue = ws.defaultModel ? `${ws.defaultModel.connectionId}::${ws.defaultModel.model ?? ''}` : '';
  const modelOpts = modelOptions(connections, app.providers, null).map((o) => (o.value === '' ? { value: '', label: 'First model connection' } : o));

  return (
    <div className="page">
      <PageHeader title="Connections" sub="Keys stay on this machine. One connection can serve several actions, and you choose which one each agent uses.">
        <Button icon={Plus} onClick={() => setAdding(true)}>
          Add connection
        </Button>
      </PageHeader>

      {broken.length > 0 && (
        <Banner tone="error">
          <b>{broken.map((c) => c.label).join(', ')}</b> {broken.length === 1 ? 'needs' : 'need'} attention. Agents that use {broken.length === 1 ? 'it' : 'them'} hold their work until you reconnect.
        </Banner>
      )}

      <div className="page-body conn-layout">
        <div className="conn-list">
          {!conns.data ? (
            <div className="panel">
              <SkeletonRows rows={4} height={64} />
            </div>
          ) : connections.length === 0 ? (
            <div className="panel">
              <EmptyState title="No connections yet" actions={<Button icon={Plus} onClick={() => setAdding(true)}>Add connection</Button>}>
                Add a model and the services your agents need. Each one is tested when you save it.
              </EmptyState>
            </div>
          ) : (
            connections.map((c, i) => {
              const t = tagFor('connection', c.status);
              const users = [...new Set(c.usedBy.map((u) => u.agentId))];
              return (
                <section key={c.id} className="panel conn-card" style={{ animationDelay: `${i * 30}ms` }}>
                  <div className="conn-card-main">
                    <span className="provider-mark">{(providerById[c.provider]?.name ?? c.label).slice(0, 2)}</span>
                    <div className="conn-card-text">
                      <div className="conn-card-title">
                        <span className="strong">{c.label}</span>
                        {c.label !== c.providerName && <span className="muted">{c.providerName}</span>}
                        <Tag color={t.color}>{t.label}</Tag>
                      </div>
                      <span className="muted small">
                        {c.status === 'ok' || !c.lastError ? c.account || '—' : c.lastError.message}
                        {c.lastCheckedAt && ` · checked ${formatAgoLong(c.lastCheckedAt, now)} ago`}
                      </span>
                    </div>
                    <div className="conn-card-actions">
                      <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => test(c.id)}>
                        Test
                      </Button>
                      {providerById[c.provider]?.fields.length > 0 && (
                        <Button variant="outline" size="sm" onClick={() => setEditing(c)}>
                          Edit
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(c)}>
                        Remove
                      </Button>
                    </div>
                  </div>
                  <div className="conn-card-foot">
                    <div className="cap-tags">
                      {c.capabilities.map((k) => (
                        <Tag key={k} color="gray">
                          {k}
                        </Tag>
                      ))}
                    </div>
                    {users.length > 0 ? (
                      <span className="conn-users" title={users.map((id) => agentById[id]?.name ?? id).join(', ')}>
                        <span className="muted small">Used by</span>
                        {users.map((id) => (
                          <Mono key={id} size="xs">
                            {agentById[id]?.mono ?? '··'}
                          </Mono>
                        ))}
                      </span>
                    ) : (
                      <span className="muted small">Not used by any agent</span>
                    )}
                  </div>
                </section>
              );
            })
          )}
        </div>

        <aside className="conn-side">
          <section className="panel">
            <div className="panel-head">
              <h2>Default model</h2>
            </div>
            <div className="panel-body conn-model">
              <Select value={defaultValue} onChange={setDefaultModel} options={modelOpts} aria-label="Default model" />
              <span className="muted small">Agents use this unless you pick a model for them on the Agents screen.</span>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Coverage</h2>
              <span className="panel-hint">For agents that are on</span>
            </div>
            <div className="rows">
              {[...coverage.values()].map((r) => {
                const status = r.statuses.has('expired') ? 'expired' : r.statuses.has('missing') ? 'missing' : r.statuses.has('connected') ? 'connected' : 'skipped';
                const t = tagFor('connection', status);
                return (
                  <div key={r.key} className="row coverage-row">
                    <span className="coverage-text">
                      <span className="strong">{r.label}</span>
                      <span className="muted small truncate">{r.conns.size ? [...r.conns].join(', ') : r.agents.map((a) => a.name).join(', ')}</span>
                    </span>
                    <Tag color={t.color}>{status === 'skipped' && !r.required ? 'Optional' : t.label}</Tag>
                  </div>
                );
              })}
              {coverage.size === 0 && <div className="panel-body muted small">Turn on an agent to see what it needs.</div>}
            </div>
          </section>
        </aside>
      </div>

      <Dialog
        open={adding}
        onClose={() => {
          setAdding(false);
          setProvider(null);
        }}
        title={provider ? `Connect ${provider.name}` : 'Add connection'}
        description={provider ? null : 'Pick a service. You can add more than one of each, for example two inboxes.'}
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
          <ProviderPicker providers={providers} connections={connections} needed={new Set([...coverage.values()].filter((r) => r.statuses.has('missing')).map((r) => r.key))} onPick={setProvider} />
        )}
      </Dialog>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing ? `Edit ${editing.label}` : ''} width={560}>
        {editing && (
          <ConnectionForm provider={providerById[editing.provider]} connection={editing} onCancel={() => setEditing(null)} onSaved={() => setEditing(null)} />
        )}
      </Dialog>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => remove(removing.id)}
        busy={removingBusy}
        destructive
        title={removing ? `Remove ${removing.label}?` : ''}
        description="Agents that use it switch to another connection that can do the same thing, or stop until you add one."
        confirmLabel="Remove"
      />
    </div>
  );
}
