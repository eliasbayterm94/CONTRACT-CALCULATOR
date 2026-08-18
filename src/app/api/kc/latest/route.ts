import { NextResponse } from 'next/server';
import { ensureSeeded } from '@/lib/db/seed';
import { fetchLatestKc, isFailure } from '@/lib/kcFeed';

export const dynamic = 'force-dynamic';

/**
 * Latest KC for the quote screen's "fetch" button.
 *
 * A failure returns 200 with the last stored figure rather than an error
 * status: the desk should still see a number and be told it is stale, instead
 * of being handed an empty field mid-quote.
 */
export async function GET() {
  ensureSeeded();
  const result = await fetchLatestKc();
  if (isFailure(result)) {
    return NextResponse.json(
      { ok: false, error: result.error, fallback: result.fallback },
      { headers: { 'cache-control': 'no-store' } },
    );
  }
  return NextResponse.json({ ok: true, quote: result }, { headers: { 'cache-control': 'no-store' } });
}
