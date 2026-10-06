// Trade proposals inside the shared Approvals page: the ticket in the center column
// and the Analyst's reasoning plus recent large trades on the right.
import { useResource } from '../../lib/live.js';
import { formatAgo, formatDateTime } from '../../lib/format.js';
import { Skeleton, Tag } from '../../components/ui.jsx';
import { Factors, PnL, SideTag, WhaleLine, cents, closesLabel, prob, pts, shares as formatShares, stakeMoney } from '../markets-shared.jsx';
import './trade-approval.css';

const sideName = (side) => (side === 'no' ? 'NO' : 'YES');

/** Center column for kind 'trade'. */
export function TradeDetail({ approval: a }) {
  const t = a.trade ?? {};
  const m = a.market;
  const side = t.side === 'no' ? 'no' : 'yes';
  const price = Number(t.price);
  const yesPrice = Number.isFinite(price) ? (side === 'yes' ? price : 1 - price) : m?.yesPrice;
  const payout = Number(t.shares) || (t.stake && price ? t.stake / price : null);
  const profit = payout != null && t.stake != null ? payout - t.stake : null;
  const now = a.currentPrice;
  const moved = a.status === 'pending' && now != null && Number.isFinite(price) && Math.round(now * 100) !== Math.round(price * 100);
  const question = m?.question ?? a.subject ?? 'Trade';
  const rationale = t.rationale || a.body;
  const ended = m && (m.status === 'closed' || m.status === 'resolved');

  return (
    <div className="tr-detail">
      <div className="tr-head">
        <div className="tr-head-text">
          {m ? (
            <a href={`#/markets/${m.id}`} className="tr-question">
              {question}
            </a>
          ) : (
            <span className="tr-question">{question}</span>
          )}
          <div className="tr-meta">
            {m?.category && <span>{m.category}</span>}
            {m?.endDate && (
              <>
                {m.category && <span>·</span>}
                <span>{ended ? 'Trading has ended' : `Closes ${closesLabel(m.endDate)}`}</span>
              </>
            )}
            {m?.url && (
              <>
                {(m.category || m.endDate) && <span>·</span>}
                <a href={m.url} target="_blank" rel="noreferrer">
                  Polymarket ↗
                </a>
              </>
            )}
          </div>
        </div>
        <Tag kind="approval" value="trade" />
      </div>

      <div className="tr-ticket">
        <div className="tr-ticket-head">
          <SideTag side={side} size="lg">
            Buy {sideName(side)}
          </SideTag>
          <span className="tr-ticket-line">
            {formatShares(t.shares)} shares at {cents(price)}
          </span>
          <span className="tr-ticket-stake">{stakeMoney(t.stake)}</span>
        </div>
        <div className="tr-cells">
          <Cell label="Side" value={<SideTag side={side}>{sideName(side)}</SideTag>} />
          <Cell label="Price" value={cents(price)} note={moved ? `now ${cents(now)}` : 'per share'} />
          <Cell label="Stake" value={stakeMoney(t.stake)} note="paper dollars" />
          <Cell label="Shares" value={formatShares(t.shares)} note="$1 each if right" />
          <Cell label="Max payout" value={stakeMoney(payout)} note={profit != null ? `${stakeMoney(profit)} profit if ${sideName(side)} wins` : null} />
          <Cell label="Edge" value={<span className="tr-edge">{pts(t.edge)}</span>} note={`on ${sideName(side)}`} />
          <Cell label="Estimate vs market" value={`${prob(t.estimate)} vs ${cents(yesPrice)}`} note="chance of YES" />
          <Cell label="Confidence" value={prob(t.confidence)} note={confidenceWord(t.confidence)} />
        </div>
        <OddsBar market={yesPrice} estimate={t.estimate} />
      </div>

      <p className="tr-notes">
        <span className="tr-paper">Paper trade. No real money moves.</span> <TradeStatusNote approval={a} price={price} now={now} moved={moved} />
      </p>

      <section className="tr-block">
        <h3>Analyst rationale</h3>
        {rationale ? (
          String(rationale)
            .split(/\n{2,}/)
            .filter((p) => p.trim())
            .slice(0, 6)
            .map((p, i) => (
              <p key={i} className="tr-text">
                {p.trim()}
              </p>
            ))
        ) : (
          <p className="tr-text muted">No rationale was attached to this trade.</p>
        )}
      </section>
    </div>
  );
}

function TradeStatusNote({ approval: a, price, now, moved }) {
  const proposed = a.createdAt ? ` Proposed ${formatDateTime(a.createdAt)}.` : '';
  if (a.status === 'pending') {
    return (
      <>
        Trader buys at the market price when you approve{moved ? `, which is ${cents(now)} now, not the ${cents(price)} it was proposed at` : ''}.{proposed}
      </>
    );
  }
  if (a.status === 'sent') {
    const p = a.position;
    return (
      <>
        Bought at {cents(a.executedPrice ?? p?.entryPrice ?? price)}
        {a.executedAt ? ` on ${formatDateTime(a.executedAt)}` : ''}.{' '}
        {p && (
          <>
            {p.status === 'open' ? 'The position is open' : 'The position is closed'}
            {p.pnl != null ? (
              <>
                , <PnL value={p.status === 'open' ? p.pnl : p.realizedPnl ?? p.pnl} showPct={false} /> so far.{' '}
              </>
            ) : (
              '. '
            )}
            <a href="#/positions">View positions →</a>
          </>
        )}
      </>
    );
  }
  if (a.status === 'failed') {
    const err = typeof a.error === 'string' ? a.error : a.error?.message;
    return <>Trader couldn’t place it{err ? `: ${err}` : '.'}</>;
  }
  if (a.status === 'rejected') return <>Nothing was placed.{proposed}</>;
  return <>{proposed.trim()}</>;
}

function confidenceWord(c) {
  if (c == null) return null;
  if (c >= 0.8) return 'high';
  if (c >= 0.65) return 'fairly high';
  if (c >= 0.5) return 'moderate';
  return 'low';
}

function Cell({ label, value, note }) {
  return (
    <div className="tr-cell">
      <span className="tr-cell-label">{label}</span>
      <span className="tr-cell-value">{value}</span>
      {note && <span className="tr-cell-note">{note}</span>}
    </div>
  );
}

// 0–100 track: where the market prices YES and where the Analyst puts it.
function OddsBar({ market, estimate }) {
  if (market == null || estimate == null) return null;
  const mp = Math.max(0, Math.min(100, market * 100));
  const ep = Math.max(0, Math.min(100, estimate * 100));
  const lo = Math.min(mp, ep);
  const hi = Math.max(mp, ep);
  const near = hi - lo < 14;
  return (
    <div className="tr-odds" aria-label={`Market ${cents(market)}, Analyst ${prob(estimate)}`}>
      <div className="tr-odds-track">
        <span className="tr-odds-gap" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
        <span className="tr-odds-mark tr-odds-market" style={{ left: `${mp}%` }} />
        <span className="tr-odds-mark tr-odds-estimate" style={{ left: `${ep}%` }} />
      </div>
      <div className="tr-odds-labels">
        <span className="tr-odds-label" style={{ left: `${mp}%`, transform: near ? (mp <= ep ? 'translateX(-100%)' : 'none') : 'translateX(-50%)' }}>
          Market {cents(market)}
        </span>
        <span className="tr-odds-label strong" style={{ left: `${ep}%`, transform: near ? (ep < mp ? 'translateX(-100%)' : 'none') : 'translateX(-50%)' }}>
          Analyst {prob(estimate)}
        </span>
      </div>
      <div className="tr-odds-scale">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

/** Right column for kind 'trade'. */
export function TradeSide({ approval: a }) {
  const id = a.marketId ?? a.market?.id;
  const { data, error } = useResource(id ? `/api/markets/${id}` : null, ['markets', 'signals']);
  const market = data?.market;
  const brief = market?.brief;
  const whales = (data?.signals ?? []).filter((s) => s.kind === 'whale').slice(0, 5);
  const loading = !data && !error && !!id;

  return (
    <div className="tr-side">
      <div className="tr-side-block">
        <div className="tr-side-head">
          <h2>Analyst brief</h2>
          {brief?.verdict && <VerdictTag verdict={brief.verdict} />}
        </div>
        {loading ? (
          <SideSkeleton />
        ) : !brief ? (
          <p className="tr-side-text">{error ? 'Couldn’t load the brief for this market.' : 'The Analyst hasn’t written a brief for this market yet.'}</p>
        ) : (
          <>
            {brief.factors?.length > 0 && (
              <>
                <span className="tr-side-label">What moves it</span>
                <Factors factors={brief.factors} compact />
              </>
            )}
            {brief.sources?.length > 0 && (
              <div className="tr-sources">
                {brief.sources.slice(0, 4).map((s, i) => (
                  <a key={i} href={s.url} target="_blank" rel="noreferrer" title={s.url}>
                    {s.title || s.url} ↗
                  </a>
                ))}
              </div>
            )}
            <span className="tr-side-meta">
              {[brief.model, brief.at && `written ${formatAgo(brief.at)} ago`].filter(Boolean).join(' · ')}
            </span>
          </>
        )}
      </div>

      <div className="tr-side-block">
        <span className="tr-side-label">Recent large trades on this market</span>
        {loading ? (
          <SideSkeleton rows={3} />
        ) : whales.length === 0 ? (
          <p className="tr-side-text">No large trades on this market yet. Whales flags trades above its size threshold.</p>
        ) : (
          <div className="tr-whales">
            {whales.map((s) => (
              <WhaleLine key={s.id} signal={s} compact />
            ))}
          </div>
        )}
      </div>

      <div className="tr-side-block tr-side-last">
        {market && (
          <div className="kv">
            <span>Price now</span>
            <span className="mono">{cents(market.yesPrice)} YES</span>
            <span>Liquidity</span>
            <span className="mono">{stakeMoney(market.liquidity)}</span>
            <span>Closes</span>
            <span>{closesLabel(market.endDate)}</span>
          </div>
        )}
        {id && (
          <a href={`#/markets/${id}`} className="tr-link">
            Open market →
          </a>
        )}
      </div>
    </div>
  );
}

function VerdictTag({ verdict }) {
  if (verdict === 'pass') return <Tag color="gray">Pass</Tag>;
  return <Tag kind="side" value={verdict}>{`Leans ${sideName(verdict)}`}</Tag>;
}

function SideSkeleton({ rows = 4 }) {
  return (
    <div className="tr-side-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={12} width={`${90 - i * 12}%`} />
      ))}
    </div>
  );
}

