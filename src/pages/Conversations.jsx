import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Archive, MessageSquare } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app-context.jsx';
import { useNow, useResource } from '../lib/live.js';
import { DOT, tagFor } from '../lib/tags.js';
import { formatDate, formatDateTime, formatShort, initials, plural } from '../lib/format.js';
import { ConfirmDialog, useAction, useToast } from '../components/feedback.jsx';
import { Avatar, Button, Dot, EmptyState, ErrorState, IconButton, Mono, Skeleton, Tag } from '../components/ui.jsx';
import { DetailSkeleton, agentMono, agentName, dialogOpen, formatInZone, formatMeetingRange, isTyping, useAgents, useAutosize, useFreshIds, useHashSelection, zoneLabel } from './sales-shared.jsx';
import './conversations.css';

const FILTERS = [
  ['all', 'All'],
  ['us', 'Waiting on us'],
  ['them', 'Waiting on them'],
  ['escalated', 'Escalated'],
  ['closed', 'Closed'],
];

const STATUS_DOT = {
  us: 'var(--warning)',
  them: 'var(--idle)',
  escalated: 'var(--foreground)',
  closed: 'var(--off)',
};

export default function Conversations({ selectedId }) {
  const app = useApp();
  const now = useNow(30_000);
  const agents = useAgents();
  const [filter, setFilter] = useState('all');
  const [selId, select] = useHashSelection('conversations', selectedId);
  const list = useResource('/api/threads?status=all', ['threads', 'contacts', 'accounts']);

  const threads = list.data?.threads ?? [];
  const counts = list.data?.counts ?? {};
  const visible = filter === 'all' ? threads : threads.filter((t) => t.status === filter);
  // The open thread stays open even if its status moves it out of the current filter.
  const current = threads.find((t) => t.id === selId) ?? visible[0] ?? null;
  const isFresh = useFreshIds(
    threads.map((t) => t.id),
    !!list.data,
  );

  const changeFilter = (next) => {
    setFilter(next);
    const pool = next === 'all' ? threads : threads.filter((t) => t.status === next);
    if (!pool.some((t) => t.id === current?.id)) select(pool[0]?.id ?? null);
  };

  // J/K move through the list, like Approvals.
  const keys = useRef({});
  keys.current = { visible, current, select };
  useEffect(() => {
    const onKey = (e) => {
      if (dialogOpen() || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'j' && key !== 'k') return;
      const { visible: v, current: c, select: sel } = keys.current;
      if (!v.length) return;
      const i = Math.max(0, v.findIndex((t) => t.id === c?.id));
      const next = v[Math.max(0, Math.min(v.length - 1, i + (key === 'j' ? 1 : -1)))];
      if (next) sel(next.id);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const sender = app.workspace?.settings?.senderEmail;
  const sdr = agents.byId.sdr;
  const empty = list.data && threads.length === 0;

  return (
    <div className="page cv-page">
      <header className="page-header">
        <div className="page-header-text">
          <h1>Conversations</h1>
          <div className="page-sub">
            SDR reads every reply{sender ? ` in ${sender}` : ''}, tags the intent, and hands anything it can’t answer to a person.
          </div>
        </div>
      </header>

      {list.error && !list.data ? (
        <ErrorState error={list.error} onRetry={list.refresh} />
      ) : empty ? (
        <EmptyState icon={MessageSquare} title="No conversations yet">
          Threads start when someone replies to an email you approved.{' '}
          {sdr?.schedule?.type === 'cron' ? `SDR checks the inbox ${sdr.schedule.label.toLowerCase()}.` : 'SDR checks the inbox on its schedule.'}
        </EmptyState>
      ) : (
        <div className="cv-grid">
          <section className="cv-list" aria-label="Threads">
            <div className="cv-filters" role="tablist">
              {FILTERS.map(([value, label]) => (
                <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? 'cv-filter active' : 'cv-filter'} onClick={() => changeFilter(value)}>
                  {label} <span className="cv-filter-n">{list.data ? counts[value] ?? 0 : ''}</span>
                </button>
              ))}
            </div>
            <ThreadList threads={visible} loading={!list.data} currentId={current?.id} onSelect={select} isFresh={isFresh} now={now} filter={filter} />
          </section>

          {current ? (
            <ThreadPane id={current.id} agents={agents} now={now} app={app} />
          ) : (
            <>
              <section className="cv-thread">{!list.data && <DetailSkeleton />}</section>
              <aside className="cv-side" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Thread list ────────────────────────────────────────────────

function ThreadList({ threads, loading, currentId, onSelect, isFresh, now, filter }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.querySelector('.cv-item.selected')?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);

  if (loading) {
    return (
      <div className="cv-list-scroll">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="cv-item cv-item-skeleton">
            <Skeleton width="60%" height={12} />
            <Skeleton width="85%" height={10} />
            <Skeleton width="40%" height={14} />
          </div>
        ))}
      </div>
    );
  }
  if (!threads.length) {
    const label = FILTERS.find(([v]) => v === filter)?.[1]?.toLowerCase();
    return (
      <div className="cv-list-scroll">
        <EmptyState compact title={`Nothing ${label}`}>
          {filter === 'us' ? 'Every reply has an answer.' : filter === 'escalated' ? 'SDR hasn’t handed anything to a person.' : null}
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="cv-list-scroll" ref={ref} role="listbox" aria-label="Threads">
      {threads.map((t) => {
        const status = tagFor('thread', t.status);
        const cls = ['cv-item', t.id === currentId && 'selected', isFresh(t.id) && 'row-enter'].filter(Boolean).join(' ');
        return (
          <div key={t.id} className={cls} role="option" aria-selected={t.id === currentId} onClick={() => onSelect(t.id)}>
            <div className="cv-item-top">
              <span className="cv-item-name">
                {t.name || 'Unknown'} {t.company && <span className="cv-item-co">· {t.company}</span>}
              </span>
              <span className="cv-item-time">{formatShort(t.updatedAt, new Date(now))}</span>
            </div>
            <span className="cv-item-snip">{t.snippet || t.subject}</span>
            <div className="cv-item-tags">
              {t.intent && <Tag kind="intent" value={t.intent} />}
              <span className="cv-item-status">
                <Dot color={STATUS_DOT[t.status] ?? DOT.gray} />
                {status.label}
              </span>
              {t.owner && (
                <span className="owner-chip cv-item-owner" title={`${t.owner.name} owns this thread`}>
                  {t.owner.initials ?? initials(t.owner.name)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Thread and contact ─────────────────────────────────────────

function ThreadPane({ id, agents, now, app }) {
  const res = useResource(`/api/threads/${id}`, ['threads', 'meetings', 'contacts', 'accounts']);
  const pending = useResource('/api/approvals?status=pending', ['approvals']);
  const data = res.data;
  const stale = data && data.thread?.id !== id;

  if (!data) {
    return (
      <>
        <section className="cv-thread">{res.error ? <ErrorState error={res.error} onRetry={res.refresh} /> : <DetailSkeleton />}</section>
        <aside className="cv-side" />
      </>
    );
  }

  const { thread, contact, account, meetings = [] } = data;
  const waiting = (pending.data?.approvals ?? []).filter((a) => a.threadId === thread.id);
  return (
    <>
      <section className={stale ? 'cv-thread is-stale' : 'cv-thread'} aria-busy={stale}>
        <ThreadView key={thread.id} thread={thread} contact={contact} meetings={meetings} waiting={waiting} agents={agents} app={app} />
      </section>
      <aside className={stale ? 'cv-side is-stale' : 'cv-side'}>
        <div className="cv-side-inner" key={thread.id}>
          <ContactCard contact={contact} account={account} now={now} />
          <OwnerBlock thread={thread} agents={agents} />
          <MeetingsBlock meetings={meetings} tz={contact?.timezone} />
        </div>
      </aside>
    </>
  );
}

function ThreadView({ thread, contact, meetings, waiting, agents, app }) {
  const toast = useToast();
  const scrollRef = useRef(null);
  const msgs = thread.messages ?? [];
  const isFresh = useFreshIds(msgs.map((m) => m.id));
  const count = msgs.length;
  const prevCount = useRef(count);
  const [closing, setClosing] = useState(false);
  const status = tagFor('thread', thread.status);
  const msgCount = msgs.filter((m) => m.kind === 'msg').length;
  const meetingsById = useMemo(() => Object.fromEntries(meetings.map((m) => [m.id, m])), [meetings]);

  // Open at the newest message; follow new ones as they arrive.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && count > prevCount.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    prevCount.current = count;
  }, [count]);

  const [close, closeBusy] = useAction(() => api.post(`/api/threads/${thread.id}/close`), {
    success: 'Thread closed. SDR won’t follow up.',
    onDone: () => setClosing(false),
  });

  const ownerName = thread.owner?.name;
  const pill = thread.status === 'escalated' && ownerName ? `Escalated · ${ownerName}` : ownerName && thread.status !== 'closed' ? `${status.label} · ${ownerName}` : status.label;

  return (
    <div className="cv-thread-inner">
      <div className="cv-thread-head">
        <div className="cv-thread-title">
          <span className="cv-subject">{thread.subject || 'No subject'}</span>
          <span className="cv-thread-meta">
            {plural(msgCount, 'message')} · started {formatDate(thread.startedAt)}
            {thread.externalThreadId && (
              <>
                {' '}
                · thread <span className="mono">{String(thread.externalThreadId).slice(0, 16)}</span>
              </>
            )}
          </span>
        </div>
        {thread.intent && <Tag kind="intent" value={thread.intent} className="tag-lg" />}
        <span className="cv-pill">
          <Dot color={STATUS_DOT[thread.status] ?? DOT.gray} />
          {pill}
        </span>
        {thread.status !== 'closed' && <IconButton icon={Archive} label="Close thread" onClick={() => setClosing(true)} />}
      </div>

      <div className="cv-messages" ref={scrollRef}>
        {msgs.length === 0 && <EmptyState compact title="No messages in this thread yet." />}
        {msgs.map((m) => {
          const fresh = isFresh(m.id);
          if (m.kind === 'event') return <EventLine key={m.id} event={m} agents={agents} fresh={fresh} />;
          if (m.kind === 'meeting') return <MeetingCard key={m.id} meeting={meetingsById[m.meetingId]} contact={contact} app={app} fresh={fresh} />;
          return <Message key={m.id} message={m} agents={agents} fresh={fresh} />;
        })}
      </div>

      {waiting.length > 0 && thread.status !== 'closed' && (
        <a href={`#/approvals/${waiting[0].id}`} className="cv-waiting">
          <span>
            <b>{agentName(agents.byId, waiting[0].agentId) || 'SDR'} drafted a {waiting[0].kind === 'meeting' ? 'meeting invite' : 'reply'}.</b> It’s waiting for your approval.
          </span>
          <span className="cv-waiting-cta">Review →</span>
        </a>
      )}

      <Composer thread={thread} contact={contact} app={app} toast={toast} />

      <ConfirmDialog
        open={closing}
        onClose={() => setClosing(false)}
        onConfirm={() => close()}
        busy={closeBusy}
        title="Close this thread?"
        description={`SDR stops following up with ${contact?.name ?? 'this contact'} and any drafts for this thread are withdrawn.`}
        confirmLabel="Close thread"
      />
    </div>
  );
}

function Message({ message: m, agents, fresh }) {
  const out = m.direction === 'out';
  const by = m.by ?? (out ? (m.agentId ? `sent by ${agentName(agents.byId, m.agentId)}` : 'sent by you') : m.fromEmail);
  return (
    <div className={['cv-msg', out ? 'out' : 'in', fresh && 'cv-enter'].filter(Boolean).join(' ')}>
      <div className="cv-msg-head">
        <span className="cv-msg-from">{m.from ?? (out ? 'You' : 'Them')}</span>
        {by && <span className="cv-msg-by">{by}</span>}
        <span className="cv-msg-time">{formatDateTime(m.at)}</span>
      </div>
      <div className="cv-msg-body">{m.body || m.text}</div>
    </div>
  );
}

function EventLine({ event: m, agents, fresh }) {
  return (
    <div className={fresh ? 'cv-event cv-enter' : 'cv-event'}>
      <span className="cv-event-rule" />
      {m.agentId ? <Mono size="xs">{agentMono(agents.byId, m.agentId)}</Mono> : <span className="cv-you">You</span>}
      <span className="cv-event-text">{m.text}</span>
      <span className="cv-event-time">{formatDateTime(m.at)}</span>
      <span className="cv-event-rule" />
    </div>
  );
}

function MeetingCard({ meeting, contact, app, fresh }) {
  if (!meeting) return null;
  const tz = contact?.timezone;
  const t = tagFor('meeting', meeting.status);
  const dead = meeting.status === 'declined' || meeting.status === 'cancelled';
  const who = [contact?.name, app.workspace?.owner?.name].filter(Boolean).join(', ');
  let where = null;
  if (meeting.link) {
    try {
      const host = new URL(meeting.link).hostname.replace(/^www\./, '');
      where = host.includes('meet.google') ? 'Google Meet' : host.includes('zoom') ? 'Zoom' : host;
    } catch {
      where = null;
    }
  }
  return (
    <div className={['cv-meeting', dead && 'dead', fresh && 'cv-enter'].filter(Boolean).join(' ')}>
      <span className="cv-meeting-date">
        <span className="cv-meeting-dow">{formatInZone(meeting.start, tz, { weekday: 'short' }).toUpperCase()}</span>
        <span className="cv-meeting-day">{formatInZone(meeting.start, tz, { day: 'numeric' })}</span>
      </span>
      <div className="cv-meeting-text">
        <span className="cv-meeting-title">
          {meeting.title || 'Meeting'} · {meeting.durationMin ?? 30} min
        </span>
        <span className="cv-meeting-meta">{[formatMeetingRange(meeting.start, meeting.durationMin, tz), who, where].filter(Boolean).join(' · ')}</span>
      </div>
      <span className="cv-meeting-status">
        <Dot color={DOT[t.color]} />
        {t.label}
      </span>
    </div>
  );
}

function Composer({ thread, contact, app, toast }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef(null);
  useAutosize(ref, text, 40);
  const owner = thread.owner;
  const me = app.workspace?.owner?.name ?? 'you';

  const [take, taking] = useAction(() => api.post(`/api/threads/${thread.id}/take`), {
    success: 'You own this thread. SDR won’t reply until you hand it back.',
    onDone: () => setTimeout(() => ref.current?.focus(), 50),
  });
  const [handBack, handing] = useAction(() => api.post(`/api/threads/${thread.id}/handback`), {
    success: 'SDR has the thread again.',
  });

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await api.post(`/api/threads/${thread.id}/reply`, { body });
      setText('');
      toast(`Sending your reply to ${contact?.firstName || contact?.name || 'them'}.`, { tone: 'success' });
    } catch (err) {
      toast(err?.message ?? 'Couldn’t send that reply.', { tone: 'error', duration: 6000 });
    } finally {
      setSending(false);
    }
  };

  if (thread.status === 'closed') {
    return (
      <div className="cv-composer">
        <div className="cv-composer-row">
          <span className="cv-composer-note">This thread is closed. SDR won’t follow up or reply here.</span>
        </div>
      </div>
    );
  }

  if (!owner) {
    return (
      <div className="cv-composer">
        <div className="cv-composer-row">
          <Button onClick={() => take()} loading={taking}>
            Take over
          </Button>
          <span className="cv-composer-note">SDR answers this thread. Take over to reply yourself.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="cv-composer">
      <textarea
        ref={ref}
        className="input textarea cv-reply"
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            send();
          }
        }}
        placeholder={`Reply as ${owner.name ?? me}…`}
        aria-label="Reply"
      />
      <div className="cv-composer-row">
        <Button onClick={send} loading={sending} disabled={!text.trim()}>
          Send reply
        </Button>
        <Button variant="outline" onClick={() => handBack()} loading={handing}>
          Hand back to SDR
        </Button>
        <span className="cv-composer-note cv-composer-right">SDR won’t reply while you own this thread.</span>
      </div>
    </div>
  );
}

function ContactCard({ contact, account, now }) {
  if (!contact) {
    return (
      <div className="cv-block">
        <span className="muted small">This contact was removed.</span>
      </div>
    );
  }
  const tz = contact.timezone;
  const local = tz ? `${formatInZone(now, tz, { hour: 'numeric', minute: '2-digit' })} ${zoneLabel(tz)}` : '—';
  return (
    <div className="cv-block">
      <div className="cv-person">
        <Avatar initials={initials(contact.name)} size={36} />
        <div className="cv-person-text">
          <span className="cv-person-name">{contact.name}</span>
          <span className="cv-person-title">{contact.title || '—'}</span>
        </div>
      </div>
      <div className="cv-kv">
        <span className="muted">Company</span>
        {account ? (
          <a href={`#/accounts/${account.id}`} className="quiet-link">
            {account.name}
          </a>
        ) : (
          <span>—</span>
        )}
        <span className="muted">Email</span>
        <span className="cv-kv-mono">{contact.email ?? '—'}</span>
        <span className="muted">Status</span>
        <span>
          <Tag kind="email" value={contact.emailStatus ?? 'unknown'} />
        </span>
        <span className="muted">Local time</span>
        <span className="mono">{local}</span>
        <span className="muted">Score</span>
        <span className="mono">{contact.score ?? '—'}</span>
      </div>
    </div>
  );
}

function OwnerBlock({ thread, agents }) {
  const owner = thread.owner;
  const esc = thread.escalation;
  return (
    <div className="cv-block">
      <span className="cv-block-title">Owner</span>
      {owner ? (
        <>
          <div className="cv-owner">
            <Avatar initials={owner.initials ?? initials(owner.name)} size={28} solid />
            <div className="cv-owner-text">
              <span className="cv-owner-name">{owner.name}</span>
              <span className="cv-owner-sub">{esc ? `Escalated by SDR · ${formatDateTime(esc.at)}` : 'Took over from SDR'}</span>
            </div>
          </div>
          {esc?.reason && <span className="cv-reason">Reason: {esc.reason}</span>}
        </>
      ) : (
        <div className="cv-owner">
          <Mono size="md">{agentMono(agents.byId, 'sdr')}</Mono>
          <div className="cv-owner-text">
            <span className="cv-owner-name">{agentName(agents.byId, 'sdr') || 'SDR'}</span>
            <span className="cv-owner-sub">{thread.status === 'closed' ? 'Thread closed' : 'Answers and books meetings on its own'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function MeetingsBlock({ meetings, tz }) {
  const sorted = [...meetings].sort((a, b) => String(b.start).localeCompare(String(a.start)));
  return (
    <div className="cv-block cv-block-last">
      <span className="cv-block-title">Meetings</span>
      {sorted.length === 0 ? (
        <span className="cv-reason">None yet. SDR proposes times when they ask for a call.</span>
      ) : (
        sorted.map((m) => {
          const t = tagFor('meeting', m.status);
          const dead = m.status === 'declined' || m.status === 'cancelled';
          const when = `${formatInZone(m.start, tz, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ${zoneLabel(tz, new Date(m.start))}`;
          return (
            <div key={m.id} className={dead ? 'cv-mtg dead' : 'cv-mtg'}>
              <span className="cv-mtg-when">
                <Dot color={DOT[t.color]} />
                {t.label} · {when}
              </span>
              {m.title && <span className="cv-mtg-sub">{m.title}</span>}
            </div>
          );
        })
      )}
    </div>
  );
}
