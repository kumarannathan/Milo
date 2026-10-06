import { useEffect, useMemo, useRef, useState } from 'react';
import { CandlestickChart, Plus, Search, X } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useNow, useResource } from '../lib/live.js';
import { formatAgo, formatNumber, plural } from '../lib/format.js';
import { Dialog, useAction, useToast } from '../components/feedback.jsx';
import { Button, EmptyState, ErrorState, Field, Input, Kbd, Mono, Segmented, Skeleton, Tag, UnderlineTabs } from '../components/ui.jsx';
import { Sparkline } from '../components/LineChart.jsx';
import { Edge, Fade, agentById, cents, centsChange, change24h, closesLabel, compactMoney, minEdgeFrom, prob, stakeMoney, useAppear } from './markets-shared.jsx';
import './markets.css';

const TABS = [
  { value: 'watching', label: 'Watching' },
  { value: 'closed', label: 'Closed' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'ignored', label: 'Ignored' },
  { value: 'all', label: 'All' },
];

const SORTS = [
  { value: 'volume', label: 'Volume' },
  { value: 'edge', label: 'Edge' },
  { value: 'closing', label: 'Closing soon' },
];

const SORT_NOTE = { volume: 'Sorted by 24h volume', edge: 'Sorted by edge, largest first', closing: 'Sorted by close date, soonest first' };

const EMPTY_TAB = {
  watching: ['Not watching any markets', 'Scanner adds markets here as it finds them. Ignored markets stay on the Ignored tab.'],
  closed: ['No closed markets', 'Markets move here when trading ends and they are waiting to resolve.'],
  resolved: ['Nothing has resolved yet', 'Resolved markets and their outcomes show up here. Bookkeeper settles any position on them.'],
  ignored: ['No ignored markets', 'Ignore a market from its page and the agents stop tracking it.'],
  all: ['No markets yet', ''],
};

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function Markets() {
  const now = useNow(30_000);
  const [status, setStatus] = useState('watching');
  const [sort, setSort] = useState('volume');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const q = useDebounced(query.trim(), 200);
  const searchRef = useRef(null);

  const res = useResource(`/api/markets${qs({ status, q, sort })}`, ['markets', 'positions']);
  const agentsRes = useResource('/api/agents', ['agents']);
  const agents = agentsRes.data?.agents ?? [];
  const scanner = agents.find((a) => a.id === 'scanner');
  const byAgent = agentById(agents);
  const minEdge = minEdgeFrom(agents);

  const counts = res.data?.counts;
  const markets = res.data?.markets ?? null;

  // Keep showing the last loaded list (dimmed) until the new tab or search has loaded,
  // so rows from one tab never flash under another tab's name.
  const [shown, setShown] = useState(null);
  useEffect(() => {
    if (res.data && !res.loading) setShown({ status, sort, markets: res.data.markets });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res.data, res.loading]);
  const analyzedToday = counts?.analyzedToday ?? null;

  const [runScanner, scanning] = useAction(() => api.post('/api/agents/scanner/run'), { success: 'Scanner started. New markets show up here as it finds them.' });

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const sub = !counts ? (
    <Skeleton width={220} height={14} />
  ) : counts.all === 0 ? (
    'Markets your Scanner finds show up here.'
  ) : (
    <>
      <Fade>{formatNumber(counts.watching)}</Fade> watching
      {analyzedToday != null && (
        <>
          {' '}· <Fade>{formatNumber(analyzedToday)}</Fade> analyzed today
        </>
      )}
    </>
  );

  const scannerBusy = scanning || !!scanner?.running;
  const runLabel = scanner?.running ? 'Scanner running' : 'Run Scanner now';

  return (
    <div className="page markets-page">
      <header className="page-header">
        <div className="page-header-text">
          <h1>Markets</h1>
          <div className="page-sub">{sub}</div>
        </div>
        <Button variant="outline" icon={Plus} onClick={() => setAdding(true)}>
          Add market
        </Button>
        <Button onClick={() => runScanner()} loading={scannerBusy}>
          {runLabel}
        </Button>
      </header>

      <div className="mk-toolbar">
        <label className="mk-search">
          <Search size={14} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('');
                e.currentTarget.blur();
              }
            }}
            placeholder="Search questions or categories"
            aria-label="Search markets"
          />
          {query ? (
            <button type="button" className="mk-search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          ) : (
            <Kbd>/</Kbd>
          )}
        </label>
        <div className="mk-sort">
          <span className="muted small">Sort</span>
          <Segmented label="Sort markets" value={sort} onChange={setSort} options={SORTS} />
        </div>
      </div>

      <UnderlineTabs value={status} onChange={setStatus} options={TABS.map((t) => ({ ...t, count: counts ? counts[t.value] ?? 0 : undefined }))} />

      {res.error && !res.data ? (
        <ErrorState error={res.error} onRetry={res.refresh} />
      ) : !markets || !shown ? (
        <TableSkeleton />
      ) : counts.all === 0 ? (
        <EmptyState
          icon={CandlestickChart}
          title="No markets yet"
          actions={
            <>
              <Button onClick={() => runScanner()} loading={scannerBusy}>
                {runLabel}
              </Button>
              <Button variant="outline" onClick={() => setAdding(true)}>
                Add market
              </Button>
            </>
          }
        >
          Scanner {scanner?.schedule?.type === 'cron' ? `runs ${scanner.schedule.label.toLowerCase()} and adds` : 'adds'} liquid Polymarket markets here. Run it now, or paste a link to a market you want watched.
        </EmptyState>
      ) : shown.markets.length === 0 && !res.loading ? (
        q ? (
          <EmptyState title={`No markets match “${q}”`} actions={<Button variant="outline" onClick={() => setQuery('')}>Clear search</Button>}>
            Search looks at the question, category and slug.
          </EmptyState>
        ) : (
          <EmptyState title={EMPTY_TAB[status][0]}>{EMPTY_TAB[status][1]}</EmptyState>
        )
      ) : (
        <MarketTable
          key={shown.status}
          markets={shown.markets}
          total={shown.status === 'all' ? counts.all : counts[shown.status]}
          sort={shown.sort}
          loading={res.loading}
          byAgent={byAgent}
          minEdge={minEdge}
          showStatus={shown.status === 'all'}
          now={now}
        />
      )}

      <AddMarketDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function MarketTable({ markets, total, sort, loading, byAgent, minEdge, showStatus, now }) {
  const appear = useAppear(markets);
  return (
    <div className={loading ? 'mk-table fade-in is-loading' : 'mk-table fade-in'}>
      <div className="mk-grid mk-head">
        <span>Market</span>
        <span className="num">Price</span>
        <span className="num">24h</span>
        <span className="num">Estimate</span>
        <span className="num">Edge</span>
        <span className="num">Vol 24h</span>
        <span>Closes</span>
        <span>Position</span>
        <span>Last activity</span>
      </div>
      {markets.map((m) => {
        const a = appear(m.id);
        return <MarketRow key={m.id} market={m} className={a.className} style={a.style} byAgent={byAgent} minEdge={minEdge} showStatus={showStatus} now={now} />;
      })}
      <div className="mk-foot">
        <span>
          Showing {formatNumber(markets.length)} of {plural(total ?? markets.length, 'market')} · positions are paper trades
        </span>
        <span>{SORT_NOTE[sort]}</span>
      </div>
    </div>
  );
}

function MarketRow({ market: m, className, style, byAgent, minEdge, showStatus, now }) {
  const change = change24h(m, now);
  const history = useMemo(() => (m.priceHistory ?? []).map((p) => p.p), [m.priceHistory]);
  const pos = m.openPosition;
  const act = m.lastActivity;
  const agent = act ? byAgent[act.agentId] : null;
  const ended = m.status === 'closed' || m.status === 'resolved';

  return (
    <a href={`#/markets/${m.id}`} className={`mk-grid mk-row ${className}`} style={style}>
      <span className="mk-cell-q">
        <span className="mk-question" title={m.question}>
          {m.question}
        </span>
        <span className="mk-meta">
          {m.category && <Tag>{m.category}</Tag>}
          {m.status === 'resolved' && m.outcome ? (
            <Tag kind="side" value={m.outcome}>{`Resolved ${m.outcome.toUpperCase()}`}</Tag>
          ) : (
            showStatus && m.status !== 'watching' && <Tag kind="market" value={m.status} />
          )}
        </span>
      </span>
      <span className="mk-price">
        <Sparkline values={history} width={44} height={18} className="mk-spark" />
        <Fade className="mk-price-value">{cents(m.yesPrice)}</Fade>
      </span>
      <span className={change ? 'num mono-num' : 'num mono-num muted'}>{change == null ? '—' : centsChange(change)}</span>
      <span className={ended ? 'num mono-num muted' : 'num mono-num'}>{m.estimate == null ? <span className="muted">—</span> : <Fade>{prob(m.estimate)}</Fade>}</span>
      <span className="num mono-num">
        <Edge value={ended ? null : m.edge} min={minEdge} />
      </span>
      <span className="num mono-num">{compactMoney(m.volume24h)}</span>
      <span className={ended ? 'muted' : 'mk-closes'}>{ended ? (m.status === 'resolved' ? 'Resolved' : 'Closed') : closesLabel(m.endDate, now)}</span>
      <span>
        {pos ? (
          <Tag kind="side" value={pos.side}>
            {`${pos.side === 'no' ? 'NO' : 'YES'} · ${stakeMoney(pos.stake)}`}
          </Tag>
        ) : (
          <span className="muted">—</span>
        )}
      </span>
      <span className="mk-activity">
        {act ? (
          <>
            <Mono size="xs">{agent?.mono ?? '··'}</Mono>
            <span className="mk-activity-text" title={act.text}>
              {act.text}
            </span>
            <span className="mk-ago">{formatAgo(act.at, now)}</span>
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </span>
    </a>
  );
}

function TableSkeleton() {
  return (
    <div className="mk-table">
      <div className="mk-grid mk-head">
        {['Market', 'Price', '24h', 'Estimate', 'Edge', 'Vol 24h', 'Closes', 'Position', 'Last activity'].map((h) => (
          <span key={h} className={['Market', 'Closes', 'Position', 'Last activity'].includes(h) ? '' : 'num'}>
            {h}
          </span>
        ))}
      </div>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="mk-grid mk-row mk-row-skeleton">
          <span className="mk-cell-q">
            <Skeleton width={`${80 - ((i * 11) % 30)}%`} height={13} />
            <Skeleton width={56} height={14} />
          </span>
          <Skeleton width="80%" height={13} className="sk-right" />
          <Skeleton width="60%" height={13} className="sk-right" />
          <Skeleton width="60%" height={13} className="sk-right" />
          <Skeleton width="70%" height={13} className="sk-right" />
          <Skeleton width="60%" height={13} className="sk-right" />
          <Skeleton width="70%" height={13} />
          <Skeleton width="60%" height={16} />
          <Skeleton width={`${85 - ((i * 7) % 25)}%`} height={13} />
        </div>
      ))}
    </div>
  );
}

function AddMarketDialog({ open, onClose }) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setValue('');
    setError(null);
    // The dialog focuses its first control; the link field is the one that matters here.
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  async function submit(e) {
    e?.preventDefault();
    const url = value.trim();
    if (!url) {
      setError('Paste a polymarket.com link or a market slug.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/markets/add', { url });
      toast('Scanner is adding it to your watchlist. The Analyst picks it up next.', { tone: 'success' });
      onClose();
    } catch (err) {
      setError(err?.message ?? 'Couldn’t add that market.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a market"
      description="Scanner looks it up on Polymarket, adds it to your watchlist and queues it for the Analyst."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Add market
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <Field label="Polymarket link or slug" error={error} help="For example https://polymarket.com/event/fed-decision-in-december">
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            placeholder="https://polymarket.com/event/…"
            className="mono"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      </form>
    </Dialog>
  );
}
