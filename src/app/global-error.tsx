'use client';

/**
 * The last resort: a failure in the root layout itself, where the app shell
 * and its stylesheet are not available. Everything here is inline for that
 * reason.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#f5f4ee', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 520, margin: '18vh auto', padding: '0 20px', color: '#1b203d' }}>
          <h1 style={{ fontSize: 20, marginBottom: 10 }}>Quote Desk could not start</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#5a5a55' }}>
            The application failed before it could draw anything. Your saved rates and costs are not
            affected by this.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 14, padding: '10px 18px', border: 0, borderRadius: 8,
              background: '#e7e244', color: '#1b203d', fontWeight: 700, cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: 18, fontSize: 12, color: '#9a9a93' }}>
              Reference <code>{error.digest}</code>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
