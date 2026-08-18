'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { changeAdminCode, createAdminCode, signIn, signOut, type ActionResult } from '@/app/actions';

/**
 * Remembers who is at the keyboard.
 *
 * React resets a form after every action, so without this a failed attempt
 * wipes the name along with the code — and the next successful sign-in is
 * logged as "admin" instead of the person. Kept in the browser so it is
 * prefilled next time too; it is a label for the audit log, not a credential.
 */
function useRememberedName() {
  const [name, setName] = useState('');
  useEffect(() => {
    setName(window.localStorage.getItem('fc.adminName') ?? '');
  }, []);
  const remember = (next: string) => {
    setName(next);
    window.localStorage.setItem('fc.adminName', next);
  };
  return [name, remember] as const;
}

function Status({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <span
      role="status"
      style={{ fontSize: 12, color: state.ok ? 'var(--fc-success)' : 'var(--fc-danger)' }}
    >
      {state.message}
    </span>
  );
}

/** First run: nobody has a code yet, so whoever opens admin first chooses one. */
export function CreateCodeForm() {
  const [state, formAction, pending] = useActionState(createAdminCode, null as ActionResult | null);
  const [name, setName] = useRememberedName();
  return (
    <form action={formAction} className="qc-panel-body qc-signin">
      <h2 className="qc-panel-title" style={{ marginBottom: 6 }}>Choose your admin code</h2>
      <p className="qc-signin-copy">
        Nobody has set one yet. Pick a code now and it is the only one that opens admin from here on.
        It is stored hashed — not even the database holds the code itself, so keep a copy somewhere safe.
      </p>
      <div className="qc-fields">
        <div className="qc-field wide">
          <label className="qc-label" htmlFor="setup-name">Your name</label>
          <input
            id="setup-name" name="name" className="qc-input" placeholder="elias" autoComplete="username"
            value={name} onChange={(e) => setName(e.target.value)}
          />
          <p className="qc-hint">Signs the audit log, so changes show who made them.</p>
        </div>
        <div className="qc-field">
          <label className="qc-label" htmlFor="setup-code">New code</label>
          <input
            id="setup-code" name="code" type="password" className="qc-input"
            required minLength={6} autoComplete="new-password"
          />
        </div>
        <div className="qc-field">
          <label className="qc-label" htmlFor="setup-confirm">Repeat it</label>
          <input
            id="setup-confirm" name="confirm" type="password" className="qc-input"
            required minLength={6} autoComplete="new-password"
          />
        </div>
      </div>
      <div className="qc-signin-actions">
        <button type="submit" className="fc-btn fc-btn-primary" disabled={pending}>
          {pending ? 'Setting…' : 'Set code and sign in'}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function SignInForm() {
  const [state, formAction, pending] = useActionState(signIn, null as ActionResult | null);
  const [name, setName] = useRememberedName();
  return (
    <form action={formAction} className="qc-panel-body qc-signin">
      <h2 className="qc-panel-title" style={{ marginBottom: 6 }}>Admin sign-in</h2>
      <p className="qc-signin-copy">
        Everyone can build quotes. Editing rates, premiums and the cost tables needs the admin code.
      </p>
      <div className="qc-fields">
        <div className="qc-field">
          <label className="qc-label" htmlFor="name">Your name</label>
          <input
            id="name" name="name" className="qc-input" placeholder="elias" autoComplete="username"
            value={name} onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="qc-field">
          <label className="qc-label" htmlFor="code">Code</label>
          <input id="code" name="code" type="password" className="qc-input" required autoComplete="current-password" />
        </div>
      </div>
      <div className="qc-signin-actions">
        <button type="submit" className="fc-btn fc-btn-primary" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
        <Status state={state} />
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

/** Change the code from inside, proving you know the current one. */
export function ChangeCodeForm({ managedByEnv }: { managedByEnv: boolean }) {
  const [state, formAction, pending] = useActionState(changeAdminCode, null as ActionResult | null);
  const [open, setOpen] = useState(false);

  if (managedByEnv) {
    return (
      <p className="qc-signin-copy" style={{ margin: 0 }}>
        The code is set by <code>ADMIN_PASSWORD</code> on this server, so it is changed there rather
        than here.
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" className="fc-btn fc-btn-ghost" onClick={() => setOpen(true)}>
        Change code
      </button>
    );
  }

  return (
    <form action={formAction} style={{ width: '100%' }}>
      <div className="qc-fields">
        <div className="qc-field wide">
          <label className="qc-label" htmlFor="current">Current code</label>
          <input id="current" name="current" type="password" className="qc-input" required autoComplete="current-password" />
        </div>
        <div className="qc-field">
          <label className="qc-label" htmlFor="new-code">New code</label>
          <input id="new-code" name="code" type="password" className="qc-input" required minLength={6} autoComplete="new-password" />
        </div>
        <div className="qc-field">
          <label className="qc-label" htmlFor="new-confirm">Repeat it</label>
          <input id="new-confirm" name="confirm" type="password" className="qc-input" required minLength={6} autoComplete="new-password" />
        </div>
      </div>
      <div className="qc-signin-actions">
        <button type="submit" className="fc-btn fc-btn-primary" disabled={pending}>
          {pending ? 'Changing…' : 'Change code'}
        </button>
        <button type="button" className="fc-btn fc-btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}
