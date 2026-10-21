import { useEffect, useRef } from 'react';

export const SALES_REASONS = ['Wrong person', 'Weak angle', 'Too long', 'Don’t contact this account'];
export const TRADE_REASONS = ['Edge too thin', 'Position too large', 'Thin liquidity', 'Don’t trade this market'];

/** Note for the agent that wrote the item, with quick tags. Confirm lives in the action bar. */
export function RejectPanel({ trade, author, note, onChange, onCancel }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.closest('.ap-reject')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);

  const reasons = trade ? TRADE_REASONS : SALES_REASONS;
  const toggle = (tag) => {
    const has = note.tags.includes(tag);
    onChange({ ...note, tags: has ? note.tags.filter((t) => t !== tag) : [...note.tags, tag] });
  };

  return (
    <div className="ap-reject">
      <div className="ap-reject-head">
        <span className="ap-reject-title">{trade ? 'Why are you rejecting this trade?' : 'Why are you rejecting this draft?'}</span>
        <button type="button" className="ap-inline-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <textarea
        ref={ref}
        className="input textarea ap-reject-input"
        rows={3}
        value={note.reason}
        onChange={(e) => onChange({ ...note, reason: e.target.value })}
        placeholder={trade ? 'e.g. The price already moved. Wait for a better entry.' : 'e.g. Don’t lead with the expansion news. They posted about staffing, use that.'}
        aria-label="Reason"
      />
      <div className="ap-quick-tags">
        {reasons.map((r) => (
          <button key={r} type="button" className="ap-quick" aria-pressed={note.tags.includes(r)} onClick={() => toggle(r)}>
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
