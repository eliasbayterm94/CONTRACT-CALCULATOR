'use client';

import { useFormStatus } from 'react-dom';
import type { ActionResult } from '@/app/actions';

/**
 * The bar that follows you down a long table: how many edits are open, a way
 * to throw them away, and the one button that commits the lot.
 */
export default function SaveBar({
  dirtyCount,
  onReset,
  state,
  label,
  locked,
}: {
  dirtyCount: number;
  onReset?: () => void;
  state: ActionResult | null;
  label: string;
  locked?: boolean;
}) {
  const { pending } = useFormStatus();
  const dirty = dirtyCount > 0;

  const status = locked
    ? { text: 'Sign in to edit.', tone: '' }
    : pending
      ? { text: 'Saving…', tone: '' }
      : dirty
        ? { text: `${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'}`, tone: 'is-dirty' }
        : state
          ? { text: state.message, tone: state.ok ? 'is-ok' : 'is-bad' }
          : { text: 'No changes.', tone: '' };

  return (
    <div className={`qc-savebar${dirty && !locked ? ' is-dirty' : ''}`}>
      <span className={`qc-savebar-status ${status.tone}`} role="status">
        {status.text}
      </span>
      {onReset && (
        <button type="button" className="fc-btn fc-btn-ghost" onClick={onReset} disabled={!dirty || pending || locked}>
          Discard
        </button>
      )}
      <button type="submit" className="fc-btn fc-btn-primary" disabled={pending || locked || !dirty}>
        {pending ? 'Saving…' : label}
      </button>
    </div>
  );
}
