// One queued analysis per market. A stronger reason upgrades a task already in the queue,
// so a whale trade or a manual request is never swallowed by a routine refresh.

const PRIORITY = { refresh: 0, new: 1, whale: 2, manual: 3 };

export const analysisKey = (marketId) => `analyze:${marketId}`;

/** `emit` is ctx.emit or runner.enqueue: (type, payload, opts) => task. */
export function queueAnalysis(emit, store, marketId, reason) {
  const task = emit('analyze_market', { marketId, reason }, { dedupeKey: analysisKey(marketId) });
  if (task?.status === 'queued' && (PRIORITY[task.payload?.reason] ?? 0) < (PRIORITY[reason] ?? 0)) {
    store.update('tasks', task.id, { payload: { ...task.payload, reason } });
  }
  return task;
}

export function analysisPending(store, marketId) {
  return !!store.find('tasks', (t) => t.dedupeKey === analysisKey(marketId) && (t.status === 'queued' || t.status === 'running'));
}
