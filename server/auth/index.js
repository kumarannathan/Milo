// Picks the auth adapter. Every adapter exposes { mode, resolveUser(req), registerRoutes(router) }.
//   none     — no accounts; every request is the single built-in user (tests, trusted single-user setups)
//   local    — email + password stored on this machine (default)
//   supabase — Supabase Auth JWTs (hosted)
import { createLocalAuth } from './local.js';
import { createSupabaseAuth } from './supabase.js';

export const LOCAL_USER = { id: 'local', email: '', name: 'You' };

export function createAuth({ mode = 'local', dir = null, secret, secure = false, supabase = {} } = {}) {
  if (mode === 'none') {
    return {
      mode: 'none',
      resolveUser: () => LOCAL_USER,
      registerRoutes(router) {
        router.get('/api/auth/me', () => ({ user: LOCAL_USER }));
        router.post('/api/auth/signout', () => ({ ok: true }));
      },
    };
  }
  if (mode === 'supabase') return createSupabaseAuth(supabase);
  if (mode === 'local') return createLocalAuth({ dir, secret, secure });
  throw new Error(`Unknown MILO_AUTH "${mode}". Use none, local or supabase.`);
}
