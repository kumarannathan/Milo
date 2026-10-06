import { useRef } from 'react';
import { formatShort } from '../lib/format.js';
import { useNow } from '../lib/live.js';
import { Mono, Tag } from './ui.jsx';

// One activity line: "<Agent> pre <link> post", with a colored tag on the right.
export function ActivityRow({ item, agent, isNew }) {
  const now = useNow(60_000);
  return (
    <div className={isNew ? 'feed-row row-enter' : 'feed-row'}>
      <span className="feed-time">{formatShort(item.at, new Date(now))}</span>
      <Mono size="sm">{agent?.mono ?? '··'}</Mono>
      <span className="feed-text">
        <b>{agent?.name ?? item.agentId}</b> {item.pre}{' '}
        {item.link && (item.href ? <a href={item.href}>{item.link}</a> : <span className="strong">{item.link}</span>)}{' '}
        <span className={item.level === 'error' ? 'error-text' : 'feed-post'}>{item.post}</span>
      </span>
      {item.tag ? <Tag kind="activity" value={item.tag} /> : <span />}
    </div>
  );
}

// Remembers which ids it has already shown so only fresh rows animate in.
export function ActivityList({ items, agents }) {
  const seen = useRef(null);
  const byId = Object.fromEntries((agents ?? []).map((a) => [a.id, a]));
  const first = seen.current === null;
  if (first) seen.current = new Set();
  const rows = items.map((item) => {
    const isNew = !first && !seen.current.has(item.id);
    return <ActivityRow key={item.id} item={item} agent={byId[item.agentId]} isNew={isNew} />;
  });
  for (const item of items) seen.current.add(item.id);
  return <div className="feed">{rows}</div>;
}
