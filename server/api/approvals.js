import { getPlaybook } from '../playbooks/index.js';
import { HttpError, badRequest, notFound } from '../http.js';

// Approvals are shared by both playbooks. Each playbook supplies hooks:
//   playbook.approvals.enrich(approval, store)      -> extra fields for the UI
//   playbook.approvals.approve(approval, deps)      -> act on an approved item
//   playbook.approvals.reject(approval, deps, note) -> learn from a rejection
export function registerApprovalRoutes(router, deps) {
  const { store } = deps;

  const hooks = () => {
    const ws = store.getValue('workspace');
    if (!ws) throw new HttpError(409, 'Finish setup first.');
    return getPlaybook(ws.playbook).approvals ?? {};
  };

  const view = (a) => ({ ...a, ...(hooks().enrich?.(a, store) ?? {}) });

  function load(id) {
    const a = store.get('approvals', id);
    if (!a) throw notFound('That item is no longer in the queue.');
    return a;
  }

  function approve(a) {
    if (a.status !== 'pending') throw new HttpError(409, 'This item was already handled.');
    store.update('approvals', a.id, { status: 'approved', decidedAt: new Date().toISOString() });
    hooks().approve?.(store.get('approvals', a.id), deps);
    return store.get('approvals', a.id);
  }

  router.get('/api/approvals', ({ query }) => {
    const status = query.status ?? 'pending';
    const all = store.list('approvals');
    let rows = all.filter((a) => (status === 'approved' ? ['approved', 'sent', 'failed'].includes(a.status) : a.status === status));
    rows = status === 'pending' ? rows.sort((x, y) => x.createdAt.localeCompare(y.createdAt)) : rows.reverse();
    if (query.limit) rows = rows.slice(0, Number(query.limit));
    return {
      approvals: rows.map(view),
      counts: {
        pending: all.filter((a) => a.status === 'pending').length,
        approved: all.filter((a) => ['approved', 'sent', 'failed'].includes(a.status)).length,
        rejected: all.filter((a) => a.status === 'rejected').length,
      },
    };
  });

  router.get('/api/approvals/:id', ({ params }) => ({ approval: view(load(params.id)) }));

  router.patch('/api/approvals/:id', ({ params, body }) => {
    const a = load(params.id);
    if (a.status !== 'pending') throw new HttpError(409, 'Only pending items can be edited.');
    const patch = {};
    if (body.subject !== undefined) patch.subject = String(body.subject);
    if (body.body !== undefined) {
      if (!String(body.body).trim()) throw badRequest('The message can’t be empty.');
      patch.body = String(body.body);
    }
    const original = a.original ?? { subject: a.subject, body: a.body };
    const next = { ...a, ...patch };
    patch.original = original;
    patch.edited = next.subject !== original.subject || next.body !== original.body;
    return { approval: view(store.update('approvals', a.id, patch)) };
  });

  router.post('/api/approvals/:id/approve', ({ params }) => ({ approval: view(approve(load(params.id))) }));

  router.post('/api/approvals/approve', ({ body }) => {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (!ids.length) throw badRequest('Select at least one item.');
    const approved = [];
    for (const id of ids) {
      const a = store.get('approvals', id);
      if (a?.status === 'pending') approved.push(approve(a).id);
    }
    return { approved };
  });

  router.post('/api/approvals/:id/reject', ({ params, body }) => {
    const a = load(params.id);
    if (a.status !== 'pending') throw new HttpError(409, 'This item was already handled.');
    const note = { reason: String(body.reason ?? '').trim(), tags: Array.isArray(body.tags) ? body.tags.map(String) : [] };
    store.update('approvals', a.id, { status: 'rejected', decidedAt: new Date().toISOString(), rejectReason: note.reason, rejectTags: note.tags });
    hooks().reject?.(store.get('approvals', a.id), deps, note);
    return { approval: view(store.get('approvals', a.id)) };
  });
}
