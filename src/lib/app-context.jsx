import { createContext, useContext, useMemo } from 'react';
import { useResource } from './live.js';
import { useAuth } from './auth.jsx';

const AppContext = createContext(null);

// Workspace, playbook metadata and providers for the signed-in user, loaded once and kept fresh.
export function AppProvider({ children }) {
  const auth = useAuth();
  const signedIn = !!auth.user;
  const meta = useResource('/api/meta', []);
  const ws = useResource(signedIn ? '/api/workspace' : null, ['workspace']);
  const connections = useResource(signedIn && ws.data?.workspace ? '/api/connections' : null, ['connections']);

  const value = useMemo(() => {
    const workspace = ws.data?.workspace ?? null;
    const playbooks = meta.data?.playbooks ?? [];
    return {
      ready: !!meta.data && (!signedIn || !!ws.data),
      error: meta.error ?? ws.error,
      meta: meta.data,
      workspace,
      runner: ws.data?.runner ?? null,
      playbook: workspace ? playbooks.find((p) => p.id === workspace.playbook) ?? null : null,
      playbooks,
      providers: meta.data?.providers ?? [],
      capabilities: meta.data?.capabilities ?? {},
      connections: connections.data?.connections ?? [],
      refreshWorkspace: ws.refresh,
      refreshConnections: connections.refresh,
    };
  }, [signedIn, meta.data, meta.error, ws.data, ws.error, connections.data, ws.refresh, connections.refresh]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  return useContext(AppContext);
}
