import { useEffect, useRef } from 'react';
import { formatAgoLong } from '../../lib/format.js';
import { Checkbox, EmptyState, Kbd, Skeleton, Tag } from '../../components/ui.jsx';
import { kindLabel, statusTag, titleOf, subtitleOf } from './labels.js';

export function ApprovalList({ tab, items, all, loading, selectedId, checked, leaving, isFresh, now, onSelect, onToggle, onToggleAll, onBulkApprove, bulkBusy }) {
  const listRef = useRef(null);

  // Keep the selected row in view while moving with J/K.
  useEffect(() => {
    const el = listRef.current?.querySelector('.ap-item.selected');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const pending = tab === 'pending';
  const checkedCount = items.filter((a) => checked.has(a.id)).length;
  const allChecked = items.length > 0 && checkedCount === items.length;

  return (
    <section className="ap-list" aria-label="Queue">
      <div className="ap-list-head">
        {pending && <Checkbox checked={allChecked} onChange={() => onToggleAll(!allChecked)} label="Select all" />}
        <span className="ap-list-count">
          {loading ? '' : pending ? (checkedCount ? `${checkedCount} selected` : `${items.length} pending`) : `${items.length}${items.length >= 100 ? '+' : ''} ${tab}`}
        </span>
        {pending && checkedCount > 0 ? (
          <button type="button" className="btn btn-primary btn-xs ap-bulk" onClick={onBulkApprove} disabled={bulkBusy}>
            Approve {checkedCount} and send
          </button>
        ) : (
          <span className="ap-list-order">{pending ? 'Oldest first' : 'Newest first'}</span>
        )}
      </div>

      <div className="ap-list-scroll" ref={listRef} role="listbox" aria-label="Items">
        {loading ? (
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="ap-item ap-item-skeleton">
              <Skeleton width={16} height={16} />
              <div className="ap-item-body">
                <Skeleton width="55%" height={14} />
                <Skeleton width="70%" height={10} />
                <Skeleton width="85%" height={12} />
                <Skeleton width="30%" height={14} />
              </div>
            </div>
          ))
        ) : items.length === 0 && all.length === 0 ? (
          <EmptyState compact title={tab === 'approved' ? 'Nothing approved yet' : tab === 'rejected' ? 'Nothing rejected' : 'Queue is empty'} />
        ) : (
          all.map((a) => (
            <ApprovalRow
              key={a.id}
              approval={a}
              tab={tab}
              selected={a.id === selectedId}
              checked={checked.has(a.id)}
              leaving={leaving.has(a.id)}
              fresh={isFresh(a.id)}
              now={now}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))
        )}
      </div>

      {pending && (
        <div className="ap-keys" aria-label="Keyboard shortcuts">
          <span>
            <Kbd>J</Kbd>
            <Kbd>K</Kbd>move
          </span>
          <span>
            <Kbd>X</Kbd>select
          </span>
          <span>
            <Kbd>⌘↵</Kbd>approve
          </span>
          <span>
            <Kbd>E</Kbd>edit
          </span>
          <span>
            <Kbd>R</Kbd>reject
          </span>
        </div>
      )}
    </section>
  );
}

function ApprovalRow({ approval: a, tab, selected, checked, leaving, fresh, now, onSelect, onToggle }) {
  const pending = tab === 'pending';
  const kind = kindLabel(a);
  const status = statusTag(a);
  const cls = ['ap-item', selected && 'selected', leaving && 'leaving', fresh && 'row-enter', !pending && 'ap-item-done'].filter(Boolean).join(' ');
  return (
    <div
      className={cls}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onClick={() => onSelect(a.id)}
    >
      {pending && <Checkbox checked={checked} onChange={() => onToggle(a.id)} label={`Select ${titleOf(a)}`} className="ap-item-check" />}
      <div className="ap-item-body">
        <div className="ap-item-top">
          <span className="ap-item-name">{titleOf(a)}</span>
          <span className="ap-item-age">{formatAgoLong(pending ? a.createdAt : a.decidedAt ?? a.createdAt, now)}</span>
        </div>
        <span className="ap-item-sub">{subtitleOf(a)}</span>
        {a.kind !== 'trade' && <span className="ap-item-subject">{a.subject || 'No subject'}</span>}
        <div className="ap-item-tags">
          {!pending && <Tag color={status.color}>{status.label}</Tag>}
          <Tag color={kind.color}>{kind.label}</Tag>
          {a.score != null && a.kind !== 'trade' && <span className="ap-item-score">score {a.score}</span>}
        </div>
      </div>
    </div>
  );
}
