import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../components/feedback.jsx';
import { Avatar, Tag } from '../../components/ui.jsx';
import { initials } from '../../lib/format.js';
import { agentName, formatDayTimeInZone, formatMeetingRange, useAutosize, zoneLabel } from '../sales-shared.jsx';
import { kindLabel } from './labels.js';

const COLD = new Set(['first_touch', 'follow_up']);

function countWords(text) {
  const t = String(text ?? '').trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * The draft as an email: header, From/To, editable subject and body. Edits save on their
 * own after a short pause. The parent calls flush() before approving and cancel() before
 * rejecting.
 */
export const EmailEditor = forwardRef(function EmailEditor({ approval: a, readOnly, agents, sequence, now }, ref) {
  const toast = useToast();
  const original = a.original ?? { subject: a.subject, body: a.body };
  const [subject, setSubject] = useState(a.subject ?? '');
  const [body, setBody] = useState(a.body ?? '');
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef(null);
  const latest = useRef({ subject, body });
  latest.current = { subject, body };
  const pendingPatch = useRef(null);
  const timer = useRef(null);
  const chain = useRef(Promise.resolve(true));

  useAutosize(bodyRef, body, 280);

  const send = () => {
    clearTimeout(timer.current);
    timer.current = null;
    const patch = pendingPatch.current;
    pendingPatch.current = null;
    if (!patch) return chain.current;
    setSaving(true);
    chain.current = chain.current.then(() =>
      api.patch(`/api/approvals/${a.id}`, patch).then(
        () => true,
        (err) => {
          toast(err?.message ?? 'Couldn’t save your edit.', { tone: 'error', duration: 6000 });
          return false;
        },
      ),
    );
    const mine = chain.current;
    mine.finally(() => {
      if (chain.current === mine) setSaving(false);
    });
    return mine;
  };

  const schedule = (patch) => {
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    if (patch.body !== undefined && !String(patch.body).trim()) {
      // The server refuses an empty body; keep the subject change and wait for text.
      delete pendingPatch.current.body;
      if (!Object.keys(pendingPatch.current).length) pendingPatch.current = null;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(send, 500);
  };

  useImperativeHandle(ref, () => ({
    async flush() {
      if (!latest.current.body.trim()) {
        toast('The message can’t be empty.', { tone: 'error' });
        bodyRef.current?.focus();
        return false;
      }
      return send();
    },
    cancel() {
      clearTimeout(timer.current);
      pendingPatch.current = null;
    },
    focusBody() {
      const el = bodyRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
  }));

  // Save anything still waiting when the item changes.
  useEffect(
    () => () => {
      if (pendingPatch.current) send();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const edited = subject !== original.subject || body !== original.body;
  const restore = () => {
    setSubject(original.subject ?? '');
    setBody(original.body ?? '');
    schedule({ subject: original.subject ?? '', body: original.body ?? '' });
  };

  const c = a.contact ?? {};
  const tz = c.timezone;
  const city = c.location ? String(c.location).split(',')[0].trim() : '';
  const where = [city, zoneLabel(tz)].filter(Boolean).join(', ');
  const kind = kindLabel(a);
  const from = a.from ?? {};
  const author = agentName(agents, a.agentId) || 'Personalizer';

  const step = Number(a.step) || 1;
  const total = Number(a.sequenceSteps ?? sequence?.steps) || null;
  const days = Number(sequence?.days) || null;
  const sendAt = a.sendAt ? new Date(a.sendAt).getTime() : null;

  let sends;
  if (a.kind === 'meeting') sends = 'Invite goes out as soon as you approve';
  else if (COLD.has(a.kind) && sendAt && sendAt > now + 60_000) sends = `Sends ${formatDayTimeInZone(a.sendAt, tz)} in their time zone`;
  else sends = 'Sends as soon as you approve';

  let followUp = null;
  if (COLD.has(a.kind) && total) {
    if (step < total) followUp = `Follow-up ${step + 1} of ${total} scheduled ${days ? `${days} ${days === 1 ? 'day' : 'days'} later` : 'later'} if no reply`;
    else if (total > 1) followUp = 'Last step in the sequence';
  }

  return (
    <div className="ap-email">
      <div className="ap-person">
        <Avatar initials={c.initials ?? initials(c.name)} size={40} />
        <div className="ap-person-text">
          <div className="ap-person-line">
            <span className="ap-person-name">{c.name ?? 'Unknown contact'}</span>
            <span className="ap-person-role">
              {c.title}
              {c.title && a.account ? ' · ' : ''}
              {a.account && (
                <a href={`#/accounts/${a.account.id}`} className="quiet-link">
                  {a.account.name}
                </a>
              )}
            </span>
          </div>
          <div className="ap-person-meta">
            {c.email && <span>{c.email}</span>}
            {c.emailStatus && <Tag kind="email" value={c.emailStatus} />}
            {where && (
              <>
                <span>·</span>
                <span>{where}</span>
              </>
            )}
          </div>
        </div>
        <Tag color={kind.color} className="tag-lg">
          {kind.label}
        </Tag>
      </div>

      <div className="ap-card">
        <div className="ap-field">
          <span className="ap-field-label">From</span>
          <span className="ap-field-value">
            {from.name || from.email ? (
              <>
                {from.name} {from.email && <>&lt;{from.email}&gt;</>} {from.via && <span className="muted">via {from.via}</span>}
              </>
            ) : (
              <span className="muted">Set a sender in Settings</span>
            )}
          </span>
        </div>
        <div className="ap-field">
          <span className="ap-field-label">To</span>
          <span className="ap-field-value">
            {c.name} {c.email && <>&lt;{c.email}&gt;</>}
          </span>
        </div>
        {a.meeting && (
          <div className="ap-field">
            <span className="ap-field-label">Invite</span>
            <span className="ap-field-value ap-invite">
              <CalendarDays size={14} />
              <span>
                <b>{formatMeetingRange(a.meeting.start, a.meeting.durationMin, tz)}</b>
                {a.meeting.title && <span className="muted"> · {a.meeting.title}</span>}
              </span>
            </span>
          </div>
        )}
        <label className="ap-field ap-field-subject">
          <span className="ap-field-label">Subject</span>
          <input
            className="ap-subject"
            value={subject}
            readOnly={readOnly}
            onChange={(e) => {
              setSubject(e.target.value);
              schedule({ subject: e.target.value });
            }}
            aria-label="Subject"
          />
        </label>
        <textarea
          ref={bodyRef}
          className="ap-body"
          value={body}
          readOnly={readOnly}
          onChange={(e) => {
            setBody(e.target.value);
            schedule({ body: e.target.value });
          }}
          aria-label="Message"
          spellCheck
        />
      </div>

      <div className="ap-note-line">
        {edited ? (
          <span className="ap-edited">
            Edited by you · original draft kept
            {!readOnly && (
              <button type="button" className="ap-inline-btn" onClick={restore}>
                Restore original
              </button>
            )}
          </span>
        ) : (
          <span>
            Draft by {author} · {countWords(body)} words
          </span>
        )}
        {saving && <span className="ap-saving">Saving</span>}
        {!readOnly && (
          <>
            <span>·</span>
            <span>{sends}</span>
          </>
        )}
        {!readOnly && followUp && (
          <>
            <span>·</span>
            <span>{followUp}</span>
          </>
        )}
      </div>
    </div>
  );
});
