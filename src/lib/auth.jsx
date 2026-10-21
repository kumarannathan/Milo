import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

// Who is signed in. Talks to /api/auth/*; the server decides whether that is local accounts or Supabase.
export function AuthProvider({ children }) {
  const [state, setState] = useState({ user: null, loading: true, error: null });

  const load = useCallback(async () => {
    try {
      const r = await api.get('/api/auth/me');
      setState({ user: r.user, loading: false, error: null });
    } catch (err) {
      setState({ user: null, loading: false, error: err });
    }
  }, []);

  useEffect(() => {
    load();
    const out = () => setState((s) => (s.user ? { ...s, user: null } : s));
    window.addEventListener('milo:signed-out', out);
    return () => window.removeEventListener('milo:signed-out', out);
  }, [load]);

  const value = useMemo(
    () => ({
      user: state.user,
      loading: state.loading,
      error: state.error,
      async signIn(email, password) {
        const r = await api.post('/api/auth/signin', { email, password });
        setState({ user: r.user, loading: false, error: null });
        return r.user;
      },
      async signUp({ name, email, password }) {
        const r = await api.post('/api/auth/signup', { name, email, password });
        setState({ user: r.user, loading: false, error: null });
        return r.user;
      },
      async signOut() {
        try {
          await api.post('/api/auth/signout');
        } finally {
          setState({ user: null, loading: false, error: null });
          window.location.hash = '#/';
        }
      },
      async update(patch) {
        const r = await api.patch('/api/auth/me', patch);
        setState((s) => ({ ...s, user: r.user }));
        return r.user;
      },
      reset: (email) => api.post('/api/auth/reset', { email }),
      refresh: load,
    }),
    [state, load],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
