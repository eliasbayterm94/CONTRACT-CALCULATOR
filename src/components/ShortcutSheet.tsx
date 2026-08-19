'use client';

import { useEffect } from 'react';
import type { Shortcut } from './useShortcuts';

/**
 * The shortcut list, on demand.
 *
 * Shortcuts nobody can find are shortcuts nobody uses, and a permanent legend
 * on a pricing screen is clutter. `?` opens this; anything closes it.
 */
export default function ShortcutSheet({
  open,
  shortcuts,
  onClose,
}: {
  open: boolean;
  shortcuts: Shortcut[];
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="qc-keys-backdrop" onClick={onClose} role="presentation">
      <div
        className="qc-keys"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="qc-keys-head">
          <h2 className="qc-keys-title">Keyboard</h2>
          <button type="button" className="qc-keys-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <ul className="qc-keys-list">
          {shortcuts.map((s) => (
            <li key={s.key}>
              <kbd>{s.key === '?' ? '?' : s.key.toUpperCase()}</kbd>
              <span>{s.label}</span>
            </li>
          ))}
          <li>
            <kbd>Enter</kbd>
            <span>Move to the next field</span>
          </li>
          <li>
            <kbd>Esc</kbd>
            <span>Close whatever is open</span>
          </li>
        </ul>
        <p className="qc-keys-foot">Letter keys work when you are not typing in a field.</p>
      </div>
    </div>
  );
}
