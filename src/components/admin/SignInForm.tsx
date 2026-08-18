'use client';

import { useActionState, useTransition } from 'react';
import { signIn, signOut, type ActionResult } from '@/app/actions';

export function SignInForm() {
  const [state, formAction, pending] = useActionState(signIn, null as ActionResult | null);
  return (
    <form action={formAction} className="qc-panel-body qc-signin">
      <h2 className="qc-panel-title" style={{ marginBottom: 6 }}>Admin sign-in</h2>
      <p style={{ fontSize: 12, color: 'var(--fc-ink-500)', margin: '0 0 14px', lineHeight: 1.5 }}>
        Everyone can build quotes. Editing rates, premiums and the cost tables needs the admin password.
      </p>
      <div className="qc-fields">
        <div className="qc-field">
          <label className="qc-label" htmlFor="name">Your name</label>
          <input id="name" name="name" className="qc-input" placeholder="elias" />
        </div>
        <div className="qc-field">
          <label className="qc-label" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" className="qc-input" required />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="submit" className="fc-btn fc-btn-primary" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
        {state && (
          <span role="status" style={{ fontSize: 12, color: state.ok ? 'var(--fc-success)' : 'var(--fc-danger)' }}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}

export function SignOutButton() {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="fc-btn fc-btn-ghost" disabled={pending} onClick={() => start(() => signOut())}>
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
