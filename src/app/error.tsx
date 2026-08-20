'use client';

import { useEffect } from 'react';

/**
 * What a failed render looks like.
 *
 * Next replaces the page with its own bare "a server-side exception has
 * occurred" and a digest, which tells the desk nothing and offers no way
 * forward. This keeps the digest — it is the key to the host's log — but says
 * plainly what is and is not known, and gives a way back.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[render]', error);
  }, [error]);

  return (
    <div className="qc-fault" role="alert">
      <h1 className="qc-fault-title">This page could not be drawn</h1>
      <p className="qc-fault-body">
        Something went wrong rendering it. Nothing you were editing has been lost from the store —
        but if you had unsaved boxes open, those are gone, so check the figures before trusting them.
      </p>
      <div className="qc-fault-actions">
        <button type="button" className="fc-btn fc-btn-primary" onClick={reset}>
          Try again
        </button>
        <a className="fc-btn fc-btn-ghost" href="/api/health">
          Check the store
        </a>
      </div>
      {error.digest && (
        <p className="qc-fault-digest">
          Reference <code>{error.digest}</code> — quote this to find the full error in the host&apos;s
          function log.
        </p>
      )}
    </div>
  );
}
