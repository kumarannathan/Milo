// Approval hooks for the sales playbook, plus the shared "approve and queue the send"
// logic agents use when the workspace autonomy lets an item skip review.
import { resolveBinding } from '../../runner/bindings.js';
import { ago, initials, touchAccount } from './util.js';

const COLD = new Set(['first_touch', 'follow_up']);

export const isCold = (approval) => COLD.has(approval?.kind);

/** Cold emails wait for their slot in the sending window; replies and invites go now. */
export function sendOptions(approval) {
  return {
    availableAt: isCold(approval) ? approval.sendAt ?? null : null,
    dedupeKey: `send:${approval.id}`,
  };
}

/** Whether a new item of `kind` waits for a person under the workspace autonomy level. */
export function needsReview(workspace, kind) {
  const level = workspace?.autonomy ?? 'review_sends';
  if (level === 'autopilot') return false;
  if (level === 'review_first_touch') return kind === 'first_touch';
  return true;
}

/** Approve on the user's behalf (autonomy allows it) and queue the send. */
export function autoApprove(ctx, approval) {
  const row = ctx.store.update('approvals', approval.id, {
    status: 'approved',
    decidedAt: new Date().toISOString(),
    autoApproved: true,
  });
  ctx.emit('send_outreach', { approvalId: row.id }, sendOptions(row));
  return row;
}

export function enrich(approval, store) {
  const contact = store.get('contacts', approval.contactId);
  const account = store.get('accounts', approval.accountId);
  const settings = store.getValue('workspace')?.settings ?? {};
  const sendConn = resolveBinding(store, store.get('agents', 'sdr'), 'email.send');
  return {
    contact: contact
      ? {
          name: contact.name,
          initials: initials(contact.name),
          title: contact.title,
          email: contact.email,
          emailStatus: contact.emailStatus,
          location: contact.location,
          timezone: contact.timezone,
        }
      : null,
    account: account ? { id: account.id, name: account.name, domain: account.domain } : null,
    score: contact?.score ?? account?.score ?? null,
    scoreBreakdown: contact?.scoreBreakdown?.length ? contact.scoreBreakdown : account?.scoreBreakdown ?? [],
    decision: account?.decision ?? null,
    scoredAgo: ago(account?.scoredAt),
    from: {
      name: settings.senderName ?? '',
      email: settings.senderEmail ?? '',
      via: sendConn?.label ?? null,
    },
  };
}

export function approve(approval, { runner }) {
  runner.enqueue('send_outreach', { approvalId: approval.id }, { ...sendOptions(approval), createdBy: 'user' });
}

export function reject(approval, { store }, note = {}) {
  const now = new Date().toISOString();
  const agentId = approval.agentId ?? 'personalizer';
  const contact = store.get('contacts', approval.contactId);

  store.insert('notes', {
    kind: 'rejection',
    agentId,
    text: note.reason ?? '',
    tags: note.tags ?? [],
    approvalId: approval.id,
    at: now,
  });

  if (approval.kind === 'first_touch' && contact && contact.stage === 'draft') {
    store.update('contacts', contact.id, { stage: 'scored' });
    const active = store.count('contacts', (c) => c.accountId === approval.accountId && ['draft', 'contacted', 'replied', 'meeting'].includes(c.stage));
    const account = store.get('accounts', approval.accountId);
    if (!active && account?.stage === 'in_outreach') store.update('accounts', account.id, { stage: 'qualified' });
  }
  if (['reply', 'meeting'].includes(approval.kind) && approval.threadId) {
    // The prospect is still waiting on an answer; it is now the user's to write.
    const thread = store.get('threads', approval.threadId);
    if (thread && thread.status !== 'closed') store.update('threads', thread.id, { status: thread.status === 'escalated' ? 'escalated' : 'us' });
  }
  if (approval.kind === 'meeting' && approval.meetingId) {
    store.update('meetings', approval.meetingId, { status: 'cancelled' });
  }

  const label = { first_touch: 'first touch', follow_up: 'follow-up', reply: 'reply', meeting: 'meeting invite' }[approval.kind] ?? 'draft';
  store.insert('activity', {
    agentId,
    at: now,
    pre: `will use your note on the ${label} for`,
    link: contact?.name ?? 'this contact',
    href: `#/approvals/${approval.id}`,
    post: note.reason ? `· “${note.reason}”` : '· rejected without a note',
    tag: 'review',
    level: 'info',
  });
  touchAccount(store, approval.accountId, agentId, `You rejected the ${label}${contact ? ` for ${contact.name}` : ''}`);
}
