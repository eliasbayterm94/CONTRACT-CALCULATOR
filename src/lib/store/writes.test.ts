import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * A save is one write.
 *
 * In production the store is over the network, and a row at a time meant a
 * round trip each: eight KC months cost eighteen. That is slow enough to run
 * a serverless function out of time, and every extra trip is another way for
 * a save to fail halfway.
 */
const saves: unknown[] = [];
const loads: number[] = [];

vi.mock('./drivers', () => ({
  createDriver: async () => ({
    name: 'memory',
    load: async () => {
      loads.push(1);
      return state;
    },
    save: async (s: unknown) => {
      saves.push(s);
      state = JSON.parse(JSON.stringify(s));
    },
  }),
}));

let state: Record<string, unknown>;

beforeEach(async () => {
  vi.resetModules();
  saves.length = 0;
  loads.length = 0;
  const { STATE_VERSION } = await import('./types');
  state = {
    version: STATE_VERSION,
    settings: {},
    costLines: [], packaging: [], processes: [], destinations: [],
    fx: [{ currency: 'EUR', usdPerUnit: 1.09, source: 'seed', isOverride: false, fetchedAt: 'x' }],
    kcPrices: [], seasonalPremiums: [], premiumOverrides: [], kcSpot: null, audit: [],
  };
});

describe('writes per save', () => {
  it('sets many KC months in a single write', async () => {
    const store = await import('./index');
    await store.mutateState((s) => {
      for (const m of ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']) {
        store.applyKcPrice(s, m, 300, 'admin');
      }
      store.appendAudit(s, 'admin', 'kc_prices', null, 'bulk_update', { count: 8 });
    });
    expect(saves).toHaveLength(1);
    expect(state.kcPrices).toHaveLength(8);
    expect(state.audit).toHaveLength(1);
  });

  it('sets the whole season in a single write', async () => {
    const store = await import('./index');
    await store.mutateState((s) => {
      for (let m = 1; m <= 12; m += 1) store.applySeasonalPremium(s, m, 40 + m, 'admin');
      store.appendAudit(s, 'admin', 'seasonal_premiums', null, 'bulk_update', { count: 12 });
    });
    expect(saves).toHaveLength(1);
    expect(state.seasonalPremiums).toHaveLength(12);
  });

  it('appends the audit entry without a write of its own', async () => {
    const store = await import('./index');
    await store.mutateState((s) => {
      store.applyFxOverride(s, 'EUR', 1.11, 'Manual override');
      store.appendAudit(s, 'admin', 'fx_rates', null, 'bulk_override', { pinned: ['EUR'] });
    });
    expect(saves).toHaveLength(1);
    expect((state.fx as Array<{ isOverride: boolean }>)[0].isOverride).toBe(true);
    expect(state.audit).toHaveLength(1);
  });

  it('keeps the audit log from growing without bound', async () => {
    const store = await import('./index');
    const { AUDIT_LIMIT } = await import('./types');
    await store.mutateState((s) => {
      for (let i = 0; i < AUDIT_LIMIT + 50; i += 1) {
        store.appendAudit(s, 'admin', 'fx_rates', null, 'refresh');
      }
    });
    expect((state.audit as unknown[]).length).toBe(AUDIT_LIMIT);
  });
});
