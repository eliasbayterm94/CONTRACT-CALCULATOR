'use client';

import { useActionState } from 'react';
import type { ActionResult } from '@/app/actions';

interface Props {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  submitLabel: string;
  disabled?: boolean;
  className?: string;
  footerClassName?: string;
}

/**
 * Wraps a server action so every admin form gets consistent pending state and
 * an inline success/failure message without each section repeating the wiring.
 */
export default function ActionForm({
  action,
  children,
  submitLabel,
  disabled,
  className,
  footerClassName,
}: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      <div className={footerClassName ?? 'flex flex-wrap items-center gap-3 border-t p-4'}>
        <button type="submit" className="btn btn-primary" disabled={pending || disabled}>
          {pending ? 'Saving…' : submitLabel}
        </button>
        {disabled && (
          <span className="text-[0.8125rem]" style={{ color: 'var(--text-muted)' }}>
            Sign in to edit.
          </span>
        )}
        {state && (
          <span
            className="text-[0.8125rem]"
            role="status"
            style={{ color: state.ok ? 'var(--accent)' : 'var(--danger)' }}
          >
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
