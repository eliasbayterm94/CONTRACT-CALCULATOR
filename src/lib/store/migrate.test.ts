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
    processes: [{ key: 'washed', label: 'Washed', amount: 50_000, lbsPerUnit: 154.322, currency: 'COP', active: true }],
    destinations: [
      { key: 'rotterdam', quoteCurrency: 'EUR', quoteUnit: 'kg' },
      { key: 'canada', quoteCurrency: 'CAD', quoteUnit: 'kg' },
    ],
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
    expect(out.destinations.find((d) => d.key === 'rotterdam')).toMatchObject({
      quoteCurrency: 'EUR', quoteUnit: 'kg',
    });
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

describe('moving a stored document to coffee types', () => {
  it('arrives at the current version in one pass, however far behind it was', () => {
    const out = migrate(v1())!;
    expect(out.version).toBe(STATE_VERSION);
    // The seasonal premium from the first step is still there after the second.
    expect(out.seasonalPremiums).toHaveLength(12);
  });

  it('gives every existing type the premium it has been charging: none', () => {
    const out = migrate(v1())!;
    const washed = out.processes.find((p) => p.key === 'washed')!;
    expect(washed.premiumCents).toBe(0);
    expect(washed.amount).toBe(50_000);
  });

  it('renames the seeded washed row, and leaves a renamed one alone', () => {
    expect(migrate(v1())!.processes.find((p) => p.key === 'washed')!.label).toBe('Fully washed');

    const renamed = v1();
    (renamed.processes as Array<{ label: string }>)[0].label = 'Lavado';
    expect(migrate(renamed)!.processes.find((p) => p.key === 'washed')!.label).toBe('Lavado');
  });

  it('adds the types the desk asked for', () => {
    const keys = migrate(v1())!.processes.map((p) => p.key);
    expect(keys).toContain('decaf');
    expect(keys).toContain('organic');
    expect(keys).toContain('supremo');
    const byKey = Object.fromEntries(migrate(v1())!.processes.map((p) => [p.key, p.premiumCents]));
    expect(byKey.decaf).toBe(30);
    expect(byKey.organic).toBe(35);
    expect(byKey.supremo).toBe(25);
  });

  it('does not add a type the desk already has', () => {
    const already = v1();
    (already.processes as unknown[]).push({
      key: 'decaf', label: 'Descafeinado', amount: 61_000,
      lbsPerUnit: 154.322, currency: 'COP', active: true,
    });
    const decafs = migrate(already)!.processes.filter((p) => p.key === 'decaf');
    expect(decafs).toHaveLength(1);
    expect(decafs[0].label).toBe('Descafeinado');
    expect(decafs[0].amount).toBe(61_000);
  });

  it('puts Canada on dollars a pound', () => {
    const canada = migrate(v1())!.destinations.find((d) => d.key === 'canada')!;
    expect(canada.quoteCurrency).toBe('USD');
    expect(canada.quoteUnit).toBe('lb');
  });

  it('leaves a Canada the desk has already set for itself', () => {
    const chosen = v1();
    const row = chosen.destinations.find((d) => d.key === 'canada')!;
    row.quoteCurrency = 'CAD';
    row.quoteUnit = 'lb';
    const out = migrate(chosen)!.destinations.find((d) => d.key === 'canada')!;
    expect(out.quoteCurrency).toBe('CAD');
    expect(out.quoteUnit).toBe('lb');
  });

  it('refuses a version it cannot step forward from', () => {
    expect(migrate({ ...v1(), version: 99 } as never)).toBeNull();
  });
});

describe('dropping the sign-in', () => {
  it('takes the stored credential with it', () => {
    const withCode = v1();
    Object.assign(withCode.settings, {
      adminCode: { salt: 'abc', hash: 'def' },
      adminLockout: { failed: 2, until: 'x' },
      sessionSecret: 'a-secret',
    });
    const out = migrate(withCode)!;
    expect(out.settings.adminCode).toBeUndefined();
    expect(out.settings.adminLockout).toBeUndefined();
    expect(out.settings.sessionSecret).toBeUndefined();
  });

  it('leaves the pricing policy beside it alone', () => {
    const withCode = v1();
    Object.assign(withCode.settings, { adminCode: { salt: 'a', hash: 'b' } });
    const out = migrate(withCode)!;
    expect(out.settings.minMargin).toBe(0.18);
    expect(out.version).toBe(STATE_VERSION);
  });
});
