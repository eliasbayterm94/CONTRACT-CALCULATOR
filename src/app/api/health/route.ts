import { NextResponse } from 'next/server';
import { loadState, storeName } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * Is the store reachable, and which one answered?
 *
 * A deployed instance that cannot write its state fails on every page with
 * nothing but a generic error screen. This route says which driver was chosen
 * and what went wrong, so a bad deploy is one URL away from an explanation
 * rather than a dig through the host's logs.
 */
export async function GET() {
  try {
    const state = await loadState();
    return NextResponse.json({
      ok: true,
      store: await storeName(),
      costLines: state.costLines.length,
      destinations: state.destinations.length,
      adminCodeSet: Boolean(state.settings.adminCode),
    });
  } catch (error) {
    const problem = error instanceof Error ? error : new Error(String(error));
    return NextResponse.json(
      { ok: false, error: problem.message, cause: String((problem.cause as Error)?.message ?? '') },
      { status: 500 },
    );
  }
}
