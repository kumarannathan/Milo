import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app-context.jsx';
import { useNow, useResource } from '../lib/live.js';
import { DOT, tagFor } from '../lib/tags.js';
import { formatDate, formatDateTime, formatNumber, formatShort, formatTime, plural } from '../lib/format.js';
import { Dialog, useAction } from '../components/feedback.jsx';
import { Button, Dot, EmptyState, ErrorState, Field, Mono, Skeleton, SkeletonRows, Tag, Textarea } from '../components/ui.jsx';
import { CompanyMark, ScoreBars, ScoreTotal, SourceLink, agentMono, agentName, sourceHref, sourceLabel, thresholds, useAgents, useFreshIds } from './sales-shared.jsx';
import './account-detail.css';

const CRM_NAMES = { hubspot: 'HubSpot', salesforce: 'Salesforce', pipedrive: 'Pipedrive', attio: 'Attio', close: 'Close' };

function crmName(system) {
  if (!system) return 'CRM';
  return CRM_NAMES[String(system).toLowerCase()] ?? system;
}

export default function AccountDetail({ id }) {
  const res = useResource(`/api/accounts/${id}`, ['accounts', 'contacts', 'approvals', 'threads', 'meetings', 'activity']);
  const app = useApp();
  const now = useNow(30_000);
  const agents = useAgents();

  if (res.error && !res.data) {
    return (
      <div className="page">
        <Crumbs name="Not found" />
        {res.error.status === 404 ? (
          <EmptyState title="This account isn’t here" actions={<a href="#/accounts">Back to accounts</a>}>
            It may have been removed, or the link is out of date.
          </EmptyState>
        ) : (
          <ErrorState error={res.error} onRetry={res.refresh} />
        )}
      </div>
    );
  }

  if (!res.data) return <DetailLoading />;

  const { account: a, contacts = [], approvals = [], threads = [], meetings = [], history = [] } = res.data;
  return (
    <div className="page ad-page">
      <Header account={a} app={app} agents={agents} />
      <div className="ad-body">
        <div className="ad-main">
          <BriefPanel account={a} agents={agents} />
          <ContactsPanel contacts={contacts} approvals={approvals} agents={agents} account={a} />
          <HistoryPanel history={history} threads={threads} approvals={approvals} agents={agents} now={now} />
        </div>
        <div className="ad-side">
          <ScorePanel account={a} agents={agents} />
          <SignalsPanel signals={a.signals ?? []} />
          {meetings.length > 0 && <MeetingsPanel meetings={meetings} contacts={contacts} />}
          <CrmPanel crm={a.crm} agents={agents} />
        </div>
      </div>
    </div>
  );
}

function Crumbs({ name }) {
  return (
    <nav className="crumbs ad-crumbs" aria-label="Breadcrumb">
      <a href="#/accounts">Accounts</a>
      <span>/</span>
      <span className="ad-crumb-current">{name}</span>
    </nav>
  );
}

function DetailLoading() {
  return (
    <div className="page ad-page">
      <header className="ad-header">
        <Skeleton width={160} height={14} />
        <div className="ad-title-row">
          <Skeleton width={48} height={48} radius={8} />
          <div className="ad-title-text">
            <Skeleton width={240} height={24} />
            <Skeleton width={360} height={12} />
          </div>
        </div>
        <Skeleton height={58} radius={8} />
      </header>
      <div className="ad-body">
        <div className="ad-main">
          <section className="panel">
            <SkeletonRows rows={6} />
          </section>
          <section className="panel">
            <SkeletonRows rows={3} />
          </section>
        </div>
        <div className="ad-side">
          <section className="panel">
            <SkeletonRows rows={5} />
          </section>
        </div>
      </div>
    </div>
  );
}

// ── Header ─────────────────────────────────────────────────────

function Header({ account: a, app, agents }) {
  const [disqualifying, setDisqualifying] = useState(false);
  const [research, researching] = useAction(() => api.post(`/api/accounts/${a.id}/research`), {
    success: `Researcher will rewrite the brief for ${a.name}.`,
  });
  const domainHref = a.domain ? `https://${a.domain.replace(/^https?:\/\//, '')}` : null;
  const found = a.foundBy === 'import' ? 'Imported from CSV' : `Found by ${agentName(agents.byId, a.foundBy) || 'Scout'}${a.foundVia ? ` via ${a.foundVia}` : ''}`;
  const crm = a.crm?.url ? a.crm : null;
  const owner = app.workspace?.owner?.name;

  const facts = [
    ['Industry', a.industry],
    ['Employees', a.employees != null ? formatNumber(a.employees) : null],
    ['HQ', a.location],
    ['Revenue (est.)', a.revenue],
    ['ICP match', a.icpMatch != null ? `${a.icpMatch}%` : null],
    ['Tech', a.tech?.length ? a.tech.join(', ') : null],
    ['Owner', owner],
  ];

  return (
    <header className="ad-header">
      <Crumbs name={a.name} />
      <div className="ad-title-row">
        <CompanyMark name={a.name} size="lg" />
        <div className="ad-title-text">
          <div className="ad-title-line">
            <h1>{a.name}</h1>
            <Tag kind="stage" value={a.stage} className="tag-lg" />
            <span className="ad-id">{a.id}</span>
          </div>
          <div className="ad-links">
            {domainHref && (
              <a href={domainHref} target="_blank" rel="noreferrer" className="ad-link-strong">
                {a.domain} ↗
              </a>
            )}
            {a.linkedin && (
              <>
                <span>·</span>
                <a href={a.linkedin} target="_blank" rel="noreferrer">
                  LinkedIn ↗
                </a>
              </>
            )}
            <span>·</span>
            <span>
              {found}
              {a.foundAt ? ` on ${formatDateTime(a.foundAt)}` : ''}
            </span>
          </div>
        </div>
        {a.stage !== 'disqualified' && (
          <>
            <Button variant="ghost" onClick={() => setDisqualifying(true)}>
              Disqualify
            </Button>
            <Button variant="outline" icon={RefreshCw} onClick={() => research()} loading={researching}>
              Re-run research
            </Button>
          </>
        )}
        {crm && (
          <a className="btn btn-primary" href={crm.url} target="_blank" rel="noreferrer">
            View in {crmName(crm.system)} ↗
          </a>
        )}
      </div>

      {a.stage === 'disqualified' && (
        <div className="ad-dq">
          <Dot color="var(--destructive)" />
          <span>
            <b>Disqualified.</b> {a.disqualifiedReason || 'No reason given.'} Agents don’t work on this account anymore.
          </span>
        </div>
      )}

      <div className="ad-facts">
        {facts.map(([k, v]) => (
          <div key={k} className="ad-fact">
            <span className="ad-fact-k">{k}</span>
            <span className={v ? 'ad-fact-v' : 'ad-fact-v muted'} title={v ?? undefined}>
              {v ?? '—'}
            </span>
          </div>
        ))}
      </div>

      <DisqualifyDialog open={disqualifying} account={a} onClose={() => setDisqualifying(false)} />
    </header>
  );
}

function DisqualifyDialog({ open, account, onClose }) {
  const [reason, setReason] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    setReason('');
    const t = setTimeout(() => ref.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);
  const [run, busy] = useAction((why) => api.post(`/api/accounts/${account.id}/disqualify`, { reason: why }), {
    success: `${account.name} disqualified.`,
    onDone: (r) => r && onClose(),
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Disqualify ${account.name}?`}
      description="Agents stop working on this account. Pending drafts for it are withdrawn and nothing more is sent."
      width={480}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => run(reason.trim())} loading={busy}>
            Disqualify
          </Button>
        </>
      }
    >
      <Field label="Reason" help="Shown on the account so everyone knows why it was dropped." optional>
        <Textarea
          ref={ref}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="e.g. Mostly cash-pay, little prior-auth volume."
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run(reason.trim());
          }}
        />
      </Field>
    </Dialog>
  );
}

// ── Research brief ─────────────────────────────────────────────

function BriefPanel({ account: a, agents }) {
  const b = a.brief;
  const researcher = agents.byId.researcher;
  return (
    <section className="panel">
      <div className="panel-head">
        <Mono size="sm">{agentMono(agents.byId, 'researcher')}</Mono>
        <h2 className="ad-grow">Research brief</h2>
        {b && <span className="ad-meta-mono">{['Researcher', b.model, b.at ? formatDateTime(b.at) : null].filter(Boolean).join(' · ')}</span>}
      </div>
      {!b ? (
        <EmptyState compact title="Researcher hasn’t written a brief yet.">
          {a.stage === 'disqualified'
            ? 'This account is disqualified, so it won’t be researched.'
            : researcher?.running
              ? 'Researcher is working right now. The brief shows up here when it’s done.'
              : 'New accounts are researched in the order they’re found. Re-run research to move this one up.'}
        </EmptyState>
      ) : (
        <div className="ad-brief">
          {b.summary && <p className="ad-summary">{b.summary}</p>}
          {b.whyNow && (
            <div className="ad-whynow">
              <span className="ad-label">Why now</span>
              <span>{b.whyNow}</span>
            </div>
          )}
          {(b.pains?.length > 0 || b.angles?.length > 0) && (
            <div className="ad-two">
              <div className="ad-list">
                <span className="ad-label">Pains</span>
                {(b.pains ?? []).length ? (
                  b.pains.map((p, i) => (
                    <div key={i} className="ad-list-item">
                      <span className="muted">–</span>
                      <span>{p}</span>
                    </div>
                  ))
                ) : (
                  <span className="muted small">None listed.</span>
                )}
              </div>
              <div className="ad-list">
                <span className="ad-label">Angles</span>
                {(b.angles ?? []).length ? (
                  b.angles.map((g, i) => (
                    <div key={i} className="ad-list-item">
                      <span className="ad-n">{i + 1}</span>
                      <span>
                        {g.text}
                        {g.used && <span className="muted"> · used in draft</span>}
                      </span>
                    </div>
                  ))
                ) : (
                  <span className="muted small">None listed.</span>
                )}
              </div>
            </div>
          )}
          {b.sources?.length > 0 && (
            <div className="ad-sources">
              <span className="ad-label muted">Sources</span>
              {b.sources.map((s, i) => (
                <SourceLink key={i} src={typeof s === 'string' ? s : s?.url} className="src-link ad-src" />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── Contacts ───────────────────────────────────────────────────

function contactStage(c, approvals) {
  switch (c.stage) {
    case 'draft': {
      const waiting = approvals.find((x) => x.contactId === c.id && x.status === 'pending');
      return waiting ? <a href={`#/approvals/${waiting.id}`}>Draft waiting</a> : 'Draft waiting';
    }
    case 'scored':
      return c.score != null ? `Scored ${c.score}` : 'Scored';
    case 'contacted':
      return c.sequenceStep ? `Step ${c.sequenceStep} sent` : 'Contacted';
    case 'replied':
      return 'Replied';
    case 'meeting':
      return 'Meeting booked';
    case 'skipped':
      return c.skipReason ? `Skipped: ${c.skipReason}` : 'Skipped';
    case 'unsubscribed':
      return 'Unsubscribed';
    case 'new':
      return 'Not scored yet';
    default:
      return c.stage ? tagFor('stage', c.stage).label : '—';
  }
}

function ContactsPanel({ contacts, approvals, agents, account }) {
  const perAccount = Number(agents.config('prospector').contactsPerAccount) || null;
  const isFresh = useFreshIds(contacts.map((c) => c.id));
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="ad-grow">Contacts</h2>
        <span className="ad-hint">
          {contacts.length
            ? `${perAccount ? `${contacts.length} of ${perAccount} per account` : plural(contacts.length, 'contact')} · found by Prospector`
            : null}
        </span>
      </div>
      {contacts.length === 0 ? (
        <EmptyState compact title="No contacts yet.">
          {['found', 'researched'].includes(account.stage)
            ? 'Prospector looks for the right people once the brief is written.'
            : account.stage === 'disqualified'
              ? 'This account is disqualified.'
              : 'Prospector didn’t find anyone matching your titles here.'}
        </EmptyState>
      ) : (
        <>
          <div className="ad-grid-contacts ad-row-head">
            <span>Name</span>
            <span>Title</span>
            <span>Email</span>
            <span>Email status</span>
            <span>Stage</span>
          </div>
          <div className="rows">
            {contacts.map((c) => (
              <div key={c.id} className={isFresh(c.id) ? 'ad-grid-contacts ad-row row-enter' : 'ad-grid-contacts ad-row'}>
                <span className="strong truncate">
                  {c.linkedin ? (
                    <a href={c.linkedin} target="_blank" rel="noreferrer" className="quiet-link">
                      {c.name}
                    </a>
                  ) : (
                    c.name
                  )}
                </span>
                <span className="muted truncate" title={c.title}>
                  {c.title || '—'}
                </span>
                <span className="ad-email truncate" title={c.email ?? undefined}>
                  {c.email ?? '—'}
                </span>
                <span>
                  <Tag kind="email" value={c.emailStatus ?? 'unknown'} />
                </span>
                <span className="muted truncate" title={c.lastContactedAt ? `Last emailed ${formatDateTime(c.lastContactedAt)}` : undefined}>
                  {contactStage(c, approvals)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ── History ────────────────────────────────────────────────────

function historyTag(tag) {
  if (!tag) return null;
  const t = tagFor('activity', tag);
  const label = tag === 'crm' ? 'CRM' : tag === 'review' ? 'Review' : t.label.charAt(0).toUpperCase() + t.label.slice(1);
  return { color: t.color, label };
}

// Stable keys for history rows (they have no id): time + title, numbered when repeated.
function historyKeys(history) {
  const seen = new Map();
  return history.map((h) => {
    const base = `${h.at}|${h.title}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}|${n}` : base;
  });
}

function HistoryPanel({ history, threads, agents, now }) {
  const keys = historyKeys(history);
  const isFresh = useFreshIds(keys);
  const thread = threads[0];
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="ad-grow">Outreach and conversations</h2>
        {thread && (
          <a href={`#/conversations/${thread.id}`} className="panel-link">
            Open in Conversations →
          </a>
        )}
      </div>
      {history.length === 0 ? (
        <EmptyState compact title="Nothing yet.">
          Drafts, sends, replies and CRM syncs for this account are listed here.
        </EmptyState>
      ) : (
        <div className="rows">
          {history.map((h, i) => {
            const t = historyTag(h.tag);
            return (
              <div key={keys[i]} className={isFresh(keys[i]) ? 'ad-history row-enter' : 'ad-history'}>
                <span className="ad-history-time">{formatShort(h.at, new Date(now))}</span>
                {h.agentId ? <Mono size="sm">{agentMono(agents.byId, h.agentId)}</Mono> : <span className="ad-you">You</span>}
                <div className="ad-history-text">
                  <span className="ad-history-title">{h.title}</span>
                  {h.sub && <span className="ad-history-sub">{h.sub}</span>}
                </div>
                {t ? <Tag color={t.color}>{t.label}</Tag> : <span />}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Right column ───────────────────────────────────────────────

function ScorePanel({ account: a, agents }) {
  const { outreach, research } = thresholds(agents.config('qualifier'));
  const parts = a.scoreBreakdown ?? [];
  return (
    <section className="panel ad-pad">
      <div className="ad-score-head">
        <h2>Lead score</h2>
        <ScoreTotal value={a.score} size="lg" />
      </div>
      {parts.length ? (
        <ScoreBars parts={parts} />
      ) : (
        <span className="ad-empty-text">{a.stage === 'found' ? 'Qualifier scores accounts after research.' : 'Not scored yet.'}</span>
      )}
      <div className="ad-score-foot">
        <div className="ad-score-decision">
          {a.decision && <Tag kind="decision" value={a.decision} />}
          <span>
            {outreach}+ outreach · {research}–{outreach - 1} research · &lt;{research} ignore
          </span>
        </div>
        {a.decisionNote && (
          <span className="ad-quote">
            “{a.decisionNote}” — Qualifier{a.scoredAt ? `, ${formatDateTime(a.scoredAt)}` : ''}
          </span>
        )}
      </div>
    </section>
  );
}

// "2026-09-16" is a calendar date, not midnight UTC; show it as that day.
function signalDate(value) {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  return formatDate(m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : value);
}

function SignalsPanel({ signals }) {
  const sorted = [...signals].sort((x, y) => String(y.date ?? '').localeCompare(String(x.date ?? '')));
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Signals</h2>
      </div>
      {sorted.length === 0 ? (
        <EmptyState compact title="No signals yet.">
          Funding, hiring, leadership changes and news that Scout and Researcher find show up here.
        </EmptyState>
      ) : (
        <div className="ad-signals">
          {sorted.map((s, i) => (
            <div key={i} className="ad-signal">
              <div className="ad-signal-rail">
                <span className="ad-signal-dot" />
                {i < sorted.length - 1 && <span className="ad-signal-line" />}
              </div>
              <div className="ad-signal-body">
                <div className="ad-signal-top">
                  <Tag kind="signal" value={s.type} />
                  <span className="ad-signal-date">{signalDate(s.date)}</span>
                </div>
                <span className="ad-signal-title">{s.title}</span>
                {s.url && sourceHref(s.url) && (
                  <a href={sourceHref(s.url)} target="_blank" rel="noreferrer" className="src-link ad-signal-src">
                    {sourceLabel(s.url).split('/')[0]} ↗
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MeetingsPanel({ meetings, contacts }) {
  const byId = Object.fromEntries(contacts.map((c) => [c.id, c]));
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Meetings</h2>
      </div>
      <div className="ad-meetings">
        {meetings.map((m) => {
          const t = tagFor('meeting', m.status);
          const dead = m.status === 'declined' || m.status === 'cancelled';
          return (
            <div key={m.id} className="ad-meeting">
              <span className={dead ? 'ad-meeting-when dead' : 'ad-meeting-when'}>
                <Dot color={DOT[t.color]} />
                {t.label} · {formatDateTime(m.start)}
              </span>
              <span className="muted">{[m.title, byId[m.contactId]?.name].filter(Boolean).join(' · ')}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CrmPanel({ crm, agents }) {
  const name = crmName(crm?.system);
  return (
    <section className="panel ad-pad">
      <div className="ad-crm-head">
        <h2>CRM sync</h2>
        {crm && (
          <span className="ad-crm-status">
            <Dot color="var(--success)" />
            In sync
          </span>
        )}
      </div>
      {!crm ? (
        <span className="ad-empty-text">Not synced yet. {agentName(agents.byId, 'crm') || 'CRM Agent'} adds the company and its contacts once outreach starts.</span>
      ) : (
        <>
          <div className="ad-kv">
            <span className="muted">System</span>
            <span>{name}</span>
            {crm.companyId && (
              <>
                <span className="muted">Company</span>
                <span className="mono">{crm.companyId}</span>
              </>
            )}
            <span className="muted">Contacts</span>
            <span>{formatNumber(crm.contactsSynced ?? 0)} synced</span>
            <span className="muted">Activities</span>
            <span>{formatNumber(crm.activitiesLogged ?? 0)} logged</span>
            <span className="muted">Last sync</span>
            <span className="mono">{crm.syncedAt ? `${formatTime(crm.syncedAt)} · ${formatDate(crm.syncedAt)}` : '—'}</span>
          </div>
          {crm.url && (
            <a href={crm.url} target="_blank" rel="noreferrer" className="ad-crm-link">
              View in {name} ↗
            </a>
          )}
        </>
      )}
    </section>
  );
}
