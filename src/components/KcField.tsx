'use client';

import { useState } from 'react';

interface Spot {
  priceCents: number;
  asOf: string;
  source: string;
}

/**
 * KC price with a button to pull the latest from the market.
 *
 * The feed is the nearby contract, delayed and unlicensed for redistribution,
 * so the field says where the number came from and how old it is. It is a
 * starting point a trader confirms, never a fixing price.
 */
export default function KcField({
  value,
  onChange,
  spot,
}: {
  value: string;
  onChange: (next: string) => void;
  spot: Spot | null;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: 'plain' | 'ok' | 'bad' }>({
    text: spot
      ? `Last fetched ${describeAge(spot.asOf)} · ${spot.source}`
      : 'Type a projected price to test a scenario',
    tone: 'plain',
  });

  async function fetchLatest() {
    setBusy(true);
    setStatus({ text: 'Fetching…', tone: 'plain' });
    try {
      const res = await fetch('/api/kc/latest', { cache: 'no-store' });
      const body = await res.json();
      if (body.ok) {
        onChange(body.quote.priceCents.toFixed(2));
        setStatus({
          text: `${body.quote.source} · ${describeAge(body.quote.asOf)} · delayed, confirm before fixing`,
          tone: 'ok',
        });
      } else if (body.fallback) {
        onChange(body.fallback.priceCents.toFixed(2));
        setStatus({
          text: `Feed unavailable — using the last stored price from ${describeAge(body.fallback.asOf)}.`,
          tone: 'bad',
        });
      } else {
        setStatus({ text: 'No KC price available from the feed. Enter it by hand.', tone: 'bad' });
      }
    } catch {
      setStatus({ text: 'Could not reach the market feed. Enter the price by hand.', tone: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="qc-kc-row">
        <input
          type="number"
          step="any"
          inputMode="decimal"
          aria-label="KC price in US cents per pound"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="qc-kc-fetch" onClick={fetchLatest} disabled={busy}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 4v5h-5" />
          </svg>
          {busy ? 'Fetching' : 'Latest'}
        </button>
      </div>
      <p
        className="qc-market-hint"
        role="status"
        style={{
          color:
            status.tone === 'ok' ? 'var(--fc-teal)'
            : status.tone === 'bad' ? 'var(--fc-danger-light)'
            : undefined,
        }}
      >
        {status.text}
      </p>
    </>
  );
}

function describeAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'an unknown time ago';
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
