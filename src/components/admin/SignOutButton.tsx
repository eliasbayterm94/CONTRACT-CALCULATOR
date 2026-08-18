'use client';

import { useTransition } from 'react';
import { signOut } from '@/app/actions';

export default function SignOutButton() {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn" disabled={pending} onClick={() => start(() => signOut())}>
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
