import { describe, expect, it } from 'vitest';
import {
  billableMonths,
  calculateContract,
  calculateQuote,
  cappedHold,
  kcForTarget,
  marginAtPrice,
  priceAtMargin,
  solveForPrice,
} from './engine';
import {
  SEED_COST_LINES,
  SEED_DESTINATIONS,
  SEED_FX,
  SEED_PACKAGING,
  SEED_PROCESSES,
  SEED_SETTINGS,
} from './reference';
import type { QuoteInput, ReferenceData } from './types';
import { ceilPrice, fromQuoteUnit, toQuoteUnit } from './units';
import { apportion, deliveryPlan, monthSpan, monthsBetween } from './schedule';

const ref: ReferenceData = {
  costLines: SEED_COST_LINES,
  packaging: SEED_PACKAGING,
  processes: SEED_PROCESSES,
  destinations: SEED_DESTINATIONS,
  fx: SEED_FX,
  settings: SEED_SETTINGS,
};

/** A year-long window, so the hold cap never interferes unless a test wants it. */
function input(overrides: Partial<QuoteInput> = {}): QuoteInput {
  return {
    destinationKey: 'ny',
    incoterm: 'FOB',
    processKey: 'washed',
    packagingKey: 'jute_70',
    bags: 250,
    kcUsdPerLb: 0,
    premiumUsdPerLb: 0,
    holdMonths: 1,
    fromMonth: '2027-01',
    toMonth: '2027-12',
    waiveFixedCost: false,
    ...overrides,
  };
}

describe('reconciliation with the source sheet', () => {
  it('reproduces each cost line from the sheet, in COP per pound', () => {
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

  it('gives an FOB differential of 61.41c — the sheet 56.41c plus the 5c carry cover', () => {
    const r = calculateQuote(input(), ref);
    expect(r.differentialUsdPerLb).toBeCloseTo(0.6141, 4);
  });

  it('prices the full DDP differential for every destination', () => {
    const expected: Record<string, number> = {
      ny: 0.7463,
      dupuy: 0.7333,
      annex: 0.7463,
      canada: 0.7437,
      australia: 0.7722,
      rotterdam: 0.7256,
      uk: 0.7256,
      dubai: 0.8344,
    };
    for (const [key, want] of Object.entries(expected)) {
      const r = calculateQuote(input({ destinationKey: key, incoterm: 'DDP' }), ref);
      expect(r.differentialUsdPerLb, key).toBeCloseTo(want, 3);
    }
  });
});

describe('grain pro and bag marks are permanent', () => {
  it('always includes both, with no way to switch them off', () => {
    const r = calculateQuote(input(), ref);
    expect(r.lines.find((l) => l.key === 'grain_pro')!.included).toBe(true);
    expect(r.lines.find((l) => l.key === 'bag_marks')!.included).toBe(true);
    expect(SEED_COST_LINES.filter((l) => l.waivable).map((l) => l.key)).toEqual(['fixed_cost']);
  });
});

describe('holding the contract', () => {
  it('bills only the months past the free window', () => {
    expect(billableMonths(1, 2)).toBe(0);
    expect(billableMonths(2, 2)).toBe(0);
    expect(billableMonths(3, 2)).toBe(1);
    expect(billableMonths(6, 2)).toBe(4);
    expect(billableMonths(12, 2)).toBe(10);
  });

  it('charges nothing for a hold inside the free window', () => {
    const r = calculateQuote(input({ destinationKey: 'rotterdam', incoterm: 'DDP', holdMonths: 2 }), ref);
    expect(r.billableMonths).toBe(0);
    expect(r.storageUsdPerLb).toBe(0);
    expect(r.financeUsdPerLb).toBe(0);
    expect(r.lines.find((l) => l.key === 'storage')!.excludedReason).toMatch(/fixed cost/);
  });

  it('charges storage and finance beyond it, and the cost climbs with the hold', () => {
    const at = (holdMonths: number) =>
      calculateQuote(input({ destinationKey: 'rotterdam', incoterm: 'DDP', holdMonths, kcUsdPerLb: 1.855, premiumUsdPerLb: 0.35 }), ref);
    const two = at(2);
    const six = at(6);
    const twelve = at(12);
    expect(six.billableMonths).toBe(4);
    expect(twelve.billableMonths).toBe(10);
    expect(six.totalCostUsdPerLb).toBeGreaterThan(two.totalCostUsdPerLb);
    expect(twelve.totalCostUsdPerLb).toBeGreaterThan(six.totalCostUsdPerLb);
    // Storage is EUR 1.40 per 70 kg bag per month, over four billed months.
    expect(six.storageUsdPerLb).toBeCloseTo((1.4 / 154.322) * 4 * SEED_FX.EUR, 6);
  });

  it('leaves the carry to the buyer on FOB and CIF', () => {
    for (const incoterm of ['FOB', 'CIF'] as const) {
      const r = calculateQuote(
        input({ destinationKey: 'rotterdam', incoterm, holdMonths: 12 }),
        ref,
      );
      expect(r.storageUsdPerLb, incoterm).toBe(0);
      expect(r.financeUsdPerLb, incoterm).toBe(0);
      expect(r.lines.find((l) => l.key === 'finance')!.excludedReason).toMatch(/buyer carries/);
    }
    const ddp = calculateQuote(
      input({ destinationKey: 'rotterdam', incoterm: 'DDP', holdMonths: 12, kcUsdPerLb: 1.855 }),
      ref,
    );
    expect(ddp.financeUsdPerLb).toBeGreaterThan(0);
  });

  it('caps the hold at the shipment window', () => {
    expect(cappedHold(9, '2027-01', '2027-05')).toBe(5);
    expect(cappedHold(3, '2027-01', '2027-05')).toBe(3);
    expect(cappedHold(9, '2027-01', '2027-01')).toBe(1);
    const r = calculateQuote(
      input({ destinationKey: 'rotterdam', incoterm: 'DDP', holdMonths: 12, fromMonth: '2027-01', toMonth: '2027-03' }),
      ref,
    );
    expect(r.billableMonths).toBe(1); // capped to 3 months, less the 2 free
  });

  it('charges finance on the full cargo value, not just the differential', () => {
    const r = calculateQuote(
      input({ destinationKey: 'rotterdam', incoterm: 'DDP', holdMonths: 6, kcUsdPerLb: 1.855, premiumUsdPerLb: 0.35 }),
      ref,
    );
    const expected = 0.0072 * 4 * (2.205 + r.differentialUsdPerLb);
    expect(r.financeUsdPerLb).toBeCloseTo(expected, 6);
  });
});

describe('waiving the fixed cost', () => {
  const base = { destinationKey: 'rotterdam', incoterm: 'DDP' as const, kcUsdPerLb: 1.855, premiumUsdPerLb: 0.35 };

  it('removes exactly 30c and says so', () => {
    const normal = calculateQuote(input(base), ref);
    const waived = calculateQuote(input({ ...base, waiveFixedCost: true }), ref);
    expect(normal.totalCostUsdPerLb - waived.totalCostUsdPerLb).toBeCloseTo(0.3, 6);
    expect(waived.waivedFixedCost).toBe(true);
    expect(normal.waivedFixedCost).toBe(false);
    expect(waived.lines.find((l) => l.key === 'fixed_cost')!.excludedReason).toMatch(/strategic/);
  });

  it('leaves every other line alone', () => {
    const normal = calculateQuote(input(base), ref);
    const waived = calculateQuote(input({ ...base, waiveFixedCost: true }), ref);
    for (const line of normal.lines) {
      if (line.key === 'fixed_cost') continue;
      const other = waived.lines.find((l) => l.key === line.key)!;
      expect(other.usdPerLb, line.key).toBeCloseTo(line.usdPerLb, 8);
    }
  });
});

describe('the quoted price', () => {
  const priced = () =>
    calculateQuote(
      input({ destinationKey: 'rotterdam', incoterm: 'DDP', holdMonths: 2, kcUsdPerLb: 1.855, premiumUsdPerLb: 0.35 }),
      ref,
    );

  it('rounds to two decimals and always upward', () => {
    expect(ceilPrice(7.056)).toBe(7.06);
    expect(ceilPrice(7.051)).toBe(7.06);
    expect(ceilPrice(7.0)).toBe(7.0);
    expect(ceilPrice(7.06)).toBe(7.06);
    const r = priced();
    for (const rung of r.ladder) {
      // A whole number of cents, allowing for binary floating point.
      expect(Math.abs(rung.displayPrice * 100 - Math.round(rung.displayPrice * 100))).toBeLessThan(1e-6);
    }
  });

  it('quotes Rotterdam DDP at EUR 7.06 on the floor', () => {
    const r = priced();
    expect(r.totalCostUsdPerLb).toBeCloseTo(2.9306, 4);
    expect(r.floor.displayPrice).toBe(7.06);
    expect(r.quoteCurrency).toBe('EUR');
    expect(r.quoteUnit).toBe('kg');
  });

  it('derives contract value from the rounded price, so the client can multiply', () => {
    const r = priced();
    const fromDisplay = fromQuoteUnit(r.floor.displayPrice, r.quoteCurrency, r.quoteUnit, ref.fx);
    expect(r.floor.totalValueUsd).toBeCloseTo(fromDisplay * r.totalLbs, 6);
  });

  it('shows the agreed rungs and nothing else', () => {
    const r = priced();
    expect(r.ladder.map((x) => x.margin)).toEqual([0.16, 0.2, 0.225, 0.25, 0.3]);
    for (let i = 1; i < r.ladder.length; i += 1) {
      expect(r.ladder[i].displayPrice).toBeGreaterThan(r.ladder[i - 1].displayPrice);
    }
  });
});

describe('solvers', () => {
  const priced = () =>
    calculateQuote(
      input({ destinationKey: 'ny', incoterm: 'DDP', holdMonths: 2, kcUsdPerLb: 1.855, premiumUsdPerLb: 0.35 }),
      ref,
    );

  it('round-trips price and margin', () => {
    const r = priced();
    const target = 3.85;
    const solved = solveForPrice(target, r, SEED_SETTINGS);
    expect(
      priceAtMargin(solved.margin, r.totalCostUsdPerLb, r.marginBaseUsdPerLb, 'on_price'),
    ).toBeCloseTo(target, 8);
  });

  it('flags a price under the floor and under cost', () => {
    const r = priced();
    expect(solveForPrice(r.totalCostUsdPerLb - 0.1, r, SEED_SETTINGS).belowCost).toBe(true);
    expect(solveForPrice(r.totalCostUsdPerLb / 0.9, r, SEED_SETTINGS).belowFloor).toBe(true);
    expect(solveForPrice(r.totalCostUsdPerLb / 0.75, r, SEED_SETTINGS).belowFloor).toBe(false);
  });

  it('solves the KC a target price and margin would need', () => {
    const base = input({ destinationKey: 'ny', incoterm: 'DDP', holdMonths: 2, kcUsdPerLb: 1.855, premiumUsdPerLb: 0.35 });
    const target = 4.8;
    const needed = kcForTarget(target, 0.2, base, ref)!;
    expect(needed).toBeGreaterThan(0);
    // Setting KC to the answer must make that price carry exactly that margin.
    const at = calculateQuote({ ...base, kcUsdPerLb: needed }, ref);
    expect(solveForPrice(target, at, SEED_SETTINGS).margin).toBeCloseTo(0.2, 8);
  });

  it('still solves with the carry and the waiver in play', () => {
    const base = input({
      destinationKey: 'rotterdam', incoterm: 'DDP', holdMonths: 8,
      kcUsdPerLb: 1.9, premiumUsdPerLb: 0.4, waiveFixedCost: true,
    });
    const target = 3.6;
    const needed = kcForTarget(target, 0.25, base, ref)!;
    const at = calculateQuote({ ...base, kcUsdPerLb: needed }, ref);
    expect(solveForPrice(target, at, SEED_SETTINGS).margin).toBeCloseTo(0.25, 8);
  });
});

describe('the contract calendar', () => {
  it('counts the window inclusively', () => {
    expect(monthSpan('2027-01', '2027-05')).toBe(5);
    expect(monthSpan('2027-01', '2027-01')).toBe(1);
    expect(monthSpan('2026-11', '2027-02')).toBe(4);
    expect(monthsBetween('2027-01', '2027-03').map((m) => m.label)).toEqual([
      'Jan 2027', 'Feb 2027', 'Mar 2027',
    ]);
  });

  it('splits 250 bags over January to May as 50 a month', () => {
    const plan = deliveryPlan('2027-01', '2027-05', 250, 154.322, 123549);
    expect(plan.months).toHaveLength(5);
    expect(plan.months.map((m) => m.bags)).toEqual([50, 50, 50, 50, 50]);
    expect(plan.even).toBe(true);
    expect(plan.perMonthBags).toBe(50);
  });

  it('keeps bags whole and still sums to the order', () => {
    for (const [bags, months] of [[250, 4], [301, 7], [97, 3], [7, 12]] as const) {
      const plan = deliveryPlan('2027-01', `2027-${String(months).padStart(2, '0')}`, bags, 154.322, 1000);
      const sum = plan.months.reduce((s, m) => s + m.bags, 0);
      expect(sum, `${bags}/${months}`).toBe(bags);
      expect(plan.months.every((m) => Number.isInteger(m.bags))).toBe(true);
    }
  });

  it('apportions billing so the column adds up to the printed total', () => {
    for (const total of [123549, 47937, 1, 999999]) {
      const plan = deliveryPlan('2027-01', '2027-05', 250, 154.322, total);
      expect(plan.months.reduce((s, m) => s + m.billing, 0)).toBe(total);
    }
    expect(apportion([1.5, 1.5, 1.5, 1.5], 6)).toEqual([2, 2, 1, 1]);
  });
});

describe('multi-shipment contracts', () => {
  const base = {
    destinationKey: 'rotterdam',
    incoterm: 'DDP' as const,
    processKey: 'washed',
    packagingKey: 'jute_70',
    premiumUsdPerLb: 0.35,
    holdMonths: 6,
    fromMonth: '2027-01',
    toMonth: '2027-12',
    waiveFixedCost: false,
  };
  const shipments = [
    { id: '1', label: 'June', kcCents: 185.5, bags: 280 },
    { id: '2', label: 'October', kcCents: 190.25, bags: 280 },
    { id: '3', label: 'December', kcCents: 193.8, bags: 280 },
  ];

  it('prices each shipment against its own KC', () => {
    const c = calculateContract(shipments, base, 0.16, ref);
    const costs = c.shipments.map((s) => Number((s.result.totalCostUsdPerLb * 100).toFixed(2)));
    expect(costs).toEqual([305.57, 310.45, 314.1]);
    expect(c.shipments.map((s) => s.displayPrice)).toEqual([7.36, 7.48, 7.57]);
  });

  it('blends by volume and reports a weighted KC', () => {
    const c = calculateContract(shipments, base, 0.16, ref);
    expect(c.totalBags).toBe(840);
    expect(c.weightedKcUsdPerLb).toBeCloseTo(1.8985, 4);
    expect(c.weightedCostUsdPerLb).toBeCloseTo(3.1004, 4);
    expect(c.consolidatedDisplay).toBe(7.47);
  });

  it('totals the shipment lines, so the quote adds up', () => {
    const c = calculateContract(shipments, base, 0.16, ref);
    const sum = c.shipments.reduce((s, x) => s + x.valueUsd, 0);
    expect(c.totalValueUsd).toBeCloseTo(sum, 6);
  });

  it('reverse-solves the blended price back to the margin it was priced at', () => {
    const c = calculateContract(shipments, base, 0.16, ref);
    const implied = marginAtPrice(
      c.consolidatedUsdPerLb,
      c.weightedCostUsdPerLb,
      c.weightedMarginBaseUsdPerLb,
      'on_price',
    );
    // Rounding the quoted price up can only add margin, never take it away.
    expect(implied).toBeGreaterThanOrEqual(0.16);
    expect(implied).toBeLessThan(0.161);

    // Against the unrounded blend the solve is exact.
    const exact = marginAtPrice(
      priceAtMargin(0.16, c.weightedCostUsdPerLb, c.weightedMarginBaseUsdPerLb, 'on_price'),
      c.weightedCostUsdPerLb,
      c.weightedMarginBaseUsdPerLb,
      'on_price',
    );
    expect(exact).toBeCloseTo(0.16, 10);
  });

  it('matches a single quote when there is only one shipment', () => {
    const one = calculateContract([shipments[0]], base, 0.16, ref);
    const single = calculateQuote(
      { ...base, bags: 280, kcUsdPerLb: 1.855 },
      ref,
    );
    expect(one.consolidatedDisplay).toBe(single.floor.displayPrice);
    expect(one.totalValueUsd).toBeCloseTo(single.floor.totalValueUsd, 6);
  });

  it('weights the blend toward the larger shipment', () => {
    const lopsided = calculateContract(
      [
        { id: '1', label: 'June', kcCents: 185.5, bags: 800 },
        { id: '2', label: 'December', kcCents: 193.8, bags: 40 },
      ],
      base,
      0.16,
      ref,
    );
    expect(lopsided.weightedKcUsdPerLb).toBeLessThan(1.89);
    expect(lopsided.weightedKcUsdPerLb).toBeGreaterThan(1.855);
  });
});

describe('FX sensitivity', () => {
  it('reports the peso-denominated share of the differential', () => {
    const r = calculateQuote(input(), ref);
    expect(r.copExposureUsdPerLb).toBeCloseTo(0.2541, 3);
  });

  it('cheapens the peso side when the peso weakens', () => {
    const weak: ReferenceData = { ...ref, fx: { ...SEED_FX, COP: 1 / 4000 } };
    const base = calculateQuote(input(), ref).differentialUsdPerLb;
    const atWeak = calculateQuote(input(), weak).differentialUsdPerLb;
    expect(base - atWeak).toBeCloseTo(800.4467 / 3150 - 800.4467 / 4000, 3);
  });

  it('round-trips a client-facing price back to USD per pound', () => {
    for (const [cur, unit] of [['EUR', 'kg'], ['AUD', 'kg'], ['GBP', 'kg'], ['USD', 'lb']] as const) {
      const shown = toQuoteUnit(3.12, cur, unit, SEED_FX);
      expect(fromQuoteUnit(shown, cur, unit, SEED_FX)).toBeCloseTo(3.12, 10);
    }
  });
});

describe('warnings', () => {
  it('separates what a trader can act on from what only admin can', () => {
    const r = calculateQuote(input({ bags: 137, destinationKey: 'dubai', incoterm: 'DDP', holdMonths: 6 }), ref);
    expect(r.warnings.some((w) => !w.adminOnly && w.text.includes('containers'))).toBe(true);
    expect(r.warnings.some((w) => w.adminOnly && w.text.includes('Storage'))).toBe(true);
  });

  it('rejects an unknown destination', () => {
    expect(() => calculateQuote(input({ destinationKey: 'mars' }), ref)).toThrow(/destination/);
  });
});
