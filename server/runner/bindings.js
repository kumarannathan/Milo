import { getProvider, providerCapabilities } from '../providers/index.js';

// Which connection serves a capability for an agent:
// 1. the agent's own choice, 2. the workspace default, 3. the first connection that can do it.
// The string 'none' means the user turned the capability off for that agent.
export function resolveBinding(store, agentState, capability) {
  const connections = store.list('connections');
  const workspace = store.getValue('workspace') ?? {};

  if (capability === 'llm.complete') {
    const model = resolveModel(store, agentState);
    return model ? connections.find((c) => c.id === model.connectionId) ?? null : null;
  }

  const explicit = agentState?.bindings?.[capability] ?? workspace.bindings?.[capability];
  if (explicit === 'none') return null;
  if (explicit) {
    const conn = connections.find((c) => c.id === explicit);
    if (conn) return conn;
  }
  return connections.find((c) => providerCapabilities(getProvider(c.provider)).includes(capability)) ?? null;
}

export function resolveModel(store, agentState) {
  const connections = store.list('connections');
  const workspace = store.getValue('workspace') ?? {};
  const pick = (m) => (m?.connectionId && connections.some((c) => c.id === m.connectionId) ? m : null);
  const chosen = pick(agentState?.model) ?? pick(workspace.defaultModel);
  if (chosen) {
    const provider = getProvider(connections.find((c) => c.id === chosen.connectionId).provider);
    return { ...chosen, model: chosen.model || provider?.defaultModel || null, override: !!pick(agentState?.model) };
  }
  const llm = connections.find((c) => providerCapabilities(getProvider(c.provider)).includes('llm.complete'));
  if (!llm) return null;
  return { connectionId: llm.id, model: getProvider(llm.provider)?.defaultModel ?? null, override: false };
}
