import { useState } from 'react';
import { useAuth } from '../../lib/auth.jsx';
import { Button, Field, Input } from '../../components/ui.jsx';
import './auth.css';

// Sign in, create account and reset share one card. `mode` comes from the hash: #/signin, #/signup, #/reset.
export default function AuthScreen({ mode = 'signin' }) {
  const auth = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') await auth.signUp({ name, email, password });
      else if (mode === 'reset') {
        await auth.reset(email);
        setSent(true);
      } else await auth.signIn(email, password);
      if (mode !== 'reset') window.location.hash = '#/';
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'signup' ? 'Create your account' : mode === 'reset' ? 'Reset your password' : 'Sign in';

  return (
    <div className="auth">
      <a href="#/signin" className="sidebar-wordmark auth-brand">
        Milo
      </a>
      <form className="auth-card" onSubmit={submit}>
        <h1>{title}</h1>
        {mode === 'reset' && sent ? (
          <p className="auth-note">If an account exists for {email}, a reset link is on its way.</p>
        ) : (
          <>
            {mode === 'signup' && (
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus required />
              </Field>
            )}
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus={mode !== 'signup'} required />
            </Field>
            {mode !== 'reset' && (
              <Field label="Password" help={mode === 'signup' ? 'At least 8 characters.' : undefined}>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  minLength={mode === 'signup' ? 8 : undefined}
                  required
                />
              </Field>
            )}
            {error && <div className="form-error">{error}</div>}
            <Button type="submit" loading={busy} className="auth-submit">
              {mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
            </Button>
          </>
        )}
        <div className="auth-links">
          {mode === 'signin' && (
            <>
              <a href="#/signup">Create an account</a>
              <a href="#/reset">Forgot password?</a>
            </>
          )}
          {mode === 'signup' && <a href="#/signin">I already have an account</a>}
          {mode === 'reset' && <a href="#/signin">Back to sign in</a>}
        </div>
      </form>
    </div>
  );
}
