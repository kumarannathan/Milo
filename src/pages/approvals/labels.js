// Labels for approval items, shared by the list, the editor and the control room.
import { tagFor } from '../../lib/tags.js';

export function titleOf(a) {
  if (a.kind === 'trade') return a.market?.question ?? a.subject ?? 'Trade';
  return a.contact?.name ?? a.subject ?? 'Unknown contact';
}

export function subtitleOf(a) {
  if (a.kind === 'trade') return a.subject ?? '';
  return [a.contact?.title, a.account?.name].filter(Boolean).join(' · ');
}

/** { color, label } for the kind tag: "First touch", "Follow-up 2 of 3", "Meeting invite". */
export function kindLabel(a) {
  const t = tagFor('approval', a.kind);
  if (a.kind === 'follow_up' && a.step) {
    const total = a.sequenceSteps;
    return { ...t, label: total ? `Follow-up ${a.step} of ${total}` : `Follow-up ${a.step}` };
  }
  return t;
}

const STATUS = {
  pending: ['amber', 'Pending'],
  approved: ['blue', 'Approved'],
  sent: ['green', 'Sent'],
  failed: ['red', 'Failed'],
  rejected: ['gray', 'Rejected'],
};

export function statusTag(a) {
  const [color, label] = STATUS[a.status] ?? ['gray', a.status ?? '—'];
  return { color, label: a.kind === 'trade' && a.status === 'sent' ? 'Placed' : label };
}

/** Short noun for toasts and copy. */
export function kindNoun(a) {
  return { first_touch: 'first touch', follow_up: 'follow-up', reply: 'reply', meeting: 'meeting invite', trade: 'trade' }[a.kind] ?? 'draft';
}
