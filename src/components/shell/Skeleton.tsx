/**
 * The shape of a page while its data is on the wire.
 *
 * Every route is server-rendered on each request, so a tab switch costs a
 * round trip. Without this the old page simply sits there for the duration and
 * the click reads as ignored — the wait was never the complaint, the silence
 * was. Blocks are laid out to match what lands, so nothing jumps when it does.
 */
export default function Skeleton({ variant }: { variant: 'quote' | 'multi' | 'admin' }) {
  if (variant === 'admin') {
    return (
      <Shell>
        <Panel rows={4} />
        <Panel rows={7} />
        <Panel rows={5} />
      </Shell>
    );
  }

  if (variant === 'multi') {
    return (
      <Shell>
        <Panel rows={3} />
        <Panel rows={6} />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="fc-skel-split">
        <Panel rows={6} />
        <div>
          <Panel rows={3} />
          <Panel rows={5} />
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fc-skel" aria-busy="true" aria-live="polite">
      <span className="fc-skel-sr">Loading</span>
      {children}
    </div>
  );
}

function Panel({ rows }: { rows: number }) {
  return (
    <div className="fc-skel-panel">
      <div className="fc-skel-bar fc-skel-title" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`fc-skel-bar${i % 3 === 2 ? ' is-short' : ''}`} />
      ))}
    </div>
  );
}
