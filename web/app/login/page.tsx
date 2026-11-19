'use client';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { Icon } from '@/components/Icons';
import { safeNext } from '@/lib/session';

// Lanes for the motion graphic: [colour class, width %, duration s, delay s]
const LANES: [string, number, number, number][][] = [
  [['g', 14, 16, 0], ['p', 9, 16, -7]],
  [['b', 20, 21, -3], ['k', 8, 21, -13]],
  [['p', 11, 18, -9], ['g', 16, 18, -1]],
  [['k', 13, 24, -5], ['b', 7, 24, -17]],
  [['g', 9, 19, -12], ['p', 18, 19, -4]],
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.detail === 'string' ? body.detail : 'Login failed. Try again.');
        setShakeKey((k) => k + 1);
        return;
      }
      // full page load so the workspace picks up the new session
      window.location.href = safeNext(new URLSearchParams(window.location.search).get('next'));
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="auth-art" aria-hidden="true">
        <span className="brand">
          <span className="brand-mark"><span /><span /><span /></span><span>Performance Slots</span>
        </span>
        <div className="lanes">
          {LANES.map((lane, i) => (
            <div className="lane" key={i}>
              {lane.map(([c, w, d, delay], k) => (
                <span key={k} className={c} style={{ width: `${w}%`, animationDuration: `${d}s`, animationDelay: `${delay}s` }} />
              ))}
            </div>
          ))}
        </div>
        <div className="auth-copy">
          <h2>Every act, every segment, one live stage plan.</h2>
          <p>Review requests, place acts on the timetable and keep groups informed.</p>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-form page-enter">
          <div>
            <h1>Sign in</h1>
            <p className="sub">Organiser workspace</p>
          </div>
          <form onSubmit={submit} key={shakeKey} className={shakeKey ? 'shake' : undefined}>
            {error && (
              <div className="inline-alert err" role="alert"><Icon name="alert" size={16} />{error}</div>
            )}
            <div className="field">
              <label htmlFor="email">Work email</label>
              <input id="email" type="email" autoComplete="username" required autoFocus
                     value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" autoComplete="current-password" required
                     value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button type="submit" className="primary lg block" disabled={busy} aria-busy={busy}>
              {busy ? <><Icon name="refresh" size={16} />Signing in…</> : <>Sign in<Icon name="arrow" size={16} /></>}
            </button>
          </form>
          <p className="auth-foot">
            Performing group? <Link href="/">Request slots</Link> without an account.
          </p>
        </div>
      </section>
    </>
  );
}
