import { useCallback, useEffect, useRef, useState } from 'react';
import { Inbox } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app-context.jsx';
import { useNow, useResource } from '../lib/live.js';
import { formatDateTime, plural } from '../lib/format.js';
import { useToast } from '../components/feedback.jsx';
import { Button, EmptyState, ErrorState, Segmented } from '../components/ui.jsx';
import { DetailSkeleton, agentName, dialogOpen, formatDayTimeInZone, isTyping, thresholds, useAgents, useFreshIds, useHashSelection } from './sales-shared.jsx';
import { ApprovalList } from './approvals/ApprovalList.jsx';
import { EmailEditor } from './approvals/EmailEditor.jsx';
import { ApprovalSide } from './approvals/ApprovalSide.jsx';
import { RejectPanel } from './approvals/RejectPanel.jsx';
import { TradeDetail, TradeSide } from './approvals/TradeApproval.jsx';
import { kindNoun, statusTag, titleOf } from './approvals/labels.js';
import './approvals.css';

const LEAVE_MS = 240;
const EMPTY_NOTE = { reason: '', tags: [] };

export default function Approvals({ selectedId }) {
  const app = useApp();
  const toast = useToast();
  const now = useNow(30_000);
  const { byId, config } = useAgents();
  const markets = app.playbook?.id === 'markets';

  const [tab, setTab] = useState('pending');
  const [selId, select] = useHashSelection('approvals', selectedId);
  const pendingRes = useResource('/api/approvals?status=pending', ['approvals']);
  // One resource per history tab, so switching tabs never shows the other tab's rows.
  const approvedRes = useResource('/api/approvals?status=approved&limit=100', ['approvals'], { enabled: tab === 'approved' });
  const rejectedRes = useResource('/api/approvals?status=rejected&limit=100', ['approvals'], { enabled: tab === 'rejected' });
  const historyRes = tab === 'rejected' ? rejectedRes : approvedRes;

  const [gone, setGone] = useState(() => new Set());
  const [leaving, setLeaving] = useState(() => new Set());
  const [checked, setChecked] = useState(() => new Set());
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState(EMPTY_NOTE);
  const [bulkBusy, setBulkBusy] = useState(false);
  const editorRef = useRef(null);
  const lastIndex = useRef(0);
  const timers = useRef(new Map());

  const pendingAll = (pendingRes.data?.approvals ?? []).filter((a) => !gone.has(a.id));
  const listAll = tab === 'pending' ? pendingAll : historyRes.data?.approvals ?? [];
  const items = listAll.filter((a) => !leaving.has(a.id));
  const res = tab === 'pending' ? pendingRes : historyRes;
  const loading = !res.data && !res.error;
  const isFresh = useFreshIds(
    listAll.map((a) => a.id),
    !!res.data,
  );

  const counts = pendingRes.data?.counts ?? {};
  const pendingCount = pendingRes.data ? pendingAll.filter((a) => !leaving.has(a.id)).length : counts.pending;

  let index = items.findIndex((a) => a.id === selId);
  if (index < 0 && items.length) index = Math.min(lastIndex.current, items.length - 1);
  const current = index >= 0 ? items[index] : null;
  useEffect(() => {
    if (index >= 0) lastIndex.current = index;
  });

  // A link to an item that was already handled opens the tab it lives in.
  const resolved = useRef(false);
  useEffect(() => {
    if (resolved.current || !pendingRes.data) return;
    resolved.current = true;
    if (!selId || pendingAll.some((a) => a.id === selId)) return;
    api
      .get(`/api/approvals/${selId}`)
      .then(({ approval }) => {
        if (approval.status === 'rejected') setTab('rejected');
        else if (approval.status !== 'pending') setTab('approved');
      })
      .catch(() => {});
  }, [pendingRes.data, selId, pendingAll]);

  // New selection: close the reject note.
  const currentId = current?.id;
  useEffect(() => {
    setRejecting(false);
    setNote(EMPTY_NOTE);
  }, [currentId]);

  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  const switchTab = (next) => {
    if (next === tab) return;
    setTab(next);
    setChecked(new Set());
    lastIndex.current = 0;
    select(null);
  };

  const removeIds = (ids) => {
    setLeaving((s) => new Set([...s, ...ids]));
    for (const id of ids) {
      clearTimeout(timers.current.get(id));
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          setGone((s) => new Set([...s, id]));
          setLeaving((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          });
        }, LEAVE_MS),
      );
    }
  };

  const restoreIds = (ids) => {
    for (const id of ids) {
      clearTimeout(timers.current.get(id));
      timers.current.delete(id);
    }
    const drop = (s) => {
      const n = new Set(s);
      ids.forEach((id) => n.delete(id));
      return n;
    };
    setGone(drop);
    setLeaving(drop);
  };

  // The item to land on after `ids` leave: the next one down, else the one above.
  const neighbor = (ids) => {
    const out = new Set(ids);
    for (let i = index + 1; i < items.length; i++) if (!out.has(items[i].id)) return items[i];
    for (let i = index - 1; i >= 0; i--) if (!out.has(items[i].id)) return items[i];
    return null;
  };

  const leaveTo = (ids) => {
    if (current && ids.includes(current.id)) {
      const next = neighbor(ids);
      lastIndex.current = Math.max(0, index);
      select(next?.id ?? null);
    }
    setChecked((s) => {
      const n = new Set(s);
      ids.forEach((id) => n.delete(id));
      return n;
    });
    removeIds(ids);
  };

  const approvedMessage = (a) => {
    const name = a.contact?.name ?? 'the contact';
    if (a.kind === 'trade') return 'Trade approved.';
    if (a.kind === 'meeting') return `Approved. Invite going to ${name}.`;
    const at = a.sendAt ? new Date(a.sendAt).getTime() : 0;
    if ((a.kind === 'first_touch' || a.kind === 'follow_up') && at > Date.now() + 60_000) {
      return `Approved. Sends to ${name} ${formatDayTimeInZone(a.sendAt, a.contact?.timezone)} their time.`;
    }
    return `Approved. Sending to ${name} now.`;
  };

  const approve = async () => {
    const a = current;
    if (!a || tab !== 'pending' || a.status !== 'pending') return;
    const ok = (await editorRef.current?.flush?.()) ?? true;
    if (ok === false) return;
    leaveTo([a.id]);
    try {
      await api.post(`/api/approvals/${a.id}/approve`);
      toast(approvedMessage(a), { tone: 'success' });
    } catch (err) {
      if (err?.status !== 409) restoreIds([a.id]);
      toast(err?.message ?? 'Couldn’t approve this item.', { tone: 'error', duration: 6000 });
    }
  };

  const confirmReject = async () => {
    const a = current;
    if (!a || tab !== 'pending') return;
    editorRef.current?.cancel?.();
    const body = { reason: note.reason.trim(), tags: note.tags };
    leaveTo([a.id]);
    try {
      await api.post(`/api/approvals/${a.id}/reject`, body);
      const author = agentName(byId, a.agentId) || (a.kind === 'trade' ? 'The agent' : 'Personalizer');
      toast(body.reason || body.tags.length ? `Rejected. ${author} will use your note.` : 'Rejected.', { tone: 'success' });
    } catch (err) {
      if (err?.status !== 409) restoreIds([a.id]);
      toast(err?.message ?? 'Couldn’t reject this item.', { tone: 'error', duration: 6000 });
    }
  };

  const bulkApprove = async () => {
    const ids = items.filter((a) => checked.has(a.id)).map((a) => a.id);
    if (!ids.length) return;
    if (current && ids.includes(current.id)) {
      const ok = (await editorRef.current?.flush?.()) ?? true;
      if (ok === false) return;
    }
    setBulkBusy(true);
    leaveTo(ids);
    try {
      const r = await api.post('/api/approvals/approve', { ids });
      const n = r?.approved?.length ?? ids.length;
      const skipped = ids.length - n;
      toast(`Approved ${plural(n, 'item')}.${skipped ? ` ${skipped} ${skipped === 1 ? 'was' : 'were'} already handled.` : ''}`, { tone: 'success' });
    } catch (err) {
      restoreIds(ids);
      toast(err?.message ?? 'Couldn’t approve these items.', { tone: 'error', duration: 6000 });
    } finally {
      setBulkBusy(false);
    }
  };

  const toggle = useCallback((id) => {
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const move = (delta) => {
    if (!items.length) return;
    const next = items[Math.max(0, Math.min(items.length - 1, (index < 0 ? 0 : index) + delta))];
    if (next) select(next.id);
  };

  const startReject = () => {
    if (current && tab === 'pending') setRejecting(true);
  };

  const cancelReject = () => {
    setRejecting(false);
  };

  // Shortcuts read the latest handlers through a ref so the listener binds once.
  const keys = useRef({});
  keys.current = {
    move,
    approve,
    confirmReject,
    startReject,
    cancelReject,
    rejecting,
    pending: tab === 'pending',
    toggleCurrent: () => current && tab === 'pending' && toggle(current.id),
    edit: () => current && tab === 'pending' && editorRef.current?.focusBody?.(),
  };
  useEffect(() => {
    const onKey = (e) => {
      if (dialogOpen()) return;
      const k = keys.current;
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (!k.pending) return;
        e.preventDefault();
        if (k.rejecting) k.confirmReject();
        else k.approve();
        return;
      }
      if (e.key === 'Escape') {
        if (isTyping(e.target)) e.target.blur();
        if (k.rejecting) k.cancelReject();
        return;
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'j') k.move(1);
      else if (key === 'k') k.move(-1);
      else if (key === 'x') k.toggleCurrent();
      else if (key === 'e') k.edit();
      else if (key === 'r') k.startReject();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const autonomy = app.playbook?.autonomy?.find((x) => x.id === app.workspace?.autonomy);
  const personalizer = byId.personalizer;
  const queued = personalizer?.queued ?? 0;
  const outreachAt = thresholds(config('qualifier')).outreach;
  const pConfig = config('personalizer');
  const sequence = { steps: pConfig.sequenceSteps, days: pConfig.daysBetween };

  const showEmpty = tab === 'pending' && pendingRes.data && pendingAll.length === 0;

  return (
    <div className="page ap-page">
      <header className="page-header">
        <div className="page-header-text">
          <h1>Approvals</h1>
          <div className="page-sub ap-sub">
            {autonomy && (
              <>
                Autonomy is set to <b>{autonomy.label}</b>.{' '}
              </>
            )}
            {markets
              ? 'Trades wait here. Nothing is placed until you approve it.'
              : autonomy?.id === 'review_first_touch'
                ? 'First emails to each person wait here. Follow-ups and replies go out on their own.'
                : autonomy?.id === 'autopilot'
                  ? 'Nothing waits for review. Anything an agent can’t decide still comes here.'
                  : 'Emails, replies and meeting invites wait here. Nothing is sent until you approve it.'}
          </div>
        </div>
        <Segmented
          size="md"
          label="Approval status"
          value={tab}
          onChange={switchTab}
          options={[
            { value: 'pending', label: 'Pending', count: pendingCount ?? '' },
            { value: 'approved', label: 'Approved', count: counts.approved ?? '' },
            { value: 'rejected', label: 'Rejected', count: counts.rejected ?? '' },
          ]}
        />
      </header>

      {res.error && !res.data ? (
        <ErrorState error={res.error} onRetry={res.refresh} />
      ) : showEmpty ? (
        <EmptyState
          icon={Inbox}
          title="You’re all caught up"
          actions={
            <a href="#/control-room" className="ap-back">
              Back to control room
            </a>
          }
        >
          {markets
            ? 'When an agent proposes a trade, it waits here for you before anything is placed.'
            : `When Personalizer writes a draft or SDR prepares a reply, it waits here for you. ${
                queued ? `Personalizer has ${plural(queued, 'account')} in its queue.` : 'Personalizer’s queue is empty right now.'
              }`}
        </EmptyState>
      ) : (
        <div className="ap-grid">
          <ApprovalList
            tab={tab}
            items={items}
            all={listAll}
            loading={loading}
            selectedId={current?.id}
            checked={checked}
            leaving={leaving}
            isFresh={isFresh}
            now={now}
            onSelect={select}
            onToggle={toggle}
            onToggleAll={(on) => setChecked(on ? new Set(items.map((a) => a.id)) : new Set())}
            onBulkApprove={bulkApprove}
            bulkBusy={bulkBusy}
          />

          <section className="ap-center">
            {loading ? (
              <DetailSkeleton />
            ) : !current ? null : (
              <>
                <div className="ap-scroll" key={current.id}>
                  {tab !== 'pending' && <Decision approval={current} />}
                  {current.kind === 'trade' ? (
                    <TradeDetail approval={current} />
                  ) : (
                    <EmailEditor ref={editorRef} approval={current} readOnly={tab !== 'pending'} agents={byId} sequence={sequence} now={now} />
                  )}
                  {rejecting && (
                    <RejectPanel
                      trade={current.kind === 'trade'}
                      author={agentName(byId, current.agentId) || 'The agent'}
                      note={note}
                      onChange={setNote}
                      onCancel={cancelReject}
                    />
                  )}
                </div>
                <div className="ap-actions">
                  {tab === 'pending' ? (
                    <>
                      <Button onClick={approve}>{current.kind === 'trade' ? 'Approve trade' : 'Approve and send'}</Button>
                      {current.kind !== 'trade' && (
                        <Button variant="outline" onClick={() => editorRef.current?.focusBody?.()}>
                          Edit
                        </Button>
                      )}
                      {rejecting ? (
                        <Button variant="destructive" onClick={confirmReject}>
                          Confirm reject
                        </Button>
                      ) : (
                        <Button variant="ghost" onClick={startReject}>
                          Reject with note
                        </Button>
                      )}
                    </>
                  ) : (
                    <span className="ap-actions-note">
                      {current.status === 'rejected' ? 'Rejected items stay here for reference.' : 'Approved items can’t be edited.'}
                    </span>
                  )}
                  <span className="ap-position">
                    {index + 1} of {items.length}
                  </span>
                </div>
              </>
            )}
          </section>

          <aside className="ap-side">
            {current && !loading && (
              <div className="ap-side-inner" key={current.id}>
                {current.kind === 'trade' ? <TradeSide approval={current} /> : <ApprovalSide approval={current} outreachAt={outreachAt} />}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function Decision({ approval: a }) {
  const t = statusTag(a);
  const when = formatDateTime(a.sentAt ?? a.decidedAt);
  let text;
  if (a.status === 'rejected') {
    const why = [a.rejectTags?.length ? a.rejectTags.join(', ') : null, a.rejectReason ? `“${a.rejectReason}”` : null].filter(Boolean).join(' · ');
    text = `You rejected this ${kindNoun(a)} on ${when}.${why ? ` ${why}` : ' No note left.'}`;
  } else if (a.status === 'failed') {
    text = `Approved ${formatDateTime(a.decidedAt)}, but sending failed${a.error ? `: ${a.error.message ?? a.error}` : '.'}`;
  } else if (a.status === 'sent') {
    text = `${a.kind === 'trade' ? 'Placed' : 'Sent'} ${when}${a.autoApproved ? ' · approved automatically' : ''}.`;
  } else {
    const at = a.sendAt ? new Date(a.sendAt).getTime() : 0;
    text = `${a.autoApproved ? 'Approved automatically' : 'Approved'} ${formatDateTime(a.decidedAt)}.${
      at > Date.now() ? ` Sends ${formatDayTimeInZone(a.sendAt, a.contact?.timezone)} their time.` : ' Waiting to send.'
    }`;
  }
  return (
    <div className={`ap-decided ap-decided-${t.color}`}>
      <span className={`tag tag-${t.color}`}>{t.label}</span>
      <span>{text}</span>
      <span className="sr-only">{titleOf(a)}</span>
    </div>
  );
}
