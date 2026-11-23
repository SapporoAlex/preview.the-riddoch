import { useState, type FormEvent } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { ServiceError, useServices } from '@/services';
import { errorMessage } from '@/ui/toast';

export function AuthPage() {
  const { signIn, signUp } = useAuth();
  const { backend } = useServices();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'signin') await signIn(email, password, remember);
      else await signUp({ email, password, displayName }, remember);
    } catch (err) {
      if (err instanceof ServiceError && err.code === 'confirmation_required') {
        setInfo(err.message);
        if (mode === 'signup') setMode('signin');
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  const switchMode = () => {
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
    setError(null);
    setInfo(null);
  };

  return (
    <div className="auth-page">
      <section className="auth-hero" aria-hidden="true">
        <div className="auth-hero-inner">
          <div className="brand brand-light">
            <span className="brand-mark" />
            Gallery Studio
          </div>
          <h1>Plan your exhibition before the first nail goes in.</h1>
          <p>Hang work at true scale, test wall colours, and walk the rooms at eye level with your collaborators.</p>
        </div>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={onSubmit} noValidate>
          <h2>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h2>
          <p className="muted">
            {mode === 'signin' ? 'Sign in to continue to your layouts.' : 'Start planning your first gallery layout.'}
          </p>

          {mode === 'signup' && (
            <label className="field">
              <span>Name</span>
              <input
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Alex Doe"
                required
              />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@studio.com"
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
              required
            />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Keep me signed in
          </label>

          {info && (
            <div className="form-info" role="status">
              {info}
            </div>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>

          <p className="auth-switch">
            {mode === 'signin' ? 'New here?' : 'Already have an account?'}{' '}
            <button type="button" className="link" onClick={switchMode}>
              {mode === 'signin' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
          {backend === 'local' && (
            <p className="prototype-note">Prototype: accounts and layouts are stored only in this browser.</p>
          )}
        </form>
      </section>
    </div>
  );
}
