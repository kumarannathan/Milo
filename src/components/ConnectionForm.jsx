import { useId, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { api } from '../lib/api.js';
import { tagFor } from '../lib/tags.js';
import { Button, Field, Input, Tag } from './ui.jsx';

// Fields for one provider. Saving creates (or updates) the connection and tests it right away.
export function ConnectionForm({ provider, connection, onSaved, onCancel, submitLabel }) {
  const formId = useId();
  const [label, setLabel] = useState(connection?.label ?? provider.name);
  const [values, setValues] = useState(() =>
    Object.fromEntries(provider.fields.map((f) => [f.key, connection?.values?.[f.key] ?? ''])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(connection ?? null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { label, values };
      const res = connection
        ? await api.patch(`/api/connections/${connection.id}`, body)
        : await api.post('/api/connections', { provider: provider.id, ...body });
      setResult(res.connection);
      if (res.connection.status === 'ok') onSaved?.(res.connection);
      else if (!connection) onSaved?.(res.connection, { failed: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const status = result && result !== connection ? tagFor('connection', result.status) : null;

  return (
    <form className="conn-form" onSubmit={submit} id={formId}>
      <div className="conn-form-head">
        <div className="conn-form-title">
          <span className="provider-mark">{provider.name.slice(0, 2)}</span>
          <div>
            <div className="strong">{provider.name}</div>
            {provider.description && <div className="muted small">{provider.description}</div>}
          </div>
        </div>
        {provider.site && (
          <a className="panel-link" href={`https://${provider.site}`} target="_blank" rel="noreferrer">
            {provider.site} <ExternalLink size={12} />
          </a>
        )}
      </div>

      <div className="cap-tags">
        {provider.capabilities.map((c) => (
          <Tag key={c} color="gray">
            {c}
          </Tag>
        ))}
      </div>

      <Field label="Name" help="Shown when you pick which connection an agent uses.">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>

      {provider.fields.map((f) => (
        <Field key={f.key} label={f.label} help={f.help} optional={!f.required}>
          <Input
            type={f.secret ? 'password' : f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'}
            value={values[f.key] ?? ''}
            placeholder={f.secret && connection ? 'Saved. Leave blank to keep it.' : f.placeholder}
            autoComplete="off"
            spellCheck={false}
            className={f.secret ? 'mono' : undefined}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          />
        </Field>
      ))}

      {provider.fields.length === 0 && <p className="muted small">No setup needed.</p>}

      {error && <div className="form-error">{error}</div>}
      {status && result.status !== 'ok' && (
        <div className="form-error">
          <Tag color={status.color}>{status.label}</Tag> {result.lastError?.message ?? 'The test call failed.'} You can fix the fields and try again.
        </div>
      )}
      {status && result.status === 'ok' && (
        <div className="form-ok">
          <Tag color="green">Connected</Tag> {result.account}
        </div>
      )}

      <div className="conn-form-actions">
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={busy}>
          {submitLabel ?? (connection ? 'Save and test' : 'Connect')}
        </Button>
      </div>
    </form>
  );
}

// Grid of providers to choose from, grouped by category.
export function ProviderPicker({ providers, onPick, connections = [], needed = new Set() }) {
  const groups = {};
  for (const p of providers) (groups[p.category] ??= []).push(p);
  const order = ['Built in', 'Models', 'Data', 'Research', 'Email', 'CRM', 'Calendar', 'Markets', 'Alerts', 'Other'];
  const cats = Object.keys(groups).sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);

  return (
    <div className="provider-picker">
      {cats.map((cat) => (
        <div key={cat} className="provider-group">
          <span className="provider-group-label">{cat}</span>
          <div className="provider-grid">
            {groups[cat].map((p) => {
              const count = connections.filter((c) => c.provider === p.id).length;
              const helps = p.capabilities.filter((c) => needed.has(c)).length;
              return (
                <button key={p.id} type="button" className="provider-card" onClick={() => onPick(p)}>
                  <span className="provider-mark">{p.name.slice(0, 2)}</span>
                  <span className="provider-card-text">
                    <span className="provider-card-name">
                      {p.name}
                      {count > 0 && <Tag color="green">Added</Tag>}
                    </span>
                    <span className="provider-card-caps">{p.capabilities.join(' · ')}</span>
                  </span>
                  {helps > 0 && count === 0 && <Tag color="blue">Needed</Tag>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
