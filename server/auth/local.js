// Local accounts: email + password in data/users.json, a signed cookie for the session.
// This is the development and self-hosted adapter. The Supabase adapter replaces it in production.
import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { HttpError, badRequest } from '../http.js';

const COOKIE = 'milo_session';
const SESSION_DAYS = 30;

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function hashPassword(password, salt = randomBytes(16)) {
  const hash = scryptSync(password, salt, 64);
  return `${b64url(salt)}.${b64url(hash)}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored ?? '').split('.');
  if (!salt || !hash) return false;
  const a = scryptSync(password, Buffer.from(salt, 'base64url'), 64);
  const b = Buffer.from(hash, 'base64url');
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function publicUser(u) {
  return u ? { id: u.id, email: u.email, name: u.name, createdAt: u.createdAt } : null;
}

/**
 * @param {{ dir: string|null, secret?: string, secure?: boolean }} opts  dir null keeps users in memory.
 */
export function createLocalAuth({ dir, secret, secure = false, signup = 'open' }) {
  const file = dir ? path.join(dir, 'users.json') : null;
  const secretFile = dir ? path.join(dir, '.session-secret') : null;
  let users = [];

  if (file && fs.existsSync(file)) {
    try {
      users = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      users = [];
    }
  }
  if (!secret) {
    if (secretFile && fs.existsSync(secretFile)) secret = fs.readFileSync(secretFile, 'utf8').trim();
    else {
      secret = randomBytes(32).toString('hex');
      if (secretFile) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(secretFile, secret, { mode: 0o600 });
      }
    }
  }

  function save() {
    if (!file) return;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(users), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function sign(payload) {
    const body = b64url(JSON.stringify(payload));
    const sig = createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  function verify(token) {
    const [body, sig] = String(token ?? '').split('.');
    if (!body || !sig) return null;
    const expected = createHmac('sha256', secret).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (!payload.uid || !payload.exp || payload.exp < Date.now()) return null;
      return payload;
    } catch {
      return null;
    }
  }

  function cookie(value, maxAge) {
    const parts = [`${COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
    if (secure) parts.push('Secure');
    return parts.join('; ');
  }

  function session(res, user) {
    const token = sign({ uid: user.id, v: user.sessionVersion ?? 0, exp: Date.now() + SESSION_DAYS * 86_400_000 });
    res.setHeader('Set-Cookie', cookie(token, SESSION_DAYS * 86_400));
  }

  function normEmail(email) {
    const e = String(email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw badRequest('Enter a valid email address.');
    return e;
  }

  function checkPassword(password) {
    if (String(password ?? '').length < 8) throw badRequest('Use at least 8 characters for your password.');
  }

  function byId(id) {
    return users.find((u) => u.id === id) ?? null;
  }

  return {
    mode: 'local',

    resolveUser(req) {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      const payload = token ? verify(token) : null;
      if (!payload) return null;
      const user = byId(payload.uid);
      if (!user || (user.sessionVersion ?? 0) !== (payload.v ?? 0)) return null;
      return publicUser(user);
    },

    registerRoutes(router) {
      router.post('/api/auth/signup', ({ body, res }) => {
        if (signup === 'closed') throw new HttpError(403, 'Sign-up is closed. Ask the person who runs this Milo for an account.');
        const email = normEmail(body.email);
        checkPassword(body.password);
        if (users.some((u) => u.email === email)) throw new HttpError(409, 'An account with that email already exists. Sign in instead.');
        const user = {
          id: `usr_${randomBytes(8).toString('hex')}`,
          email,
          name: String(body.name ?? '').trim() || email.split('@')[0],
          passwordHash: hashPassword(String(body.password)),
          sessionVersion: 0,
          createdAt: new Date().toISOString(),
        };
        users.push(user);
        save();
        session(res, user);
        return { user: publicUser(user) };
      });

      router.post('/api/auth/signin', ({ body, res }) => {
        const email = normEmail(body.email);
        const user = users.find((u) => u.email === email);
        if (!user || !verifyPassword(String(body.password ?? ''), user.passwordHash)) throw new HttpError(401, 'Wrong email or password.');
        session(res, user);
        return { user: publicUser(user) };
      });

      router.post('/api/auth/signout', ({ req, res }) => {
        // Bumping the version invalidates every cookie issued for this account, not just this one.
        const user = req.user ? byId(req.user.id) : null;
        if (user) {
          user.sessionVersion = (user.sessionVersion ?? 0) + 1;
          save();
        }
        res.setHeader('Set-Cookie', cookie('', 0));
        return { ok: true };
      });

      router.post('/api/auth/reset', ({ body }) => {
        normEmail(body.email);
        // Password reset by email arrives with the hosted auth provider. Until then this only acknowledges.
        return { ok: true };
      });

      router.get('/api/auth/me', ({ req }) => ({ user: req.user ?? null }));

      router.patch('/api/auth/me', ({ req, body, res }) => {
        if (!req.user) throw new HttpError(401, 'Sign in first.');
        const user = byId(req.user.id);
        if (body.name !== undefined) {
          const name = String(body.name).trim();
          if (!name) throw badRequest('Your name can’t be empty.');
          user.name = name;
        }
        if (body.email !== undefined) {
          const email = normEmail(body.email);
          if (users.some((u) => u.email === email && u.id !== user.id)) throw new HttpError(409, 'That email is already in use.');
          user.email = email;
        }
        if (body.newPassword !== undefined) {
          if (!verifyPassword(String(body.currentPassword ?? ''), user.passwordHash)) throw badRequest('Your current password is wrong.');
          checkPassword(body.newPassword);
          user.passwordHash = hashPassword(String(body.newPassword));
          user.sessionVersion = (user.sessionVersion ?? 0) + 1; // signs out other devices
          session(res, user);
        }
        save();
        return { user: publicUser(user) };
      });
    },
  };
}
