'use client';

import { useEffect } from 'react';

/**
 * Copy each column heading onto the cells beneath it.
 *
 * Under about 720px the admin tables stop being tables and stack into cards,
 * where a bare number means nothing without the heading that was scrolled off
 * to the right. CSS can print a label from an attribute but cannot read one
 * out of `thead`, so the attribute is stamped here rather than written out by
 * hand on every cell in six editors.
 *
 * Runs again whenever the tables change, because a save re-renders the rows.
 */
export default function CardLabels() {
  useEffect(() => {
    const stamp = () => {
      for (const table of document.querySelectorAll<HTMLTableElement>('table.qc-cards')) {
        const headings = Array.from(table.querySelectorAll('thead th')).map((th) =>
          (th.textContent ?? '').trim(),
        );
        if (!headings.length) continue;
        for (const row of table.querySelectorAll('tbody tr')) {
          const cells = Array.from(row.children) as HTMLTableCellElement[];
          // A cell spanning the table is a group heading, not a field.
          if (cells.length === 1 && cells[0].colSpan > 1) continue;
          cells.forEach((cell, i) => {
            const label = headings[i] ?? '';
            if (label && cell.dataset.label !== label) cell.dataset.label = label;
          });
        }
      }
    };

    stamp();
    const observer = new MutationObserver(() => requestAnimationFrame(stamp));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
