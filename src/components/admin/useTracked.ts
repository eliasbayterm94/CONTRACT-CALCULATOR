'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Edit-in-place state for an admin table.
 *
 * Keeps the saved rows beside the working copy so the editor can show what has
 * changed, undo a single row, and tell you how many edits are pending before
 * you commit any of them.
 */
export function useTracked<T extends { key: string }>(saved: T[]) {
  const [rows, setRows] = useState<T[]>(saved);

  /**
   * Adopt the server's rows whenever they actually change — after a save, or
   * after someone else edits the table. Compared by value, because the server
   * component hands us a fresh array on every render and identity alone would
   * wipe out whatever is being typed.
   */
  const savedJson = JSON.stringify(saved);
  const lastAdopted = useRef(savedJson);
  useEffect(() => {
    if (lastAdopted.current === savedJson) return;
    lastAdopted.current = savedJson;
    setRows(saved);
  }, [savedJson, saved]);

  const update = useCallback(<K extends keyof T>(key: string, field: K, value: T[K]) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }, []);

  const resetRow = useCallback(
    (key: string) => {
      const original = saved.find((r) => r.key === key);
      if (original) setRows((prev) => prev.map((r) => (r.key === key ? original : r)));
    },
    [saved],
  );

  const resetAll = useCallback(() => setRows(saved), [saved]);

  const dirtyKeys = useMemo(() => {
    const out = new Set<string>();
    for (const row of rows) {
      const original = saved.find((r) => r.key === row.key);
      if (!original) continue;
      for (const field of Object.keys(row) as Array<keyof T>) {
        if (differs(row[field], original[field])) {
          out.add(row.key);
          break;
        }
      }
    }
    return out;
  }, [rows, saved]);

  const isDirty = useCallback(
    (key: string, field: keyof T) => {
      const original = saved.find((r) => r.key === key);
      const current = rows.find((r) => r.key === key);
      if (!original || !current) return false;
      return differs(original[field], current[field]);
    },
    [rows, saved],
  );

  return { rows, update, resetRow, resetAll, dirtyKeys, isDirty };
}

/**
 * Compare by value, not identity.
 *
 * The server hands us a fresh object on every render, so an array field like a
 * destination's allowed incoterms is never the same instance twice. Identity
 * comparison marked every row edited the moment the page loaded.
 */
function differs(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return false;
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) !== JSON.stringify(b);
  }
  return true;
}

/** `is-dirty` only when it is, so the class list stays readable in the markup. */
export const dirtyClass = (base: string, dirty: boolean) => (dirty ? `${base} is-dirty` : base);
