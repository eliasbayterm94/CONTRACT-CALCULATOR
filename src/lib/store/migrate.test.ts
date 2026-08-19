import { describe, expect, it } from 'vitest';
import { migrate } from './index';
import { STATE_VERSION, type AppState } from './types';

/** A version 1 document, with the desk's own costing in it. */
function v1(): AppState & { premiums: unknown[] } {
  return {
    version: 1,
    settings: { minMargin: 0.18, ladder: [0.18, 0.25] },
    costLines: [{ key: 'freight_agent', amount: 4_200_000 }],
    packaging: [{ key: 'jute_70' }],
    processes: [{ key: 'washed' }],
    destinations: [{ key: 'rotterdam' }],
    fx: [{ currency: 'EUR', usdPerUnit: 1.11, source: 'ecb', isOverride: true, fetchedAt: 'x' }],
    kcPrices: [{ monthKey: '2026U', priceCents: 331.6, updatedAt: 'x', updatedBy: 'admin' }],
    premiums: [{ monthKey: '2026U', qualityKey: 'standard', premiumCents: 45 }],
    kcSpot: { priceCents: 331.6, asOf: 'x', source: 'yahoo', fetchedAt: 'x' },
    audit: [{ id: 1, at: 'x', actor: 'admin', entity: 'fx', entityId: null, action: 'u', detail: null }],
  } as unknown as AppState & { premiums: unknown[] };
}

describe('moving a stored document to the seasonal premium', () => {
  it('carries the desk configuration across untouched', () => {
    const out = migrate(v1())!;
    expect(out.version).toBe(STATE_VERSION);
    expect(out.settings.minMargin).toBe(0.18);
    expect(out.costLines).toEqual([{ key: 'freight_agent', amount: 4_200_000 }]);
    expect(out.destinations).toEqual([{ key: 'rotterdam' }]);
    expect(out.fx[0].isOverride).toBe(true);
    expect(out.kcPrices[0].priceCents).toBe(331.6);
    expect(out.kcSpot?.source).toBe('yahoo');
    expect(out.audit).toHaveLength(1);
  });

  it('opens twelve months of season, none of them claiming to be set', () => {
    const out = migrate(v1())!;
    expect(out.seasonalPremiums.map((p) => p.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(out.seasonalPremiums.every((p) => p.updatedBy === 'seed')).toBe(true);
    expect(out.premiumOverrides).toEqual([]);
  });

  it('drops the KC-keyed premiums rather than pretending they are months', () => {
    const out = migrate(v1())! as AppState & { premiums?: unknown };
    expect(out.premiums).toBeUndefined();
  });

  it('leaves a current document exactly as it found it', () => {
    const current = { ...v1(), version: STATE_VERSION } as unknown as AppState;
    expect(migrate(current)).toBe(current);
  });

  it('refuses a version it does not know, rather than guessing', () => {
    const future = { ...v1(), version: 99 } as unknown as AppState;
    expect(migrate(future)).toBeNull();
  });
});
