import { useMemo, useState } from 'react';
import { EyeOff, Eye, RefreshCw } from 'lucide-react';
import { api } from '../lib/api.js';
import { useNow, useResource } from '../lib/live.js';
import { formatAgoLong, formatDate, formatDateTime, formatShort, plural } from '../lib/format.js';
import { useAction } from '../components/feedback.jsx';
import { Button, EmptyState, ErrorState, Mono, Segmented, Skeleton, SkeletonRows, Tag } from '../components/ui.jsx';
import { LineChart } from '../components/LineChart.jsx';
import {
  ClosePositionDialog,
  Edge,
  Factors,
  Fade,
  PnL,
  SideTag,
  WhaleLine,
  agentById,
  cents,
  centsChange,
  change24h,
  closesLabel,
  compactMoney,
  minEdgeFrom,
  prob,
  pts,
  shares as formatShares,
  stakeMoney,
  useAppear,
} from './markets-shared.jsx';
import './market-detail.css';

const SIGNAL_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'whale', label: 'Large trades' },
  { value: 'news', label: 'News' },
  { value: 'brief', label: 'Briefs' },
];

const CLOSE_REASON = { resolved: 'Resolved', take_profit: 'Take profit', stop_loss: 'Stop loss', manual: 'Closed by you' };

export default function MarketDetail({ id }) {
  const now = useNow(30_000);
  const res = useResource(`/api/markets/${id}`, ['markets', 'signals', 'positions', 'approvals']);
  const agentsRes = useResource('/api/agents', ['agents']);
  const tasksRes = useResource('/api/tasks?agentId=analyst', ['tasks']);
  const agents = agentsRes.data?.agents ?? [];
  const byAgent = agentById(agents);
  const minEdge = minEdgeFrom(agents);

  const market = res.data?.market;
  const analysisTask = (tasksRes.data?.tasks ?? []).find((t) => t.payload?.marketId === id && (t.status === 'queued' || t.status === 'running'));

  const [analyze, analyzing] = useAction(() => api.post(`/api/markets/${id}/analyze`), {
    success: 'Analyst queued. The brief updates here when it finishes.',
    onDone: () => tasksRes.refresh(),
  });
  const [ignore, ignoring] = useAction(() => api.post(`/api/markets/${id}/ignore`), {
    success: 'Ignored. The agents stop tracking this market.',
    onDone: () => res.refresh(),
  });
  const [watch, watching] = useAction(() => api.post(`/api/markets/${id}/watch`), {
    success: 'Watching again.',
    onDone: () => res.refresh(),
  });

  if (res.error && !res.data) {
    return (
      <div className="page">
        <Crumbs />
        {res.error.status === 404 ? (
          <EmptyState title="This market isn’t tracked" actions={<Button variant="outline" onClick={() => (window.location.hash = '#/markets')}>Back to markets</Button>}>
            It may have been removed when the workspace was reset.
          </EmptyState>
        ) : (
          <ErrorState error={res.error} onRetry={res.refresh} />
        )}
      </div>
    );
  }

  if (!market) return <DetailSkeleton />;

  const m = market;
  const ended = m.status === 'closed' || m.status === 'resolved';
  const finder = byAgent[m.foundBy]?.name ?? (m.foundBy === 'user' ? 'you' : m.foundBy);
  const analysisLabel = analysisTask ? (analysisTask.status === 'running' ? 'Analyzing' : 'Analysis queued') : 'Analyze now';

  return (
    <div className="page market-detail">
      <header className="md-header">
        <Crumbs question={m.question} />
        <div className="md-title-row">
          <div className="md-title-text">
            <h1>{m.question}</h1>
            <div className="md-meta">
              {m.status === 'resolved' && m.outcome ? (
                <Tag kind="side" value={m.outcome}>{`Resolved ${m.outcome.toUpperCase()}`}</Tag>
              ) : (
                <Tag kind="market" value={m.status} />
              )}
              {m.category && <Tag>{m.category}</Tag>}
              {m.url && (
                <a href={m.url} target="_blank" rel="noreferrer" className="md-ext">
                  Polymarket ↗
                </a>
              )}
              {(m.createdAt || m.watchedAt) && (
                <span>
                  {finder ? `Found by ${finder}` : 'Added'} {formatDateTime(m.createdAt ?? m.watchedAt)}
                </span>
              )}
              {m.slug && <span className="mono md-slug">{m.slug}</span>}
            </div>
          </div>
          <div className="md-actions">
            {m.status === 'ignored' ? (
              <Button variant="ghost" icon={Eye} onClick={() => watch()} loading={watching}>
                Watch again
              </Button>
            ) : (
              m.status === 'watching' && (
                <Button variant="ghost" icon={EyeOff} onClick={() => ignore()} loading={ignoring}>
                  Ignore
                </Button>
              )
            )}
            <Button
              variant={m.url ? 'outline' : 'primary'}
              icon={RefreshCw}
              onClick={() => analyze()}
              loading={analyzing || !!analysisTask}
              disabled={ended}
              title={ended ? 'Trading has ended on this market.' : undefined}
            >
              {analysisLabel}
            </Button>
            {m.url && (
              <a className="btn btn-primary" href={m.url} target="_blank" rel="noreferrer">
                Open on Polymarket ↗
              </a>
            )}
          </div>
        </div>
        <Facts market={m} minEdge={minEdge} now={now} />
      </header>

      <div className="md-body">
        <div className="md-main">
          <PricePanel market={m} />
          <BriefPanel market={m} agent={byAgent.analyst} onAnalyze={() => analyze()} busy={analyzing || !!analysisTask} ended={ended} />
          <SignalsPanel signals={res.data.signals ?? []} now={now} />
        </div>
        <div className="md-side">
          <PositionPanel market={m} positions={res.data.positions ?? []} minEdge={minEdge} now={now} />
          <ProposalsPanel approvals={res.data.approvals ?? []} now={now} />
          <DetailsPanel market={m} finder={finder} now={now} />
        </div>
      </div>
    </div>
  );
}

function Crumbs({ question }) {
  return (
    <div className="crumbs md-crumbs">
      <a href="#/markets">Markets</a>
      {question && (
        <>
          <span>/</span>
          <span className="md-crumb-current">{question}</span>
        </>
      )}
    </div>
  );
}

function Facts({ market: m, minEdge, now }) {
  const change = change24h(m, now);
  const ended = m.status === 'closed' || m.status === 'resolved';
  const edge = ended ? null : m.edge;
  const favors = ended ? 'trading has ended' : edge == null ? null : Math.abs(edge) < minEdge ? `under the ${minEdge} pt bar` : edge > 0 ? 'YES looks cheap' : 'NO looks cheap';
  const facts = [
    { k: 'Price', v: <Fade>{cents(m.yesPrice)}</Fade>, s: change == null ? 'YES' : `YES · ${centsChange(change)} 24h` },
    { k: 'Estimate', v: m.estimate == null ? '—' : <Fade>{prob(m.estimate)}</Fade>, s: m.lastAnalyzedAt ? `Analyst · ${formatAgoLong(m.lastAnalyzedAt, now)} ago` : 'Not analyzed yet' },
    { k: 'Edge', v: <Edge value={edge} min={minEdge} />, s: favors ?? '—' },
    { k: 'Confidence', v: m.confidence == null ? '—' : <Fade>{prob(m.confidence)}</Fade>, s: m.confidence == null ? '—' : m.confidence >= 0.65 ? 'fairly high' : m.confidence >= 0.5 ? 'moderate' : 'low' },
    { k: 'Volume 24h', v: <Fade>{compactMoney(m.volume24h)}</Fade>, s: 'traded on Polymarket' },
    { k: 'Liquidity', v: <Fade>{compactMoney(m.liquidity)}</Fade>, s: 'in the order book' },
    { k: 'Closes', v: m.status === 'resolved' ? 'Resolved' : m.status === 'closed' ? 'Closed' : closesLabel(m.endDate, now), s: m.endDate ? formatDate(m.endDate) : '—' },
  ];
  return (
    <div className="md-facts">
      {facts.map((f) => (
        <div key={f.k} className="md-fact">
          <span className="md-fact-k">{f.k}</span>
          <span className="md-fact-v">{f.v}</span>
          <span className="md-fact-s">{f.s}</span>
        </div>
      ))}
    </div>
  );
}

function PricePanel({ market: m }) {
  const points = useMemo(() => (m.priceHistory ?? []).map((p) => ({ at: p.at, value: p.p })), [m.priceHistory]);
  const first = m.priceHistory?.[0]?.at;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Price</h2>
        <span className="panel-hint">{first ? `YES price since ${formatDateTime(first)}` : 'YES price'}</span>
        <div className="md-legend">
          <span className="md-legend-item">
            <span className="md-swatch" />
            YES price
          </span>
          {m.estimate != null && (
            <span className="md-legend-item">
              <span className="md-swatch md-swatch-dashed" />
              Analyst estimate
            </span>
          )}
        </div>
      </div>
      <div className="md-chart">
        <LineChart
          points={points}
          height={240}
          formatValue={(v) => cents(v)}
          minSpan={0.1}
          clamp={[0, 1]}
          reference={m.estimate}
          referenceLabel={m.estimate != null ? `Analyst ${prob(m.estimate)}` : undefined}
          emptyText="Scanner records the price each time it checks this market. The chart fills in after a few checks."
          label="YES price over time"
        />
      </div>
    </section>
  );
}

function BriefPanel({ market: m, agent, onAnalyze, busy, ended }) {
  const b = m.brief;
  if (!b) {
    return (
      <section className="panel">
        <div className="panel-head">
          <Mono size="sm">{agent?.mono ?? 'An'}</Mono>
          <h2>Analyst brief</h2>
        </div>
        <EmptyState
          compact
          title="No brief yet"
          actions={
            !ended && (
              <Button variant="outline" size="sm" onClick={onAnalyze} loading={busy}>
                {busy ? 'Analysis queued' : 'Analyze now'}
              </Button>
            )
          }
        >
          The Analyst reads the news, weighs the base rate and estimates the odds. It picks up new markets on its own, or you can ask for it now.
        </EmptyState>
      </section>
    );
  }
  const verdictText =
    b.verdict === 'pass'
      ? 'Pass. The price looks about right.'
      : `Leans ${b.verdict === 'no' ? 'NO' : 'YES'}. Estimate ${prob(m.estimate)} vs market ${cents(m.yesPrice)}${m.edge != null ? ` · edge ${pts(m.edge)}` : ''}${m.confidence != null ? ` · confidence ${prob(m.confidence)}` : ''}.`;
  return (
    <section className="panel md-brief">
      <div className="panel-head">
        <Mono size="sm">{agent?.mono ?? 'An'}</Mono>
        <h2>Analyst brief</h2>
        <span className="md-brief-meta">{[agent?.name ?? 'Analyst', b.model, b.at && formatDateTime(b.at)].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="panel-body md-brief-body" key={b.at}>
        <div className="md-verdict">
          {b.verdict === 'pass' ? <Tag>Pass</Tag> : <SideTag side={b.verdict}>{b.verdict === 'no' ? 'NO' : 'YES'}</SideTag>}
          <span>{verdictText}</span>
        </div>
        {b.summary && <p className="md-summary">{b.summary}</p>}
        {b.factors?.length > 0 && (
          <div className="md-factors">
            <span className="md-label">What moves it</span>
            <Factors factors={b.factors} />
          </div>
        )}
        {b.sources?.length > 0 && (
          <div className="md-sources">
            <span className="md-label">Sources</span>
            {b.sources.map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noreferrer" title={s.url}>
                {s.title || hostOf(s.url)} ↗
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function SignalsPanel({ signals, now }) {
  const [filter, setFilter] = useState('all');
  const counts = useMemo(() => {
    const c = { all: signals.length, whale: 0, news: 0, brief: 0 };
    for (const s of signals) if (c[s.kind] != null) c[s.kind] += 1;
    return c;
  }, [signals]);
  const rows = filter === 'all' ? signals : signals.filter((s) => s.kind === filter);
  const appear = useAppear(signals);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Signals</h2>
        <span className="panel-hint">Large trades, news and briefs on this market, newest first</span>
        <div className="panel-actions">
          <Segmented label="Filter signals" value={filter} onChange={setFilter} options={SIGNAL_FILTERS.map((o) => ({ ...o, count: counts[o.value] || undefined }))} />
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState compact title={filter === 'all' ? 'No signals yet' : 'Nothing here yet'}>
          {filter === 'news'
            ? 'The Analyst adds the news it read each time it writes a brief.'
            : filter === 'brief'
              ? 'Each brief the Analyst writes is listed here with its estimate.'
              : 'Whales checks this market for large trades. The Analyst adds briefs and news as it works.'}
        </EmptyState>
      ) : (
        <div className="md-signals" key={filter}>
          {rows.map((s) => {
            const a = appear(s.id);
            return <SignalRow key={s.id} signal={s} now={now} className={a.className} style={a.style} />;
          })}
        </div>
      )}
    </section>
  );
}

function SignalRow({ signal: s, now, className, style }) {
  return (
    <div className={`md-signal ${className}`} style={style}>
      <span className="md-signal-time" title={formatDateTime(s.at)}>
        {formatShort(s.at, new Date(now))}
      </span>
      <span>
        <Tag kind="signal" value={s.kind} />
      </span>
      <div className="md-signal-body">
        {s.kind === 'whale' ? (
          <WhaleLine signal={s} />
        ) : (
          <>
            <span className="md-signal-title">{s.title}</span>
            {s.body && <span className="md-signal-sub">{s.body}</span>}
          </>
        )}
      </div>
      {s.url ? (
        <a href={s.url} target="_blank" rel="noreferrer" className="md-signal-link" title={s.url}>
          {s.kind === 'whale' ? 'Transaction ↗' : `${hostOf(s.url)} ↗`}
        </a>
      ) : (
        <span />
      )}
    </div>
  );
}

function PositionPanel({ market: m, positions, minEdge, now }) {
  const [closing, setClosing] = useState(null);
  const [requested, setRequested] = useState(null);
  const open = positions.find((p) => p.status === 'open');
  const closed = positions.filter((p) => p.status === 'closed');
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Position</h2>
        <a href="#/positions" className="panel-link panel-actions">
          All positions →
        </a>
      </div>
      {!open && closed.length === 0 ? (
        <div className="md-side-empty">
          No position on this market. Trader proposes one when the edge clears {minEdge} pts and the Analyst is confident enough.
        </div>
      ) : (
        <>
          {open && (
            <div className="md-pos" key={open.id}>
              <div className="md-pos-head">
                <SideTag side={open.side} size="lg">
                  {open.side === 'no' ? 'NO' : 'YES'}
                </SideTag>
                <span className="md-pos-line">
                  {formatShares(open.shares)} shares at {cents(open.entryPrice)}
                </span>
                <PnL value={open.pnl} pct={open.pnlPct} className="md-pos-pnl" />
              </div>
              <div className="kv">
                <span>Stake</span>
                <span className="mono">{stakeMoney(open.stake)}</span>
                <span>Value now</span>
                <span className="mono">
                  <Fade>{stakeMoney(open.value)}</Fade>
                </span>
                <span>Mark</span>
                <span className="mono">
                  <Fade>{cents(open.markPrice)}</Fade>
                </span>
                <span>Pays if right</span>
                <span className="mono">{stakeMoney(open.shares)}</span>
                <span>Opened</span>
                <span>{formatDateTime(open.openedAt)}</span>
              </div>
              {requested === open.id ? (
                <span className="md-side-note">Bookkeeper is closing this at the market price.</span>
              ) : m.status === 'watching' || m.status === 'ignored' ? (
                <Button variant="outline" size="sm" onClick={() => setClosing(open)}>
                  Close position
                </Button>
              ) : (
                <span className="md-side-note">Trading has ended. Bookkeeper settles this when the market resolves.</span>
              )}
            </div>
          )}
          {closed.length > 0 && (
            <div className="md-closed">
              <span className="md-label">Closed on this market</span>
              {closed.map((p) => (
                <div key={p.id} className="md-closed-row">
                  <SideTag side={p.side}>{p.side === 'no' ? 'NO' : 'YES'}</SideTag>
                  <span className="md-closed-text">
                    {cents(p.entryPrice)} → {cents(p.exitPrice)} · {CLOSE_REASON[p.closeReason] ?? 'Closed'}
                  </span>
                  <PnL value={p.realizedPnl ?? p.pnl} showPct={false} className="mono md-closed-pnl" />
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <div className="md-paper">Paper trades. No real money moves.</div>
      <ClosePositionDialog position={closing} question={m.question} onClose={() => setClosing(null)} onClosed={setRequested} />
    </section>
  );
}

function ProposalsPanel({ approvals, now }) {
  if (!approvals.length) return null;
  const pending = approvals.filter((a) => a.status === 'pending');
  const rest = approvals.filter((a) => a.status !== 'pending').slice(0, 4);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Trade proposals</h2>
        {pending.length > 0 && <span className="panel-hint">{plural(pending.length, 'waiting on you', 'waiting on you')}</span>}
      </div>
      <div className="md-proposals">
        {[...pending, ...rest].map((a) => {
          const t = a.trade ?? {};
          const status = a.status === 'pending' ? null : a.status === 'sent' ? ['green', 'Placed'] : a.status === 'rejected' ? ['gray', 'Rejected'] : a.status === 'failed' ? ['red', 'Failed'] : ['blue', 'Approved'];
          return (
            <a key={a.id} href={`#/approvals/${a.id}`} className={a.status === 'pending' ? 'md-proposal md-proposal-pending' : 'md-proposal'}>
              <div className="md-proposal-top">
                <SideTag side={t.side}>{t.side === 'no' ? 'NO' : 'YES'}</SideTag>
                <span className="md-proposal-text">
                  {stakeMoney(t.stake)} at {cents(t.price)} · edge {pts(t.edge)}
                </span>
                <span className="md-proposal-age">{formatAgoLong(a.createdAt, now)}</span>
              </div>
              <div className="md-proposal-bottom">
                {status ? <Tag color={status[0]}>{status[1]}</Tag> : <span className="md-proposal-cta">Review →</span>}
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function DetailsPanel({ market: m, finder, now }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Details</h2>
      </div>
      <div className="panel-body">
        <div className="kv">
          <span>Category</span>
          <span>{m.category ?? '—'}</span>
          <span>Found by</span>
          <span>{finder ?? '—'}</span>
          <span>Watching since</span>
          <span>{m.watchedAt ? formatDateTime(m.watchedAt) : '—'}</span>
          <span>Last analyzed</span>
          <span>{m.lastAnalyzedAt ? `${formatAgoLong(m.lastAnalyzedAt, now)} ago` : 'Not yet'}</span>
          <span>End date</span>
          <span>{m.endDate ? formatDateTime(m.endDate) : '—'}</span>
          {m.status === 'resolved' && (
            <>
              <span>Outcome</span>
              <span>{m.outcome ? m.outcome.toUpperCase() : '—'}</span>
            </>
          )}
          <span>Market id</span>
          <span className="mono" title={m.externalId}>
            {m.externalId ?? m.id}
          </span>
        </div>
      </div>
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div className="page market-detail">
      <header className="md-header">
        <Crumbs />
        <div className="md-title-row">
          <div className="md-title-text">
            <Skeleton width="55%" height={26} />
            <Skeleton width="35%" height={14} />
          </div>
        </div>
        <div className="md-facts">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="md-fact">
              <Skeleton width="50%" height={10} />
              <Skeleton width="60%" height={18} />
              <Skeleton width="70%" height={10} />
            </div>
          ))}
        </div>
      </header>
      <div className="md-body">
        <div className="md-main">
          <section className="panel">
            <div className="md-chart">
              <Skeleton height={240} radius={6} />
            </div>
          </section>
          <section className="panel">
            <SkeletonRows rows={5} />
          </section>
        </div>
        <div className="md-side">
          <section className="panel">
            <SkeletonRows rows={4} />
          </section>
        </div>
      </div>
    </div>
  );
}
