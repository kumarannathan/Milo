import { useEffect, useMemo, useState } from 'react';
import { LineChart as LineChartIcon } from 'lucide-react';
import { useNow, useResource } from '../lib/live.js';
import { formatDateTime, formatMoney, formatShort, plural } from '../lib/format.js';
import { Button, EmptyState, ErrorState, Segmented, Skeleton, SkeletonRows, Spinner, Tag } from '../components/ui.jsx';
import { LineChart } from '../components/LineChart.jsx';
import { ClosePositionDialog, Fade, PnL, SideTag, cents, pnlClass, prob, shares as formatShares, stakeMoney, useAppear } from './markets-shared.jsx';
import './positions.css';

const RANGES = [
  { value: '1d', label: '1D' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: 'all', label: 'All' },
];

const RANGE_NOTE = { '1d': 'last 24 hours', '7d': 'last 7 days', '30d': 'last 30 days', all: 'since the start' };

const CLOSE_REASON = { take_profit: 'Take profit', stop_loss: 'Stop loss', manual: 'Closed by you' };

export default function Positions() {
  const now = useNow(30_000);
  const [tab, setTab] = useState('open');
  const [closing, setClosing] = useState(null);
  const [requested, setRequested] = useState(() => new Set());
  const res = useResource('/api/positions?status=all', ['positions', 'markets', 'equity']);
  const pending = useResource('/api/approvals?status=pending&limit=1', ['approvals']);
  const summary = res.data?.summary;
  const all = res.data?.positions ?? null;
  const rows = useMemo(() => (all ? all.filter((p) => p.status === tab) : null), [all, tab]);
  const pendingCount = pending.data?.counts?.pending ?? 0;

  return (
    <div className="page positions-page">
      <header className="page-header">
        <div className="page-header-text">
          <h1>Positions</h1>
          <div className="page-sub">
            Paper trading account{summary ? ` · started with ${formatMoney(summary.startingBalance, { cents: false })}` : ''}. Every trade is simulated. No real money moves.
          </div>
        </div>
        {pendingCount > 0 && (
          <Button variant="outline" onClick={() => (window.location.hash = '#/approvals')}>
            Review {plural(pendingCount, 'trade')}
          </Button>
        )}
      </header>

      <div className="page-body">
        {res.error && !res.data ? (
          <ErrorState error={res.error} onRetry={res.refresh} />
        ) : (
          <>
            <SummaryTiles summary={summary} positions={all} />
            <EquityPanel summary={summary} />
            <section className="panel pos-panel">
              <div className="panel-head">
                <h2>{tab === 'open' ? 'Open positions' : 'Closed positions'}</h2>
                {summary && tab === 'open' && summary.openCount > 0 && <span className="panel-hint">Marked to the last price Scanner saw</span>}
                <div className="panel-actions">
                  <Segmented
                    label="Position status"
                    value={tab}
                    onChange={setTab}
                    options={[
                      { value: 'open', label: 'Open', count: summary?.openCount },
                      { value: 'closed', label: 'Closed', count: summary?.closedCount },
                    ]}
                  />
                </div>
              </div>
              {!rows ? (
                <SkeletonRows rows={5} height={44} />
              ) : rows.length === 0 ? (
                tab === 'open' ? (
                  <EmptyState
                    compact
                    icon={LineChartIcon}
                    title="No open positions"
                    actions={
                      pendingCount > 0 ? (
                        <Button variant="outline" size="sm" onClick={() => (window.location.hash = '#/approvals')}>
                          Review {plural(pendingCount, 'trade')}
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => (window.location.hash = '#/markets')}>
                          Open markets
                        </Button>
                      )
                    }
                  >
                    Trader proposes a paper trade when the Analyst finds an edge. Once you approve it, the position shows up here.
                  </EmptyState>
                ) : (
                  <EmptyState compact title="No closed positions yet">
                    Bookkeeper closes positions when markets resolve or hit your take-profit or stop-loss levels. You can also close one yourself.
                  </EmptyState>
                )
              ) : (
                <PositionTable key={tab} tab={tab} rows={rows} now={now} onClose={setClosing} requested={requested} />
              )}
            </section>
          </>
        )}
      </div>
      <ClosePositionDialog
        position={closing}
        question={closing?.market?.question}
        onClose={() => setClosing(null)}
        onClosed={(id) => setRequested((s) => new Set(s).add(id))}
      />
    </div>
  );
}

function SummaryTiles({ summary: s, positions }) {
  const closed = positions?.filter((p) => p.status === 'closed') ?? [];
  const wins = closed.filter((p) => (p.realizedPnl ?? p.pnl) > 0).length;
  const tiles = s
    ? [
        {
          k: 'Equity',
          v: <Fade>{formatMoney(s.equity)}</Fade>,
          sub: <PnL value={s.totalPnl} pct={s.startingBalance ? (s.totalPnl / s.startingBalance) * 100 : s.totalPnlPct} />,
          title: 'Change since the start of the paper account',
        },
        { k: 'Cash', v: <Fade>{formatMoney(s.cash)}</Fade>, sub: s.equity ? `${Math.round((s.cash / s.equity) * 100)}% of equity` : '—' },
        { k: 'Exposure', v: <Fade>{formatMoney(s.exposure)}</Fade>, sub: `in ${plural(s.openCount, 'open position')}` },
        { k: 'Unrealized P/L', v: <PnL value={s.unrealizedPnl} showPct={false} />, sub: 'on open positions', tone: true },
        { k: 'Realized P/L', v: <PnL value={s.realizedPnl} showPct={false} />, sub: `from ${plural(s.closedCount, 'closed position')}`, tone: true },
        { k: 'Win rate', v: s.winRate == null ? <span className="muted">—</span> : <Fade>{prob(s.winRate)}</Fade>, sub: s.closedCount ? `${wins} of ${s.closedCount} won` : 'no closed trades yet' },
      ]
    : null;
  return (
    <div className="pos-tiles">
      {(tiles ?? Array.from({ length: 6 }, () => null)).map((t, i) => (
        <div key={t?.k ?? i} className="pos-tile" title={t?.title}>
          {t ? (
            <>
              <span className="pos-tile-k">{t.k}</span>
              <span className="pos-tile-v">{t.v}</span>
              <span className="pos-tile-sub">{t.sub}</span>
            </>
          ) : (
            <>
              <Skeleton width="50%" height={12} />
              <Skeleton width="70%" height={24} />
              <Skeleton width="60%" height={10} />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function EquityPanel({ summary }) {
  const [range, setRange] = useState('7d');
  const eq = useResource(`/api/equity?range=${range}`, ['equity']);
  const [shown, setShown] = useState(null);

  // Swap the chart only once the new range has loaded, so it redraws instead of jumping.
  useEffect(() => {
    if (eq.data && !eq.loading) setShown({ range, points: eq.data.points ?? [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eq.data, eq.loading]);

  const points = shown?.points ?? [];
  const first = points[0]?.value;
  const last = points[points.length - 1]?.value;
  const change = first != null && last != null ? last - first : null;
  const changePct = change != null && first ? (change / first) * 100 : null;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Equity</h2>
        <span className="panel-hint">
          {change != null && points.length > 1 ? (
            <>
              <PnL value={Math.round(change * 100) / 100} pct={changePct} className="pos-range-pnl" /> {RANGE_NOTE[shown.range]}
            </>
          ) : (
            'Cash plus the market value of open positions'
          )}
        </span>
        <div className="panel-actions">
          <Segmented label="Equity range" value={range} onChange={setRange} options={RANGES} />
        </div>
      </div>
      <div className={eq.loading && shown ? 'pos-chart is-loading' : 'pos-chart'}>
        {eq.error && !shown ? (
          <ErrorState error={eq.error} onRetry={eq.refresh} />
        ) : !shown ? (
          <Skeleton height={260} radius={6} />
        ) : (
          <LineChart
            key={shown.range}
            points={points}
            height={260}
            formatValue={(v, tip, step) => formatMoney(v, { cents: !!tip || step < 1 })}
            minSpan={(summary?.startingBalance || 1000) * 0.02}
            reference={summary?.startingBalance}
            referenceLabel={summary ? `Start ${formatMoney(summary.startingBalance, { cents: false })}` : undefined}
            emptyText="Bookkeeper records equity as prices move. The curve fills in after a few updates."
            label="Equity over time"
          />
        )}
      </div>
    </section>
  );
}

function PositionTable({ tab, rows, now, onClose, requested }) {
  const appear = useAppear(rows);
  const open = tab === 'open';
  const totals = useMemo(() => {
    if (!open) return null;
    const stake = rows.reduce((s, p) => s + (Number(p.stake) || 0), 0);
    const value = rows.reduce((s, p) => s + (Number(p.value) || 0), 0);
    const pnl = Math.round((value - stake) * 100) / 100;
    return { stake, value, pnl, pnlPct: stake ? (pnl / stake) * 100 : 0 };
  }, [rows, open]);

  return (
    <div className="pos-table fade-in">
      <div className={`row row-head ${open ? 'pos-grid-open' : 'pos-grid-closed'}`}>
        <span>Market</span>
        <span>Side</span>
        <span className="num">Shares</span>
        <span className="num">Entry</span>
        <span className="num">{open ? 'Mark' : 'Exit'}</span>
        <span className="num">Stake</span>
        <span className="num">Value</span>
        <span className="num">P/L</span>
        <span>{open ? 'Opened' : 'Closed'}</span>
        <span>{open ? '' : 'Reason'}</span>
      </div>
      <div className="rows">
        {rows.map((p) => {
          const a = appear(p.id);
          return (
            <PositionRow key={p.id} position={p} open={open} now={now} onClose={onClose} closing={requested.has(p.id)} className={a.className} style={a.style} />
          );
        })}
      </div>
      {totals && rows.length > 1 && (
        <div className="row pos-grid-open pos-total">
          <span>Total</span>
          <span />
          <span />
          <span />
          <span />
          <span className="num">{stakeMoney(totals.stake)}</span>
          <span className="num">
            <Fade>{stakeMoney(totals.value)}</Fade>
          </span>
          <span className="num">
            <PnL value={totals.pnl} pct={totals.pnlPct} />
          </span>
          <span />
          <span />
        </div>
      )}
    </div>
  );
}

function PositionRow({ position: p, open, now, onClose, closing, className, style }) {
  const m = p.market;
  const ended = m && (m.status === 'closed' || m.status === 'resolved');
  const reason =
    p.closeReason === 'resolved' ? (m?.outcome ? `Resolved ${m.outcome.toUpperCase()}` : 'Resolved') : CLOSE_REASON[p.closeReason] ?? (p.closeReason ? p.closeReason.replace(/_/g, ' ') : '—');
  const pnl = open ? p.pnl : p.realizedPnl ?? p.pnl;
  return (
    <div className={`row ${open ? 'pos-grid-open' : 'pos-grid-closed'} pos-row ${className}`} style={style}>
      <span className="pos-market">
        {m ? (
          <a href={`#/markets/${m.id}`} className="mk-question" title={m.question}>
            {m.question}
          </a>
        ) : (
          <span className="muted">Market no longer tracked</span>
        )}
        {open && ended && <span className="pos-market-note">Trading ended · settles when it resolves</span>}
      </span>
      <span>
        <SideTag side={p.side}>{p.side === 'no' ? 'NO' : 'YES'}</SideTag>
      </span>
      <span className="num pos-mono">{formatShares(p.shares)}</span>
      <span className="num pos-mono">{cents(p.entryPrice)}</span>
      <span className="num pos-mono">
        <Fade>{cents(open ? p.markPrice : p.exitPrice)}</Fade>
      </span>
      <span className="num pos-mono">{stakeMoney(p.stake)}</span>
      <span className="num pos-mono">
        <Fade>{stakeMoney(p.value)}</Fade>
      </span>
      <span className={`num pos-pnl ${pnlClass(pnl)}`}>
        <PnL value={pnl} showPct={false} className="pos-pnl-v" />
        <Fade className="pos-pnl-pct">{p.pnlPct != null ? `${p.pnlPct > 0 ? '+' : p.pnlPct < 0 ? '−' : ''}${Math.abs(p.pnlPct).toFixed(1)}%` : ''}</Fade>
      </span>
      <span className="pos-when" title={formatDateTime(open ? p.openedAt : p.closedAt)}>
        {formatShort(open ? p.openedAt : p.closedAt, new Date(now))}
      </span>
      <span className="pos-last">
        {open ? (
          closing ? (
            <span className="pos-closing">
              <Spinner size={12} />
              Closing
            </span>
          ) : (
            <Button variant="outline" size="xs" onClick={() => onClose(p)} disabled={ended} title={ended ? 'Trading has ended. Bookkeeper settles this when the market resolves.' : undefined}>
              Close
            </Button>
          )
        ) : (
          <Tag color={p.closeReason === 'resolved' ? 'gray' : p.closeReason === 'manual' ? 'blue' : p.closeReason === 'stop_loss' ? 'amber' : 'teal'}>{reason}</Tag>
        )}
      </span>
    </div>
  );
}
