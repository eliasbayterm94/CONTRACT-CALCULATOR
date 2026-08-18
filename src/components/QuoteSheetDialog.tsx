'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { drawQuoteSheet, fileNameFor, type QuoteSheetData } from '@/lib/quoteSheet';

const DEFAULT_NOTE = 'The preview is the file — what you see is what downloads.';

const SAVE_ERRORS: Record<string, string> = {
  declined: 'Save cancelled.',
  rate_limited: 'A save is already open — try again in a moment.',
  too_large: 'The sheet is too large to save.',
  rejected_extension: 'PNG saves are not permitted here.',
  extension_not_enabled: 'PNG saves are not permitted here.',
};

interface Props {
  data: QuoteSheetData | null;
  onClose: () => void;
}

export default function QuoteSheetDialog({ data, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [note, setNote] = useState<{ text: string; tone: 'plain' | 'ok' | 'bad' }>({
    text: DEFAULT_NOTE,
    tone: 'plain',
  });

  useEffect(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    setNote({ text: DEFAULT_NOTE, tone: 'plain' });
    // Wait for the brand faces, or the canvas silently falls back to a system
    // font and the export looks nothing like the app.
    const draw = () => {
      try {
        drawQuoteSheet(canvas, data);
      } catch (error) {
        setNote({ text: (error as Error).message, tone: 'bad' });
      }
    };
    if (document.fonts?.ready) void document.fonts.ready.then(draw);
    else draw();
  }, [data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = data ? 'hidden' : '';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [data, onClose]);

  const savePng = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      setNote({ text: 'The sheet could not be rendered.', tone: 'bad' });
      return;
    }
    const filename = fileNameFor(data.reference, data.client);

    // Inside an embedded viewer a page cannot save a file on its own and has to
    // go through the host. Served as its own app there is no host, and the
    // ordinary browser download applies.
    const claude = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
    if (typeof claude?.use === 'function') {
      const host = (await claude.use('downloads')) as
        | { save: (r: { filename: string; data: Blob }) => Promise<unknown> }
        | null;
      if (host) {
        try {
          await host.save({ filename, data: blob });
          setNote({ text: 'Saved.', tone: 'ok' });
        } catch (error) {
          const code = (error as { code?: string })?.code ?? '';
          setNote({ text: SAVE_ERRORS[code] ?? 'The file could not be saved.', tone: 'bad' });
        }
        return;
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote({ text: 'Saved.', tone: 'ok' });
  }, [data]);

  if (!data) return null;

  return (
    <div
      className="qc-sheet-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Quote sheet"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="qc-sheet-panel">
        <div className="qc-sheet-head">
          <h2>Quote sheet</h2>
          <button type="button" className="qc-drawer-close qc-sheet-close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="qc-sheet-preview">
          <canvas ref={canvasRef} />
        </div>
        <div className="qc-sheet-foot">
          <span
            className="qc-sheet-note"
            role="status"
            style={{
              color:
                note.tone === 'ok' ? 'var(--fc-success)'
                : note.tone === 'bad' ? 'var(--fc-danger)'
                : 'var(--fc-ink-500)',
            }}
          >
            {note.text}
          </span>
          <div className="qc-sheet-actions">
            <button type="button" className="fc-btn fc-btn-ghost" onClick={() => window.print()}>
              Print / PDF
            </button>
            <button type="button" className="fc-btn fc-btn-primary" onClick={savePng}>
              Download PNG
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
