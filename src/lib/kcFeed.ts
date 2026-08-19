import { getKcSpot, setKcSpot } from './store';

/**
 * Latest KC ("Coffee C") price from a public market feed.
 *
 * This is the nearby contract only, delayed by roughly 10-30 minutes, and is
 * not licensed for redistribution to clients. It is a convenience for the desk
 * — a starting number a trader confirms against their own feed before quoting.
 * The forward curve still comes from the KC table in admin.
 */

export interface KcQuote {
  priceCents: number;
  asOf: string;
  source: string;
  /** True when the figure came from the stored copy rather than a live call. */
  cached: boolean;
}

export interface KcFetchFailure {
  error: string;
  /** The last good figure, if we have one, so the desk is not left blank. */
  fallback: KcQuote | null;
}

/** Anything outside this is a parse error, not a market move. */
const PLAUSIBLE_CENTS = { min: 20, max: 1500 };

async function fetchYahoo(signal: AbortSignal): Promise<{ cents: number; asOf: string }> {
  const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/KC%3DF?interval=1d&range=1d', {
    signal,
    headers: { accept: 'application/json', 'user-agent': 'forest-contract-calculator' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as {
    chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; regularMarketTime?: number } }> };
  };
  const meta = body.chart?.result?.[0]?.meta;
  const cents = Number(meta?.regularMarketPrice);
  if (!Number.isFinite(cents)) throw new Error('no price in response');
  const seconds = Number(meta?.regularMarketTime);
  return {
    cents,
    asOf: Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : new Date().toISOString(),
  };
}

async function fetchStooq(signal: AbortSignal): Promise<{ cents: number; asOf: string }> {
  const res = await fetch('https://stooq.com/q/l/?s=kc.f&f=sd2t2ohlc&h&e=csv', {
    signal,
    headers: { accept: 'text/csv' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const [header, row] = text.trim().split(/\r?\n/);
  if (!row) throw new Error('empty response');
  const cols = header.toLowerCase().split(',');
  const values = row.split(',');
  const close = Number(values[cols.indexOf('close')]);
  if (!Number.isFinite(close)) throw new Error('no close in response');
  const date = values[cols.indexOf('date')];
  const time = values[cols.indexOf('time')] || '00:00:00';
  const parsed = new Date(`${date}T${time}Z`);
  return { cents: close, asOf: Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString() };
}

/**
 * Try each source in turn and keep the first plausible answer. A failure never
 * disturbs the stored figure — the desk keeps whatever it last had.
 */
export async function fetchLatestKc(): Promise<KcQuote | KcFetchFailure> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const attempts: Array<[string, (s: AbortSignal) => Promise<{ cents: number; asOf: string }>]> = [
    ['Yahoo Finance (KC=F)', fetchYahoo],
    ['Stooq (kc.f)', fetchStooq],
  ];
  const problems: string[] = [];

  try {
    for (const [source, run] of attempts) {
      try {
        const { cents, asOf } = await run(controller.signal);
        if (cents < PLAUSIBLE_CENTS.min || cents > PLAUSIBLE_CENTS.max) {
          throw new Error(`${cents.toFixed(2)}c is outside the plausible range`);
        }
        await setKcSpot(cents, asOf, source);
        return { priceCents: cents, asOf, source, cached: false };
      } catch (error) {
        problems.push(`${source}: ${(error as Error).message}`);
      }
    }
  } finally {
    clearTimeout(timer);
  }

  const stored = await getKcSpot();
  return {
    error: problems.join('; ') || 'no source responded',
    fallback: stored
      ? { priceCents: stored.priceCents, asOf: stored.asOf, source: stored.source, cached: true }
      : null,
  };
}

export function isFailure(result: KcQuote | KcFetchFailure): result is KcFetchFailure {
  return 'error' in result;
}

/** How stale a stored quote is, in minutes. */
export function ageInMinutes(iso: string): number {
  const then = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).getTime();
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round((Date.now() - then) / 60000));
}
