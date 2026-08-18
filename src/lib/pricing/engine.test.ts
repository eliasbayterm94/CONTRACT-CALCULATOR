import { describe, expect, it } from 'vitest';
import { calculateQuote, marginAtPrice, priceAtMargin, solveForPrice } from './engine';
import {
  SEED_COST_LINES,
  SEED_DESTINATIONS,
  SEED_FX,
  SEED_PACKAGING,
  SEED_PROCESSES,
  SEED_SETTINGS,
} from './reference';
import type { QuoteInput, ReferenceData } from './types';
import { DEFAULT_LBS_PER_CONTAINER, fromQuoteUnit, toQuoteUnit } from './units';

const ref: ReferenceData = {
  costLines: SEED_COST_LINES,
  packaging: SEED_PACKAGING,
  processes: SEED_PROCESSES,
  destinations: SEED_DESTINATIONS,
  fx: SEED_FX,
  settings: SEED_SETTINGS,
};

function input(overrides: Partial<QuoteInput> = {}): QuoteInput {
  return {
    destinationKey: 'ny',
    incoterm: 'FOB',
    processKey: 'washed',
    packagingKey: 'jute_70',
    quantity: 1,
    quantityMode: 'containers',
    lbsPerContainer: DEFAULT_LBS_PER_CONTAINER,
    kcMonth: '2026H',
    kcPriceUsdPerLb: 0,
    premiumUsdPerLb: 0,
    disabledLines: [],
    enabledLines: [],
    storageMonths: 0,
    financeMonths: 0,
    ...overrides,
  };
}

describe('reconciliation with the source sheet', () => {
  it('reproduces the $0.564/lb FOB differential for washed coffee in 70 kg bags', () => {
    const r = calculateQuote(input(), ref);
    expect(r.differentialUsdPerLb).toBeCloseTo(0.5641, 4);
  });

  it('reproduces each individual cost line from the sheet, in COP per pound', () => {
    const r = calculateQuote(input(), ref);
    const cop = (key: string) => r.lines.find((l) => l.key === key)!.nativePerLb!;
    expect(cop('packaging')).toBeCloseTo(59.13, 2);
    expect(cop('grain_pro')).toBeCloseTo(46.91, 2);
    expect(cop('milling')).toBeCloseTo(324.0, 1);
    expect(cop('bag_marks')).toBeCloseTo(2.59, 2);
    expect(cop('internal_transport')).toBeCloseTo(85.09, 2);
    expect(cop('ground_transport')).toBeCloseTo(139.57, 2);
    expect(cop('port_costs')).toBeCloseTo(31.1, 2);
    expect(cop('freight_agent')).toBeCloseTo(108.86, 2);
  });

  it('matches the sheet on ocean freight and import cost per pound', () => {
    const cif = calculateQuote(input({ incoterm: 'CIF' }), ref);
    const sea = cif.lines.find((l) => l.key === 'seafreight')!;
    expect(sea.usdPerLb).toBeCloseTo(0.0648, 4);

    const ddp = calculateQuote(input({ incoterm: 'DDP' }), ref);
    const imp = ddp.lines.find((l) => l.key === 'import_cost')!;
    expect(imp.usdPerLb).toBeCloseTo(0.0674, 4);
  });

  it('prices the full DDP differential for every destination', () => {
    const expected: Record<string, number> = {
      ny: 0.6963,
      dupuy: 0.6833,
      annex: 0.6963,
      canada: 0.6937,
      australia: 0.7222,
      rotterdam: 0.6756,
      uk: 0.6756,
      dubai: 0.7844,
    };
    for (const [key, want] of Object.entries(expected)) {
      const r = calculateQuote(input({ destinationKey: key, incoterm: 'DDP' }), ref);
      expect(r.differentialUsdPerLb, key).toBeCloseTo(want, 3);
    }
  });
});

describe('incoterm ladder', () => {
  it('adds ocean freight only from CIF, and import only at DDP', () => {
    const fob = calculateQuote(input({ incoterm: 'FOB' }), ref);
    const cif = calculateQuote(input({ incoterm: 'CIF' }), ref);
    const ddp = calculateQuote(input({ incoterm: 'DDP' }), ref);
    expect(cif.differentialUsdPerLb).toBeGreaterThan(fob.differentialUsdPerLb);
    expect(ddp.differentialUsdPerLb).toBeGreaterThan(cif.differentialUsdPerLb);
    expect(fob.lines.find((l) => l.key === 'seafreight')!.included).toBe(false);
    expect(cif.lines.find((l) => l.key === 'import_cost')!.included).toBe(false);
    expect(ddp.lines.find((l) => l.key === 'import_cost')!.included).toBe(true);
  });
});

describe('quote selections that move the price', () => {
  it('charges more milling for honey and natural', () => {
    const washed = calculateQuote(input(), ref).differentialUsdPerLb;
    const honey = calculateQuote(input({ processKey: 'honey' }), ref).differentialUsdPerLb;
    const natural = calculateQuote(input({ processKey: 'natural' }), ref).differentialUsdPerLb;
    expect(honey - washed).toBeCloseTo(0.0411, 3);
    expect(natural - washed).toBeCloseTo(0.0823, 3);
  });

  it('charges more packaging for smaller bags', () => {
    const b70 = calculateQuote(input(), ref).differentialUsdPerLb;
    const b35 = calculateQuote(input({ packagingKey: 'pack_35' }), ref).differentialUsdPerLb;
    const b24 = calculateQuote(input({ packagingKey: 'pack_24' }), ref).differentialUsdPerLb;
    expect(b35).toBeGreaterThan(b70);
    expect(b24).toBeGreaterThan(b35);
    expect(b35 - b70).toBeCloseTo(0.0834, 3);
  });

  it('drops optional lines when the trader switches them off', () => {
    const withLiner = calculateQuote(input(), ref).differentialUsdPerLb;
    const without = calculateQuote(input({ disabledLines: ['grain_pro'] }), ref);
    expect(withLiner - without.differentialUsdPerLb).toBeCloseTo(0.0149, 4);
    expect(without.lines.find((l) => l.key === 'grain_pro')!.included).toBe(false);
  });
});

describe('month-driven costs', () => {
  it('leaves storage and finance out until they are switched on', () => {
    const r = calculateQuote(input(), ref);
    expect(r.storageUsdPerLb).toBe(0);
    expect(r.financeUsdPerLb).toBe(0);
  });

  it('charges storage per packaging unit per month', () => {
    const r = calculateQuote(
      input({ enabledLines: ['storage'], storageMonths: 3 }),
      ref,
    );
    // $1.05 per 70 kg bag per month, over 154.322 lb, for three months.
    expect(r.storageUsdPerLb).toBeCloseTo((1.05 / 154.322) * 3, 6);
  });

  it('charges more storage per pound for smaller bags', () => {
    const big = calculateQuote(input({ enabledLines: ['storage'], storageMonths: 1 }), ref);
    const small = calculateQuote(
      input({ enabledLines: ['storage'], storageMonths: 1, packagingKey: 'pack_24' }),
      ref,
    );
    expect(small.storageUsdPerLb).toBeGreaterThan(big.storageUsdPerLb);
  });

  it('charges finance on the full cargo value, not just the differential', () => {
    const r = calculateQuote(
      input({ enabledLines: ['finance'], financeMonths: 2, kcPriceUsdPerLb: 1.85 }),
      ref,
    );
    const expectedBase = 1.85 + r.differentialUsdPerLb;
    expect(r.financeUsdPerLb).toBeCloseTo(0.0072 * 2 * expectedBase, 6);
    // The sheet charged 0.72% on the $0.564 stack alone; the correct base is
    // roughly four times larger, so the line must be materially bigger.
    expect(r.financeUsdPerLb).toBeGreaterThan(0.0072 * 2 * 0.564 * 3);
  });

  it('warns instead of silently pricing storage at zero for Dubai', () => {
    const r = calculateQuote(
      input({ destinationKey: 'dubai', enabledLines: ['storage'], storageMonths: 2 }),
      ref,
    );
    expect(r.storageUsdPerLb).toBe(0);
    expect(r.warnings.some((w) => w.includes('Storage'))).toBe(true);
  });
});

describe('FX sensitivity', () => {
  it('reports the COP-denominated share of the differential', () => {
    const r = calculateQuote(input(), ref);
    expect(r.copExposureUsdPerLb).toBeCloseTo(0.2541, 3);
  });

  it('cheapens the COP side of the stack when the peso weakens', () => {
    const weak: ReferenceData = { ...ref, fx: { ...SEED_FX, COP: 1 / 4000 } };
    const base = calculateQuote(input(), ref).differentialUsdPerLb;
    const atWeakPeso = calculateQuote(input(), weak).differentialUsdPerLb;
    expect(atWeakPeso).toBeLessThan(base);
    expect(base - atWeakPeso).toBeCloseTo(800.4467 / 3150 - 800.4467 / 4000, 3);
  });
});

describe('margin', () => {
  const priced = () =>
    calculateQuote(input({ incoterm: 'DDP', kcPriceUsdPerLb: 1.85, premiumUsdPerLb: 0.35 }), ref);

  it('prices the floor at the configured 16%', () => {
    const r = priced();
    expect(r.floor.margin).toBe(0.16);
    expect(r.floor.priceUsdPerLb).toBeCloseTo(r.totalCostUsdPerLb / (1 - 0.16), 6);
  });

  it('renders a ladder from 20% to 30% in one-point steps', () => {
    const r = priced();
    const rungs = r.ladder.map((x) => Math.round(x.margin * 100));
    expect(rungs).toContain(16);
    expect(rungs).toContain(20);
    expect(rungs).toContain(30);
    expect(rungs).toEqual([...rungs].sort((a, b) => a - b));
    // 16% floor plus 20..30 inclusive.
    expect(r.ladder).toHaveLength(12);
  });

  it('increases price monotonically up the ladder', () => {
    const r = priced();
    for (let i = 1; i < r.ladder.length; i += 1) {
      expect(r.ladder[i].priceUsdPerLb).toBeGreaterThan(r.ladder[i - 1].priceUsdPerLb);
    }
  });

  it('round-trips price and margin in gross-margin mode', () => {
    const r = priced();
    const target = 3.15;
    const solved = solveForPrice(target, r, SEED_SETTINGS);
    const back = priceAtMargin(solved.margin, r.totalCostUsdPerLb, r.marginBaseUsdPerLb, 'on_price');
    expect(back).toBeCloseTo(target, 8);
  });

  it('round-trips price and margin in markup-on-cost mode', () => {
    const markupRef: ReferenceData = {
      ...ref,
      settings: { ...SEED_SETTINGS, marginMode: 'on_cost' },
    };
    const r = calculateQuote(
      input({ incoterm: 'DDP', kcPriceUsdPerLb: 1.85, premiumUsdPerLb: 0.35 }),
      markupRef,
    );
    const target = 3.15;
    const m = marginAtPrice(target, r.totalCostUsdPerLb, r.marginBaseUsdPerLb, 'on_cost');
    expect(priceAtMargin(m, r.totalCostUsdPerLb, r.marginBaseUsdPerLb, 'on_cost')).toBeCloseTo(
      target,
      8,
    );
  });

  it('flags a target price that falls under the floor or under cost', () => {
    const r = priced();
    const underCost = solveForPrice(r.totalCostUsdPerLb - 0.1, r, SEED_SETTINGS);
    expect(underCost.belowCost).toBe(true);
    expect(underCost.belowFloor).toBe(true);

    const thin = solveForPrice(r.totalCostUsdPerLb / (1 - 0.1), r, SEED_SETTINGS);
    expect(thin.belowCost).toBe(false);
    expect(thin.belowFloor).toBe(true);

    const healthy = solveForPrice(r.totalCostUsdPerLb / (1 - 0.25), r, SEED_SETTINGS);
    expect(healthy.belowFloor).toBe(false);
  });

  it('earns margin only on the differential when configured that way', () => {
    const diffRef: ReferenceData = {
      ...ref,
      settings: { ...SEED_SETTINGS, marginBase: 'differential_only' },
    };
    const full = priced();
    const diff = calculateQuote(
      input({ incoterm: 'DDP', kcPriceUsdPerLb: 1.85, premiumUsdPerLb: 0.35 }),
      diffRef,
    );
    expect(diff.marginBaseUsdPerLb).toBeCloseTo(diff.differentialUsdPerLb, 6);
    expect(diff.floor.priceUsdPerLb).toBeLessThan(full.floor.priceUsdPerLb);
    expect(diff.floor.priceUsdPerLb).toBeGreaterThan(diff.totalCostUsdPerLb);
  });

  it('excludes lines flagged as margin from the base it charges margin on', () => {
    const flagged: ReferenceData = {
      ...ref,
      costLines: SEED_COST_LINES.map((l) =>
        l.key === 'fixed_cost' ? { ...l, isMargin: true } : l,
      ),
    };
    const r = calculateQuote(
      input({ incoterm: 'DDP', kcPriceUsdPerLb: 1.85, premiumUsdPerLb: 0.35 }),
      flagged,
    );
    expect(r.marginBaseUsdPerLb).toBeCloseTo(r.totalCostUsdPerLb - 0.25, 6);
    // The price still recovers the fixed cost in full.
    expect(r.floor.priceUsdPerLb).toBeGreaterThan(r.totalCostUsdPerLb);
  });
});

describe('quantity', () => {
  it('converts containers, bags and pounds consistently', () => {
    const byContainer = calculateQuote(input({ quantity: 2, quantityMode: 'containers' }), ref);
    expect(byContainer.totalLbs).toBeCloseTo(2 * DEFAULT_LBS_PER_CONTAINER, 6);
    expect(byContainer.bags).toBeCloseTo((2 * DEFAULT_LBS_PER_CONTAINER) / 154.322, 6);

    const byBag = calculateQuote(input({ quantity: 250, quantityMode: 'bags' }), ref);
    expect(byBag.totalLbs).toBeCloseTo(250 * 154.322, 6);
    expect(byBag.containers).toBeCloseTo(1, 3);
  });

  it('warns on a partial container', () => {
    const r = calculateQuote(input({ quantity: 1.5, quantityMode: 'containers' }), ref);
    expect(r.warnings.some((w) => w.includes('not a whole load'))).toBe(true);
  });

  it('scales total contract value with quantity', () => {
    const one = calculateQuote(
      input({ quantity: 1, kcPriceUsdPerLb: 1.85, premiumUsdPerLb: 0.35 }),
      ref,
    );
    const three = calculateQuote(
      input({ quantity: 3, kcPriceUsdPerLb: 1.85, premiumUsdPerLb: 0.35 }),
      ref,
    );
    expect(three.floor.totalValueUsd).toBeCloseTo(one.floor.totalValueUsd * 3, 4);
    expect(three.floor.priceUsdPerLb).toBeCloseTo(one.floor.priceUsdPerLb, 8);
  });
});

describe('client-facing units', () => {
  it('quotes US destinations in USD per pound', () => {
    const r = calculateQuote(
      input({ destinationKey: 'ny', kcPriceUsdPerLb: 1.85, premiumUsdPerLb: 0.35 }),
      ref,
    );
    expect(r.quoteCurrency).toBe('USD');
    expect(r.quoteUnit).toBe('lb');
    expect(r.floor.displayPrice).toBeCloseTo(r.floor.priceUsdPerLb, 8);
  });

  it('quotes Rotterdam in euro per kilo', () => {
    const r = calculateQuote(
      input({ destinationKey: 'rotterdam', kcPriceUsdPerLb: 1.85, premiumUsdPerLb: 0.35 }),
      ref,
    );
    expect(r.quoteCurrency).toBe('EUR');
    expect(r.quoteUnit).toBe('kg');
    expect(r.floor.displayPrice).toBeCloseTo(
      (r.floor.priceUsdPerLb * 2.2046226218487757) / SEED_FX.EUR,
      6,
    );
  });

  it('round-trips a client-facing price back to USD per pound', () => {
    const usdPerLb = 3.12;
    for (const [cur, unit] of [
      ['EUR', 'kg'],
      ['AUD', 'kg'],
      ['GBP', 'kg'],
      ['CAD', 'kg'],
      ['USD', 'lb'],
      ['USD', 'mt'],
    ] as const) {
      const shown = toQuoteUnit(usdPerLb, cur, unit, SEED_FX);
      expect(fromQuoteUnit(shown, cur, unit, SEED_FX)).toBeCloseTo(usdPerLb, 10);
    }
  });
});

describe('input validation', () => {
  it('rejects an unknown destination', () => {
    expect(() => calculateQuote(input({ destinationKey: 'mars' }), ref)).toThrow(/destination/);
  });

  it('warns when no KC price or premium has been entered', () => {
    const r = calculateQuote(input(), ref);
    expect(r.warnings.some((w) => w.includes('KC price'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('premium'))).toBe(true);
  });
});
