import { useEffect, useState } from 'react';
import { ChevronRight, Inbox, Pause, Play, Settings2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app-context.jsx';
import { useNow, useResource } from '../lib/live.js';
import { agentDot } from '../lib/tags.js';
import { formatAgoLong, formatDate, formatTime, plural } from '../lib/format.js';
import { useAction } from '../components/feedback.jsx';
import { ActivityList } from '../components/ActivityFeed.jsx';
import { Banner, Bars, Button, Dot, EmptyState, Mono, Segmented, Skeleton, StatusPill } from '../components/ui.jsx';
import { SalesSide } from './control-room/SalesSide.jsx';
import { MarketsSide } from './control-room/MarketsSide.jsx';
import './control-room.css';

const STATUS_LABEL = { running: 'Running', idle: 'Idle', error: 'Error', off: 'Off', paused: 'Paused' };

export default function ControlRoom() {
  const app = useApp();
  const ws = app.workspace;
  const now = useNow(30_000);
  const agentsRes = useResource('/api/agents', ['agents', 'tasks']);
  const agents = agentsRes.data?.agents ?? [];
  const approvals = useResource('/api/approvals?status=pending', ['approvals']);
  const [pause, pausing] = useAction(() => api.post(ws.paused ? '/api/workspace/resume' : '/api/workspace/pause'), {
    success: () => (ws.paused ? 'Team resumed.' : 'Team paused. Nothing runs until you resume.'),
  });

  const broken = app.connections.filter((c) => c.status === 'expired' || c.status === 'error');
  const autonomy = app.playbook.autonomy.find((a) => a.id === ws.autonomy);
  const pending = approvals.data?.approvals ?? [];
  const enabledCount = agents.filter((a) => a.enabled).length;

  return (
    <div className="page control-room">
      {broken.map((c) => {
        const held = agents.filter((a) => a.status === 'error' && a.lastError?.connectionId === c.id);
        return (
          <Banner key={c.id} tone="error" action={<a href="#/connections">Reconnect {c.label}</a>}>
            <b>
              {c.label}
              {c.account ? ` · ${c.account}` : ''} {c.status === 'expired' ? 'expired' : 'is failing'}
              {c.lastCheckedAt ? ` ${formatAgoLong(c.lastCheckedAt, now)} ago` : ''}.
            </b>{' '}
            {held.length ? `${held.map((a) => a.name).join(' and ')} ${held.length === 1 ? 'is' : 'are'} on hold until you reconnect.` : c.lastError?.message}
          </Banner>
        );
      })}
      {ws.paused && (
        <Banner tone="warning">
          <b>
            Team paused{ws.owner?.name ? ` by ${ws.owner.name}` : ''} at {formatTime(ws.pausedAt)}.
          </b>{' '}
          {plural(agents.reduce((n, a) => n + a.queued, 0), 'queued task')} on hold. Nothing runs while the team is paused.
        </Banner>
      )}

      <header className="page-header">
        <div className="page-header-text">
          <h1>
            {ws.name}
            <StatusPill color={ws.paused ? 'var(--warning)' : 'var(--success)'} pulse={!ws.paused}>
              {ws.paused ? 'Paused' : 'Active'}
            </StatusPill>
          </h1>
          <div className="cr-meta">
            <span>
              {app.playbook.name} · {plural(enabledCount, 'agent')} on
            </span>
            <span>·</span>
            <span>
              Approvals: <b>{autonomy?.label}</b>
            </span>
            <span>·</span>
            <span>Started {formatDate(ws.createdAt)}</span>
            <span>·</span>
            <Clock />
          </div>
        </div>
        <Button variant="outline" icon={Settings2} onClick={() => (window.location.hash = '#/settings')}>
          Team settings
        </Button>
        <Button icon={ws.paused ? Play : Pause} onClick={() => pause()} loading={pausing}>
          {ws.paused ? 'Resume team' : 'Pause team'}
        </Button>
      </header>

      <div className="page-body">
        {pending.length > 0 && <ApprovalsBar items={pending} now={now} />}
        <StatsStrip />
        <Pipeline agents={agents} loading={!agentsRes.data} paused={ws.paused} now={now} />
        <div className="cr-split">
          <ActivityPanel agents={agents} paused={ws.paused} />
          <div className="cr-side">{app.playbook.id === 'sales' ? <SalesSide approvals={pending} now={now} /> : <MarketsSide approvals={pending} now={now} />}</div>
        </div>
      </div>
    </div>
  );
}

function Clock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  const label = t.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return <span className="mono cr-clock">{label}</span>;
}

function ApprovalsBar({ items, now }) {
  const kinds = {};
  for (const a of items) kinds[a.kind] = (kinds[a.kind] ?? 0) + 1;
  const names = { first_touch: 'first touch', follow_up: 'follow-up', reply: 'reply', meeting: 'meeting invite', trade: 'trade' };
  const parts = Object.entries(kinds).map(([k, n]) => {
    const name = names[k] ?? k;
    return `${n} ${n === 1 ? name : name === 'reply' ? 'replies' : `${name}s`}`;
  });
  const oldest = items[0]?.createdAt;
  const noun = items.every((a) => a.kind === 'trade') ? (items.length === 1 ? 'trade' : 'trades') : items.length === 1 ? 'item' : 'items';
  return (
    <a href="#/approvals" className="cr-approvals">
      <Inbox size={18} />
      <span className="cr-approvals-text">
        <b>
          {items.length} {noun} waiting for review
        </b>
        <span className="cr-approvals-meta">
          {' '}
          · {parts.join(', ')}
          {oldest ? ` · oldest ${formatAgoLong(oldest, now)}` : ''}
        </span>
      </span>
      <span className="cr-approvals-cta">Review →</span>
    </a>
  );
}

function StatsStrip() {
  const { data } = useResource('/api/stats', ['accounts', 'contacts', 'approvals', 'threads', 'meetings', 'markets', 'positions', 'equity', 'signals']);
  const stats = data?.stats;
  return (
    <section className="cr-section">
      <div className="cr-section-head">
        <h2>Today</h2>
        <span className="muted small">Since midnight · bars show the last 7 days</span>
      </div>
      <div className="cr-stats" style={{ gridTemplateColumns: `repeat(${stats?.length || 8}, minmax(0, 1fr))` }}>
        {(stats ?? Array.from({ length: 8 }, () => null)).map((s, i) => (
          <div key={s?.key ?? i} className="cr-stat">
            {s ? (
              <>
                <span className="cr-stat-label">{s.label}</span>
                <div className="cr-stat-row">
                  <span className={String(s.value).length > 7 ? 'cr-stat-value cr-stat-value-long' : 'cr-stat-value'}>{s.value}</span>
                  <Bars values={s.bars ?? []} />
                </div>
                <span className="cr-stat-delta">{s.delta}</span>
              </>
            ) : (
              <>
                <Skeleton width="70%" height={12} />
                <Skeleton width="40%" height={24} />
                <Skeleton width="55%" height={10} />
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Pipeline({ agents, loading, paused, now }) {
  return (
    <section className="cr-section">
      <div className="cr-section-head">
        <h2>Pipeline</h2>
        <span className="muted small">Work moves left to right. Each agent hands off to the next.</span>
        <a href="#/agents" className="panel-link cr-section-link">
          All agents →
        </a>
      </div>
      <div className="cr-pipeline">
        {(loading ? Array.from({ length: 5 }, (_, i) => ({ id: i, loading: true })) : agents).map((a, i, all) => (
          <div key={a.id} className="cr-pipe-cell" style={{ animationDelay: `${i * 40}ms` }}>
            {a.loading ? (
              <div className="cr-agent">
                <Skeleton width="60%" />
                <Skeleton width="40%" height={10} />
                <Skeleton width="90%" height={10} />
              </div>
            ) : (
              <AgentCard agent={a} paused={paused} now={now} />
            )}
            {i < all.length - 1 && (
              <span className="cr-arrow" aria-hidden="true">
                <ChevronRight size={14} />
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function AgentCard({ agent, paused, now }) {
  const status = agent.running ? 'running' : agent.status;
  const isError = status === 'error';
  const nowText = !agent.enabled
    ? 'Turned off'
    : isError
      ? agent.lastError?.message ?? 'Stopped'
      : paused
        ? 'On hold'
        : agent.running
          ? agent.now || 'Working'
          : agent.queued
            ? `${plural(agent.queued, 'task')} waiting`
            : agent.schedule.type === 'cron' && agent.nextRunAt
              ? `Next run ${formatTime(agent.nextRunAt)}`
              : 'Waiting for work';
  return (
    <a href={`#/agents/${agent.id}`} className={isError ? 'cr-agent cr-agent-error' : agent.running ? 'cr-agent cr-agent-live' : 'cr-agent'}>
      <div className="cr-agent-head">
        <Mono>{agent.mono}</Mono>
        <span className="cr-agent-name">{agent.name}</span>
      </div>
      <div className="cr-agent-status">
        <Dot color={agentDot(status)} pulse={status === 'running'} />
        {STATUS_LABEL[status]}
        <span className="cr-agent-queued">{agent.queued} queued</span>
      </div>
      <div className={isError ? 'cr-agent-now error-text' : 'cr-agent-now'}>{nowText}</div>
      <div className="cr-agent-last">last run {agent.lastRunAt ? formatTime(agent.lastRunAt) : '—'}</div>
    </a>
  );
}

function ActivityPanel({ agents, paused }) {
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(30);
  const { data } = useResource(`/api/activity?filter=${filter}&limit=${limit}`, ['activity']);
  const items = data?.activity ?? [];
  const first = agents.find((a) => a.enabled);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Activity</h2>
        <span className="cr-live">
          <Dot color={paused ? 'var(--warning)' : 'var(--success)'} pulse={!paused} />
          {paused ? 'Paused' : 'Live'}
        </span>
        <div className="panel-actions">
          <Segmented
            label="Filter activity"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'outbound', label: 'Outbound' },
              { value: 'errors', label: 'Errors' },
            ]}
          />
        </div>
      </div>
      {!data ? (
        <div className="skeleton-rows">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} height={16} width={`${90 - i * 7}%`} />
          ))}
        </div>
      ) : items.length === 0 ? (
        filter === 'all' ? (
          <EmptyState title="No activity yet" actions={first && <RunFirst agent={first} />}>
            {first ? `${first.name} ${first.schedule.type === 'cron' ? `runs ${first.schedule.label.toLowerCase()}` : 'runs when work arrives'}. You can run it now and watch the first results come in.` : 'Turn on an agent to get started.'}
          </EmptyState>
        ) : (
          <EmptyState compact title={filter === 'errors' ? 'No errors' : 'Nothing sent yet'} />
        )
      ) : (
        <>
          <ActivityList items={items} agents={agents} />
          {data.hasMore && (
            <div className="cr-more">
              <button type="button" className="panel-link" onClick={() => setLimit((l) => l + 30)}>
                Show more
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function RunFirst({ agent }) {
  const [run, busy] = useAction(() => api.post(`/api/agents/${agent.id}/run`), { success: `${agent.name} started.` });
  return (
    <Button variant="outline" onClick={() => run()} loading={busy}>
      Run {agent.name} now
    </Button>
  );
}
