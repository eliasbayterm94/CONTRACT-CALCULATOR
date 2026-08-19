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

  const edits = `${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'}`;

  // What the server said outranks the edit count. A save that comes back while
  // the form is still dirty is exactly the case worth seeing — it means the
  // save did not take the change with it — and showing only "1 unsaved change"
  // is how that stayed invisible.
  const status = locked
    ? { text: 'Sign in to edit.', tone: '' }
    : pending
      ? { text: 'Saving…', tone: '' }
      : state
        ? { text: dirty ? `${state.message} ${edits} still open.` : state.message, tone: state.ok && !dirty ? 'is-ok' : dirty ? 'is-dirty' : 'is-bad' }
        : dirty
          ? { text: edits, tone: 'is-dirty' }
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
