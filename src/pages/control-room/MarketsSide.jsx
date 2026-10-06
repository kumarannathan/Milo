// Right column of the markets control room: equity, trades waiting on you, open positions.
import { useMemo } from 'react';
import { useResource } from '../../lib/live.js';
import { formatAgoLong, formatMoney, plural } from '../../lib/format.js';
import { Skeleton } from '../../components/ui.jsx';
import { LineChart } from '../../components/LineChart.jsx';
import { Fade, PnL, SideTag, stakeMoney, useAppear } from '../markets-shared.jsx';
import './markets-side.css';

const MAX_WAITING = 5;

export function MarketsSide({ approvals = [], now }) {
  const positions = useResource('/api/positions?status=open', ['positions', 'markets', 'equity']);
  const summary = positions.data?.summary;
  const open = positions.data?.positions ?? null;
  const trades = approvals.filter((a) => a.kind === 'trade');

  return (
    <>
      <EquityPanel summary={summary} error={positions.error} />
      <WaitingPanel items={trades} now={now} />
      <OpenPositionsPanel positions={open} error={positions.error && !positions.data} />
    </>
  );
}

function EquityPanel({ summary: s, error }) {
  const eq = useResource('/api/equity?range=7d', ['equity']);
  const points = eq.data?.points ?? null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Equity</h2>
        <a href="#/positions" className="panel-link panel-actions">
          Positions →
        </a>
      </div>
      <div className="ms-equity">
        {!s ? (
          error ? (
            <span className="ms-empty">Couldn’t load the paper account. {error.message}</span>
          ) : (
            <>
              <Skeleton width="45%" height={28} />
              <Skeleton width="60%" height={12} />
            </>
          )
        ) : (
          <>
            <div className="ms-equity-top">
              <Fade className="ms-equity-value">{formatMoney(s.equity)}</Fade>
              <span className="ms-equity-pnl">
                <PnL value={s.totalPnl} pct={s.startingBalance ? (s.totalPnl / s.startingBalance) * 100 : s.totalPnlPct} /> <span className="muted">since start</span>
              </span>
            </div>
          </>
        )}
        <div className="ms-chart">
          {points ? (
            <LineChart
              points={points}
              height={84}
              axes={false}
              formatValue={(v) => formatMoney(v)}
              minSpan={(s?.startingBalance || 1000) * 0.02}
              reference={s?.startingBalance}
              emptyText="The curve fills in as prices move."
              label="Equity, last 7 days"
            />
          ) : eq.error ? (
            <span className="ms-empty">Couldn’t load the equity curve.</span>
          ) : (
            <Skeleton height={84} radius={6} />
          )}
        </div>
        <div className="ms-equity-foot">
          <span>Last 7 days</span>
          <span>{s ? `${formatMoney(s.cash, { cents: false })} cash · paper money` : 'Paper money'}</span>
        </div>
      </div>
    </section>
  );
}

function WaitingPanel({ items, now }) {
  const shown = items.slice(0, MAX_WAITING);
  const appear = useAppear(shown);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Waiting on you</h2>
        <a href="#/approvals" className="panel-link panel-actions">
          Open inbox →
        </a>
      </div>
      {items.length === 0 ? (
        <div className="ms-empty-block">Nothing to review. Trader’s proposals show up here before anything is placed.</div>
      ) : (
        <div className="ms-list">
          {shown.map((a) => {
            const t = a.trade ?? {};
            const x = appear(a.id);
            return (
              <a key={a.id} href={`#/approvals/${a.id}`} className={`ms-wait ${x.className}`} style={x.style}>
                <div className="ms-wait-top">
                  <span className="ms-wait-q" title={a.market?.question}>
                    {a.market?.question ?? 'Trade proposal'}
                  </span>
                  <span className="ms-age">{formatAgoLong(a.createdAt, now)}</span>
                </div>
                <div className="ms-wait-sub">
                  {t.side && <SideTag side={t.side}>{t.side === 'no' ? 'NO' : 'YES'}</SideTag>}
                  <span className="ms-wait-subject">{a.subject ?? `${stakeMoney(t.stake)} trade`}</span>
                </div>
              </a>
            );
          })}
          {items.length > MAX_WAITING && (
            <a href="#/approvals" className="ms-more">
              {plural(items.length - MAX_WAITING, 'more trade')} in Approvals →
            </a>
          )}
        </div>
      )}
    </section>
  );
}

function OpenPositionsPanel({ positions, error }) {
  const top = useMemo(() => (positions ? [...positions].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 5) : null), [positions]);
  const appear = useAppear(top);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Open positions</h2>
        {positions && positions.length > 0 && <span className="panel-hint">{positions.length}</span>}
        <a href="#/positions" className="panel-link panel-actions">
          All positions →
        </a>
      </div>
      {error ? (
        <div className="ms-empty-block">Couldn’t load positions.</div>
      ) : !top ? (
        <div className="skeleton-rows">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} height={14} width={`${90 - i * 10}%`} />
          ))}
        </div>
      ) : top.length === 0 ? (
        <div className="ms-empty-block">No open positions. Trades you approve show up here with their P/L.</div>
      ) : (
        <div className="ms-list">
          {top.map((p) => {
            const x = appear(p.id);
            return (
              <a key={p.id} href={`#/markets/${p.marketId}`} className={`ms-pos ${x.className}`} style={x.style}>
                <SideTag side={p.side}>{p.side === 'no' ? 'NO' : 'YES'}</SideTag>
                <span className="ms-pos-q" title={p.market?.question}>
                  {p.market?.question ?? 'Market no longer tracked'}
                </span>
                <span className="ms-pos-nums">
                  <Fade className="ms-pos-value">{stakeMoney(p.value)}</Fade>
                  <PnL value={p.pnl} showPct={false} className="ms-pos-pnl" />
                </span>
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}
