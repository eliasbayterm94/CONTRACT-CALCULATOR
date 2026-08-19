import { getFxRows, logAudit, mutateState } from './store';
import type { CurrencyCode } from './pricing/types';
import { trmToUsdPerCop } from './pricing/units';

export interface FxFetchResult {
  updated: Array<{ currency: CurrencyCode; usdPerUnit: number; source: string }>;
  skipped: Array<{ currency: CurrencyCode; reason: string }>;
  errors: string[];
}

/** Banco de la República's official TRM, published on datos.gov.co. */
async function fetchTrm(signal: AbortSignal): Promise<number> {
  const url =
    'https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde%20DESC&$limit=1';
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`TRM request failed: HTTP ${res.status}`);
  const rows = (await res.json()) as Array<{ valor?: string; vigenciadesde?: string }>;
  const value = Number(rows?.[0]?.valor);
  if (!Number.isFinite(value) || value <= 0) throw new Error('TRM response had no usable value');
  return value;
}

/** ECB reference rates via Frankfurter — free, no key, updated each working day. */
async function fetchEcb(
  symbols: CurrencyCode[],
  signal: AbortSignal,
): Promise<Record<string, number>> {
  const url = `https://api.frankfurter.app/latest?from=USD&to=${symbols.join(',')}`;
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`ECB request failed: HTTP ${res.status}`);
  const body = (await res.json()) as { rates?: Record<string, number> };
  if (!body.rates) throw new Error('ECB response had no rates');
  // Frankfurter returns units of the target per 1 USD; we store USD per unit.
  const out: Record<string, number> = {};
  for (const [code, perUsd] of Object.entries(body.rates)) {
    if (perUsd > 0) out[code] = 1 / perUsd;
  }
  return out;
}

/**
 * Refresh every non-overridden rate from its source.
 *
 * Rates a trader has pinned with a manual override are left untouched — a
 * booked forward rate must never be silently replaced by spot.
 */
export async function refreshFxRates(actor: string): Promise<FxFetchResult> {
  const result: FxFetchResult = { updated: [], skipped: [], errors: [] };
  const rows = await getFxRows();
  const overridden = new Set(rows.filter((r) => r.isOverride).map((r) => r.currency));
  for (const currency of overridden) {
    result.skipped.push({ currency, reason: 'Manual override in place' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  /** A pinned rate is never touched by a fetch. */
  const write = async (currency: CurrencyCode, usdPerUnit: number, source: string) => {
    await mutateState((state) => {
      const row = state.fx.find((r) => r.currency === currency);
      if (!row || row.isOverride) return;
      Object.assign(row, { usdPerUnit, source, fetchedAt: new Date().toISOString() });
    });
  };

  try {
    const wanted = (['EUR', 'GBP', 'AUD', 'CAD'] as CurrencyCode[]).filter(
      (c) => !overridden.has(c),
    );

    const [trm, ecb] = await Promise.allSettled([
      overridden.has('COP')
        ? Promise.reject(new Error('skipped'))
        : fetchTrm(controller.signal),
      wanted.length ? fetchEcb(wanted, controller.signal) : Promise.resolve({} as Record<string, number>),
    ]);

    if (trm.status === 'fulfilled') {
      const usdPerCop = trmToUsdPerCop(trm.value);
      await write('COP', usdPerCop, `TRM ${trm.value.toFixed(2)} (Banco de la República)`);
      result.updated.push({
        currency: 'COP',
        usdPerUnit: usdPerCop,
        source: `TRM ${trm.value.toFixed(2)}`,
      });
    } else if (!overridden.has('COP')) {
      result.errors.push(`TRM: ${(trm.reason as Error)?.message ?? 'failed'}`);
    }

    if (ecb.status === 'fulfilled') {
      for (const [code, usdPerUnit] of Object.entries(ecb.value)) {
        await write(code as CurrencyCode, usdPerUnit, 'ECB (Frankfurter)');
        result.updated.push({ currency: code as CurrencyCode, usdPerUnit, source: 'ECB' });
      }
    } else {
      result.errors.push(`ECB: ${(ecb.reason as Error)?.message ?? 'failed'}`);
    }
  } finally {
    clearTimeout(timer);
  }

  await logAudit(actor, 'fx_rates', null, 'refresh', result);
  return result;
}

/** Pin a rate by hand — a booked forward, or a hedged TRM. */
export async function overrideFxRate(
  currency: CurrencyCode,
  usdPerUnit: number,
  actor: string,
  note = 'Manual override',
): Promise<void> {
  await mutateState((state) => {
    const row = state.fx.find((r) => r.currency === currency);
    const fetchedAt = new Date().toISOString();
    if (row) Object.assign(row, { usdPerUnit, source: note, isOverride: true, fetchedAt });
    else state.fx.push({ currency, usdPerUnit, source: note, isOverride: true, fetchedAt });
  });
  await logAudit(actor, 'fx_rates', currency, 'override', { usdPerUnit, note });
}

/** Release an override so the currency tracks its live source again. */
export async function clearFxOverride(currency: CurrencyCode, actor: string): Promise<void> {
  await mutateState((state) => {
    const row = state.fx.find((r) => r.currency === currency);
    if (row) row.isOverride = false;
  });
  await logAudit(actor, 'fx_rates', currency, 'clear_override');
}
