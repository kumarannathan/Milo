import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, SlidersHorizontal } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app-context.jsx';
import { useNow, useResource } from '../lib/live.js';
import { agentDot, tagFor } from '../lib/tags.js';
import { formatClock, formatCost, formatDuration, formatIn, formatNumber, formatShort, formatTime, plural } from '../lib/format.js';
import { Dialog, useAction } from '../components/feedback.jsx';
import { Button, Dot, EmptyState, Field, Input, Mono, Select, SkeletonRows, StatusPill, Switch, Tag, Textarea } from '../components/ui.jsx';
import { SCHEDULE_PRESETS, configValueLabel, decodeModel, encodeModel, modelOptions } from './agents-shared.js';
import './agents.css';

const STATUS_LABEL = { running: 'Running', idle: 'Idle', error: 'Error', off: 'Off', paused: 'Paused' };

function list(items) {
  return items?.length ? items.join(', ') : '—';
}

export default function Agents({ agentId }) {
  const { data } = useResource('/api/agents', ['agents', 'tasks', 'connections', 'workspace']);
  const agents = data?.agents ?? [];
  const fallback = agents.find((a) => a.status === 'error') ?? agents[0];
  const selected = agents.find((a) => a.id === agentId) ?? fallback;

  return (
    <div className="page agents-page">
      <nav className="agent-list" aria-label="Agents">
        <div className="agent-list-inner">
          <span className="agent-list-title">
            Agents <span className="count">{agents.length || ''}</span>
          </span>
          {agents.map((a, i) => (
            <a
              key={a.id}
              href={`#/agents/${a.id}`}
              className={a.id === selected?.id ? 'agent-list-item selected' : 'agent-list-item'}
              aria-current={a.id === selected?.id ? 'page' : undefined}
            >
              <span className="agent-pos">{i + 1}</span>
              <Mono>{a.mono}</Mono>
              <span className="agent-name">{a.name}</span>
              <Dot color={agentDot(a.status)} pulse={a.running} />
            </a>
          ))}
        </div>
      </nav>
      {selected ? <AgentDetail key={selected.id} id={selected.id} /> : <div className="agent-detail"><SkeletonRows rows={8} /></div>}
    </div>
  );
}

function AgentDetail({ id }) {
  const app = useApp();
  const now = useNow(15_000);
  const res = useResource(`/api/agents/${id}`, ['agents', 'runs', 'toolCalls', 'tasks', 'connections', 'workspace']);
  const [editing, setEditing] = useState(null); // 'schedule' | 'config'

  const [toggle] = useAction((enabled) => api.patch(`/api/agents/${id}`, { enabled }), {
    success: (_, enabled) => (enabled ? 'Agent turned on.' : 'Agent turned off. Queued work waits until you turn it back on.'),
  });
  const [runNow, running] = useAction(() => api.post(`/api/agents/${id}/run`), { success: 'Run started.' });
  const [patch] = useAction((body) => api.patch(`/api/agents/${id}`, body), { success: 'Saved.' });

  if (!res.data) return <div className="agent-detail"><SkeletonRows rows={8} /></div>;
  const { agent, runs, toolCalls, queue } = res.data;
  const status = agent.running ? 'running' : agent.status;
  const err = agent.lastError && agent.status === 'error' ? agent.lastError : null;

  return (
    <main className="agent-detail">
      <header className="agent-header">
        <Mono size="lg">{agent.mono}</Mono>
        <div className="agent-heading">
          <div className="agent-title-row">
            <h1>{agent.name}</h1>
            <StatusPill color={agentDot(status)} pulse={status === 'running'}>
              {STATUS_LABEL[status]}
            </StatusPill>
          </div>
          <span className="agent-summary">
            {agent.job}
            {agent.consumes.length > 0 && (
              <>
                {' '}· picks up <code>{list(agent.consumes)}</code>
              </>
            )}
            {agent.produces.length > 0 && (
              <>
                {' '}· hands off <code>{list(agent.produces)}</code>
              </>
            )}
          </span>
        </div>
        <Switch checked={agent.enabled} label={agent.enabled ? 'On' : 'Off'} onChange={(on) => toggle(on)} />
        <Button variant="outline" icon={Play} onClick={() => runNow()} loading={running} disabled={agent.running}>
          Run now
        </Button>
      </header>

      {err && <ErrorBanner agent={agent} err={err} connections={app.connections} />}

      <div className="summary-cards">
        <section className="card">
          <span className="card-label">Schedule</span>
          <span className="card-value">{agent.schedule.label}</span>
          <span className="card-mono">{agent.schedule.type === 'cron' ? agent.schedule.cron : 'event-driven · no cron'}</span>
          <span className="card-foot">
            {agent.schedule.type === 'cron' && agent.nextRunAt
              ? `Next run ${formatTime(agent.nextRunAt)} (${formatIn(agent.nextRunAt, now)})${agent.lastRunAt ? ` · last ${formatTime(agent.lastRunAt)}` : ''}`
              : agent.queued
                ? `${plural(agent.queued, 'task')} queued`
                : 'Queue empty'}
          </span>
          <button type="button" className="card-link" onClick={() => setEditing('schedule')}>
            Change schedule
          </button>
        </section>

        <section className="card">
          <span className="card-label">Model</span>
          {agent.usesModel ? (
            <Select
              value={encodeModel(agent.model)}
              onChange={(v) => patch({ model: decodeModel(v) })}
              options={modelOptions(app.connections, app.providers, app.workspace)}
              aria-label="Model"
            />
          ) : (
            <div className="select-static">No model needed</div>
          )}
          <span className="card-note">
            {!agent.usesModel
              ? 'This agent only calls connections.'
              : agent.model?.override
                ? 'Override for this agent.'
                : agent.model
                  ? 'Uses the workspace default. Pick a model to override it.'
                  : 'Add a model under Connections.'}
          </span>
        </section>

        <section className="card">
          <span className="card-label">Config</span>
          {agent.config.slice(0, 4).map((f) => (
            <div key={f.key} className="config-row">
              <span className="config-key">{f.label}</span>
              <span className="config-value">{configValueLabel(f)}</span>
            </div>
          ))}
          {agent.config.length > 4 && <span className="card-note">{agent.config.length - 4} more</span>}
          {agent.usesModel && agent.instructions && (
            <span className="card-note truncate" title={agent.instructions}>
              Instructions: {agent.instructions}
            </span>
          )}
          <div className="card-links">
            <button type="button" className="card-link" onClick={() => setEditing('config')}>
              Edit settings
            </button>
            {agent.usesModel && (
              <button type="button" className="card-link" onClick={() => setEditing('instructions')}>
                {agent.instructions ? 'Edit instructions' : 'Add instructions'}
              </button>
            )}
          </div>
        </section>
      </div>

      <div className="agent-panels">
        <section className="panel">
          <div className="panel-head">
            <h2>What it needs</h2>
            <span className="panel-hint">Agents ask for an action. You choose which connection does it.</span>
          </div>
          <div className="row row-head caps-grid">
            <span>Action</span>
            <span>Capability</span>
            <span>Need</span>
            <span>Connection</span>
            <span>Status</span>
          </div>
          <div className="rows">
            {agent.capabilities.map((c) => (
              <CapabilityRow key={c.key} agent={agent} cap={c} onBind={(value) => patch({ bindings: { [c.key]: value } })} />
            ))}
          </div>
        </section>

        <div className="activity-split">
          <RunsPanel runs={runs} now={now} />
          <div className="side-panels">
            <ToolCallsPanel calls={toolCalls} />
            {queue.length > 0 && <QueuePanel queue={queue} now={now} />}
          </div>
        </div>
      </div>

      <ScheduleDialog open={editing === 'schedule'} agent={agent} onClose={() => setEditing(null)} onSave={(schedule) => patch({ schedule }).then((r) => r && setEditing(null))} />
      <ConfigDialog open={editing === 'config'} agent={agent} onClose={() => setEditing(null)} onSave={(config) => patch({ config }).then((r) => r && setEditing(null))} />
      <InstructionsDialog open={editing === 'instructions'} agent={agent} onClose={() => setEditing(null)} onSave={(instructions) => patch({ instructions }).then((r) => r && setEditing(null))} />
    </main>
  );
}

function ErrorBanner({ agent, err, connections }) {
  const conn = err.connectionId ? connections.find((c) => c.id === err.connectionId) : null;
  const since = err.since ? formatTime(err.since) : null;
  const action = conn
    ? { label: `Reconnect ${conn.label} →`, href: '#/connections' }
    : err.code === 'missing_capability'
      ? { label: 'Add a connection →', href: '#/connections' }
      : null;
  return (
    <div className="alert" role="alert">
      <Dot color="var(--destructive)" size={8} className="alert-dot" />
      <div className="alert-body">
        <span className="alert-title">
          {agent.name} stopped{since ? ` at ${since}` : ''}: {err.message}
        </span>
        <span className="alert-text">
          {agent.queued > 0 ? `${plural(agent.queued, 'task')} held. ` : ''}
          {err.failures > 1 ? `${err.failures} runs in a row failed. ` : ''}
          {agent.name} picks up again on the next run once this is fixed.
        </span>
        {(err.op || err.status) && (
          <span className="alert-code">
            {[err.op, err.status && `→ ${err.status}`].filter(Boolean).join(' ')}
            {err.failures ? ` · ${plural(err.failures, 'consecutive failure')}` : ''}
          </span>
        )}
      </div>
      {action && (
        <a href={action.href} className="alert-action">
          {action.label}
        </a>
      )}
    </div>
  );
}

function CapabilityRow({ agent, cap, onBind }) {
  const { connections } = useApp();
  const eligible = connections.filter((c) => c.capabilities.includes(cap.key));
  const t = tagFor('connection', cap.status);
  const isModel = cap.key === 'llm.complete';
  const value = cap.source === 'agent' ? cap.connection?.id : cap.source === 'none' ? 'none' : '';
  const options = [
    { value: '', label: cap.source !== 'agent' && cap.connection ? `Auto · ${cap.connection.label}` : 'Auto' },
    ...eligible.map((c) => ({ value: c.id, label: c.account ? `${c.label} · ${c.account}` : c.label })),
    ...(cap.required ? [] : [{ value: 'none', label: 'Off for this agent' }]),
  ];

  return (
    <div className="row caps-grid caps-row">
      <span className="strong">{cap.label}</span>
      <span className="cap-key">{cap.key}</span>
      <span className="muted">{cap.required ? 'Required' : 'Optional'}</span>
      {isModel ? (
        <span className="truncate">
          {cap.connection ? (
            <>
              {cap.connection.providerName} <span className="muted">{agent.model?.model}</span>
            </>
          ) : (
            <a href="#/connections" className="muted">
              Add a model
            </a>
          )}
        </span>
      ) : eligible.length === 0 ? (
        <a href="#/connections" className="muted truncate">
          No connection can do this yet
        </a>
      ) : (
        <Select className="select-compact" value={value ?? ''} onChange={(v) => onBind(v === '' ? null : v)} options={options} aria-label={`Connection for ${cap.label}`} />
      )}
      <span className="status-cell">
        <Tag color={t.color}>{t.label}</Tag>
      </span>
    </div>
  );
}

function RunsPanel({ runs, now }) {
  const seen = useRef(null);
  const first = seen.current === null;
  if (first) seen.current = new Set(runs.map((r) => r.id));
  const fresh = (r) => !first && !seen.current.has(r.id);
  useEffect(() => {
    for (const r of runs) seen.current.add(r.id);
  });

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Recent runs</h2>
      </div>
      {runs.length === 0 ? (
        <EmptyState compact title="No runs yet">
          Runs show up here with their duration, tokens and cost.
        </EmptyState>
      ) : (
        <>
          <div className="row row-head runs-grid">
            <span>Run</span>
            <span>Started</span>
            <span>Status</span>
            <span className="num">Duration</span>
            <span className="num">Tokens in/out</span>
            <span className="num">Cost</span>
            <span>Result</span>
          </div>
          <div className="rows">
            {runs.map((r) => {
              const live = r.status === 'running';
              const tone = live ? 'var(--success)' : r.status === 'ok' ? 'var(--success)' : 'var(--destructive)';
              return (
                <div key={r.id} className={fresh(r) ? 'row runs-grid mono-row row-enter' : 'row runs-grid mono-row'}>
                  <span className="muted truncate">{r.id}</span>
                  <span>{formatShort(r.startedAt, new Date(now))}</span>
                  <span className="status-cell sans">
                    <Dot color={tone} pulse={live} />
                    {live ? 'Running' : r.status === 'ok' ? 'OK' : 'Error'}
                  </span>
                  <span className="num">{live ? '…' : formatDuration(r.durationMs)}</span>
                  <span className="num">{r.tokensIn || r.tokensOut ? `${formatNumber(r.tokensIn)} / ${formatNumber(r.tokensOut)}` : '—'}</span>
                  <span className="num">{formatCost(r.costUsd)}</span>
                  <span className={r.status === 'error' ? 'run-result error-text' : 'run-result muted'} title={r.summary}>
                    {live ? 'In progress' : r.summary || '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function ToolCallsPanel({ calls }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Recent tool calls</h2>
      </div>
      {calls.length === 0 ? (
        <EmptyState compact title="No tool calls yet">
          Every call to a connection is listed with its status and latency.
        </EmptyState>
      ) : (
        <div className="rows">
          {calls.map((t) => {
            const bad = typeof t.status !== 'number' || t.status >= 400;
            return (
              <div key={t.id} className="row tools-grid mono-row">
                <span className="muted">{formatClock(t.at)}</span>
                <span className="truncate" title={t.op}>
                  {t.op}
                </span>
                <span className={bad ? 'http-code error-text' : 'http-code'}>{typeof t.status === 'number' ? t.status : 'ERR'}</span>
                <span className="num muted">{t.ms}ms</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function QueuePanel({ queue, now }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Queue</h2>
        <span className="panel-hint">{plural(queue.length, 'task')} waiting</span>
      </div>
      <div className="rows">
        {queue.map((t) => (
          <div key={t.id} className="row queue-grid mono-row">
            <span className="truncate">{t.type}</span>
            <span className="muted num">{t.availableAt && Date.parse(t.availableAt) > now ? formatIn(t.availableAt, now) : 'ready'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ScheduleDialog({ open, agent, onClose, onSave }) {
  const current = agent.schedule.type === 'event' ? 'event' : agent.schedule.cron;
  const known = SCHEDULE_PRESETS.some((p) => p.value === current);
  const [choice, setChoice] = useState(known ? current : 'custom');
  const [cron, setCron] = useState(agent.schedule.cron ?? '*/30 * * * *');
  useEffect(() => {
    if (open) {
      setChoice(known ? current : 'custom');
      setCron(agent.schedule.cron ?? '*/30 * * * *');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = choice === 'custom' ? { type: 'cron', cron } : choice === 'event' ? { type: 'event' } : { type: 'cron', cron: choice };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${agent.name} schedule`}
      description="Event-driven agents run as soon as work is queued for them."
      footer={
        <>
          {agent.schedule.overridden && (
            <Button variant="ghost" onClick={() => onSave(null)} style={{ marginRight: 'auto' }}>
              Reset to default
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(value)}>Save schedule</Button>
        </>
      }
    >
      <Field label="Runs">
        <Select value={choice} onChange={setChoice} options={SCHEDULE_PRESETS} />
      </Field>
      {choice === 'custom' && (
        <Field label="Cron expression" help="Five fields: minute, hour, day of month, month, day of week. Uses this machine’s time zone.">
          <Input className="mono" value={cron} onChange={(e) => setCron(e.target.value)} placeholder="*/30 * * * *" />
        </Field>
      )}
    </Dialog>
  );
}

function ConfigDialog({ open, agent, onClose, onSave }) {
  const initial = useMemo(() => Object.fromEntries(agent.config.map((f) => [f.key, f.value])), [agent.config]);
  const [values, setValues] = useState(initial);
  useEffect(() => {
    if (open) setValues(initial);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key, v) => setValues((s) => ({ ...s, [key]: v }));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${agent.name} settings`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={SlidersHorizontal} onClick={() => onSave(values)}>
            Save settings
          </Button>
        </>
      }
    >
      {agent.config.map((f) => (
        <Field key={f.key} label={f.label} help={f.help}>
          {f.type === 'boolean' ? (
            <Switch checked={!!values[f.key]} onChange={(v) => set(f.key, v)} label={values[f.key] ? 'Yes' : 'No'} />
          ) : f.type === 'select' ? (
            <Select value={values[f.key]} onChange={(v) => set(f.key, v)} options={f.options} />
          ) : f.type === 'textarea' ? (
            <Textarea value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
          ) : (
            <div className="input-affix">
              {f.prefix && <span className="affix">{f.prefix}</span>}
              <Input
                type={f.type === 'number' ? 'number' : 'text'}
                min={f.min}
                max={f.max}
                step={f.step ?? (f.type === 'number' ? 'any' : undefined)}
                value={values[f.key] ?? ''}
                onChange={(e) => set(f.key, f.type === 'number' ? e.target.value : e.target.value)}
              />
              {f.suffix && <span className="affix">{f.suffix.replace(/^[:]/, '')}</span>}
            </div>
          )}
        </Field>
      ))}
    </Dialog>
  );
}

function InstructionsDialog({ open, agent, onClose, onSave }) {
  const [text, setText] = useState(agent.instructions ?? '');
  useEffect(() => {
    if (open) setText(agent.instructions ?? '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${agent.name} instructions`}
      description={`Added to every prompt ${agent.name} sends to its model. Use it for tone, things to avoid, or facts about your business.`}
      width={600}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(text)}>Save instructions</Button>
        </>
      }
    >
      <Textarea
        rows={8}
        value={text}
        maxLength={4000}
        onChange={(e) => setText(e.target.value)}
        placeholder={agent.id === 'personalizer' ? 'Never mention competitors by name. Lead with the customer’s situation, not our product.' : 'Write in plain English. Cite a source for every claim.'}
      />
      <span className="muted small">{text.length.toLocaleString('en-US')} / 4,000</span>
    </Dialog>
  );
}
