// Supabase Auth adapter. The client signs in with supabase-js and sends the access token as
// `Authorization: Bearer <jwt>`; this verifies it against the project's JWT secret.
//
// Needs: SUPABASE_URL, SUPABASE_JWT_SECRET (Project settings → API → JWT secret).
// Same interface as ./local.js: { mode, resolveUser(req), registerRoutes(router) }.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../http.js';

function decode(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

export function createSupabaseAuth({ url, jwtSecret }) {
  if (!url || !jwtSecret) throw new Error('MILO_AUTH=supabase needs SUPABASE_URL and SUPABASE_JWT_SECRET.');

  function verify(token) {
    const [h, p, s] = String(token).split('.');
    if (!h || !p || !s) return null;
    const header = decode(h);
    if (header.alg !== 'HS256') return null;
    const expected = createHmac('sha256', jwtSecret).update(`${h}.${p}`).digest('base64url');
    const a = Buffer.from(s);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = decode(p);
    if (!payload.sub || (payload.exp && payload.exp * 1000 < Date.now())) return null;
    return payload;
  }

  return {
    mode: 'supabase',

    resolveUser(req) {
      const [scheme, token] = String(req.headers.authorization ?? '').split(' ');
      if (scheme !== 'Bearer' || !token) return null;
      let payload = null;
      try {
        payload = verify(token);
      } catch {
        return null;
      }
      if (!payload) return null;
      const meta = payload.user_metadata ?? {};
      return { id: payload.sub, email: payload.email ?? '', name: meta.name ?? meta.full_name ?? (payload.email ?? '').split('@')[0] };
    },

    registerRoutes(router) {
      // Sign-up, sign-in and reset happen in the browser against Supabase. The server only answers "who am I".
      router.get('/api/auth/me', ({ req }) => ({ user: req.user ?? null, provider: 'supabase', url }));
      for (const p of ['/api/auth/signup', '/api/auth/signin', '/api/auth/reset']) {
        router.post(p, () => {
          throw new HttpError(400, 'Sign in through Supabase on the client.');
        });
      }
      router.post('/api/auth/signout', () => ({ ok: true }));
      router.patch('/api/auth/me', () => {
        throw new HttpError(400, 'Edit your profile through Supabase on the client.');
      });
    },
  };
}
