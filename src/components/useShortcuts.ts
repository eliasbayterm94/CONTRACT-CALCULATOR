'use client';

import { useEffect } from 'react';

export interface Shortcut {
  /** The key as it arrives from the keyboard, lowercased. */
  key: string;
  label: string;
  run: () => void;
}

/** Is the caret somewhere the keystroke belongs to the field, not to us? */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Single-key shortcuts, live only while the hands are off the fields.
 *
 * A quoting desk types numbers all day, so a bare letter key can never be
 * claimed while a field has focus — and a modifier means the browser or the OS
 * asked for something, not us.
 */
export function useShortcuts(shortcuts: Shortcut[], enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (typing(e.target)) return;
      const hit = shortcuts.find((s) => s.key === e.key.toLowerCase());
      if (!hit) return;
      e.preventDefault();
      hit.run();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcuts, enabled]);
}

/**
 * Enter walks to the next field instead of submitting.
 *
 * Quotes are entered as a run of numbers. Reaching for the mouse between each
 * one is the slowest part of the job, and a bare Enter in a form otherwise
 * fires whatever button happens to be first.
 */
export function advanceOnEnter(e: React.KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Enter' || e.shiftKey) return;
  const scope = e.currentTarget.closest('[data-field-scope]') ?? document;
  const fields = Array.from(
    scope.querySelectorAll<HTMLElement>('input:not([type="hidden"]), select, textarea'),
  ).filter((el) => !(el as HTMLInputElement).disabled && el.offsetParent !== null);
  const here = fields.indexOf(e.target as HTMLElement);
  if (here < 0) return;
  e.preventDefault();
  const next = fields[here + 1];
  if (next) {
    next.focus();
    if (next instanceof HTMLInputElement) next.select();
  } else {
    (e.target as HTMLElement).blur();
  }
}
