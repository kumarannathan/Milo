import { createContext, useContext, useMemo } from 'react';
import { useResource } from './live.js';

const AppContext = createContext(null);

// Workspace, playbook metadata and providers, loaded once and kept fresh.
export function AppProvider({ children }) {
  const meta = useResource('/api/meta', []);
  const ws = useResource('/api/workspace', ['workspace']);
  const connections = useResource(ws.data?.workspace ? '/api/connections' : null, ['connections']);

  const value = useMemo(() => {
    const workspace = ws.data?.workspace ?? null;
    const playbooks = meta.data?.playbooks ?? [];
    return {
      ready: !!meta.data && !!ws.data,
      error: meta.error ?? ws.error,
      meta: meta.data,
      workspace,
      runner: ws.data?.runner ?? null,
      playbook: workspace ? playbooks.find((p) => p.id === workspace.playbook) ?? null : null,
      providers: meta.data?.providers ?? [],
      capabilities: meta.data?.capabilities ?? {},
      connections: connections.data?.connections ?? [],
      refreshWorkspace: ws.refresh,
      refreshConnections: connections.refresh,
    };
  }, [meta.data, meta.error, ws.data, ws.error, connections.data, ws.refresh, connections.refresh]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  return useContext(AppContext);
}
