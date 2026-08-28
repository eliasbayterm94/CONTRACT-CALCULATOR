'use client';

import { useCallback } from 'react';
import SheetDialog from './SheetDialog';
import { drawQuoteSheet, fileNameFor, type QuoteSheetData } from '@/lib/quoteSheet';

export default function QuoteSheetDialog({
  data,
  onClose,
}: {
  data: QuoteSheetData | null;
  onClose: () => void;
}) {
  const render = useCallback(
    (canvas: HTMLCanvasElement) => {
      if (data) drawQuoteSheet(canvas, data);
    },
    [data],
  );

  return (
    <SheetDialog
      data={data}
      render={render}
      filename={data ? fileNameFor(data.reference, data.client) : 'quote.png'}
      title="Quote sheet"
      onClose={onClose}
    />
  );
}
