// Right column of the sales control room: Waiting on you, Meetings.
import { useApp } from '../../lib/app-context.jsx';
import { useResource } from '../../lib/live.js';
import { tagFor } from '../../lib/tags.js';
import { formatAgoLong, formatTime } from '../../lib/format.js';
import { Skeleton } from '../../components/ui.jsx';
import { formatInZone } from '../sales-shared.jsx';
import { kindLabel } from '../approvals/labels.js';
import './sales-side.css';

export function SalesSide({ approvals = [], now }) {
  return (
    <>
      <WaitingPanel approvals={approvals} now={now} />
      <MeetingsPanel />
    </>
  );
}

function waitingWhat(a) {
  const kind = kindLabel(a).label;
  if (a.kind === 'meeting' && a.meeting?.start) {
    const when = formatInZone(a.meeting.start, a.contact?.timezone, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return `${kind} · ${when}`;
  }
  return a.subject ? `${kind} · “${a.subject}”` : kind;
}

function WaitingPanel({ approvals, now }) {
  const top = approvals.slice(0, 4);
  return (
    <section className="panel ss-panel">
      <div className="panel-head">
        <h2>Waiting on you</h2>
        <a href="#/approvals" className="panel-link">
          Open inbox →
        </a>
      </div>
      {top.length === 0 ? (
        <div className="ss-empty">Nothing to review. Drafts show up here before anything is sent.</div>
      ) : (
        <div className="ss-rows">
          {top.map((a) => (
            <a key={a.id} href={`#/approvals/${a.id}`} className="ss-wait">
              <span className="ss-wait-top">
                <span className="ss-wait-who">{[a.contact?.name, a.account?.name].filter(Boolean).join(' · ') || a.subject}</span>
                <span className="ss-age">{formatAgoLong(a.createdAt, now)}</span>
              </span>
              <span className="ss-wait-what">{waitingWhat(a)}</span>
            </a>
          ))}
          {approvals.length > top.length && (
            <a href="#/approvals" className="ss-more">
              {approvals.length - top.length} more waiting
            </a>
          )}
        </div>
      )}
    </section>
  );
}

function MeetingsPanel() {
  const { connections } = useApp();
  const { data } = useResource('/api/meetings?upcoming=1', ['meetings']);
  const meetings = (data?.meetings ?? []).filter((m) => m.status !== 'cancelled' && m.status !== 'declined');
  const calendar = connections.find((c) => (c.capabilities ?? []).some((k) => k.startsWith('calendar.')));

  return (
    <section className="panel ss-panel">
      <div className="panel-head">
        <h2>Meetings</h2>
        <span className="ss-hint">{calendar ? calendar.label : 'Booking link'}</span>
      </div>
      {!data ? (
        <div className="ss-rows">
          {[0, 1].map((i) => (
            <div key={i} className="ss-meeting">
              <Skeleton width={52} height={44} radius={6} />
              <div className="ss-meeting-text">
                <Skeleton width="60%" height={12} />
                <Skeleton width="80%" height={10} />
              </div>
              <Skeleton width={56} height={12} />
            </div>
          ))}
        </div>
      ) : meetings.length === 0 ? (
        <div className="ss-empty">
          {calendar
            ? 'No meetings yet. SDR books them on your calendar when a prospect says yes.'
            : 'No meetings yet. SDR sends your booking link when a prospect says yes.'}
        </div>
      ) : (
        <div className="ss-rows">
          {meetings.slice(0, 5).map((m) => {
            const d = new Date(m.start);
            const status = tagFor('meeting', m.status);
            const href = m.threadId ? `#/conversations/${m.threadId}` : m.account?.id ? `#/accounts/${m.account.id}` : null;
            const Row = href ? 'a' : 'div';
            return (
              <Row key={m.id} href={href ?? undefined} className="ss-meeting">
                <span className="ss-date">
                  <span className="ss-dow">{d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</span>
                  <span className="ss-day">{d.getDate()}</span>
                </span>
                <span className="ss-meeting-text">
                  <span className="ss-meeting-who">{m.contact?.name ?? m.title}</span>
                  <span className="ss-meeting-co">{[m.account?.name, m.contact?.title].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="ss-meeting-when">
                  <span className="ss-time">{formatTime(m.start)}</span>
                  <span className="ss-status">{status.label}</span>
                </span>
              </Row>
            );
          })}
        </div>
      )}
    </section>
  );
}
