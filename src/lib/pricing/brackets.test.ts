import { describe, expect, it } from 'vitest';
import {
  calculateContract,
  calculateQuote,
  deadZones,
  marginAtPrice,
  roundUpAdvice,
  volumeBand,
} from './engine';
import {
  SEED_COST_LINES, SEED_DESTINATIONS, SEED_FX, SEED_PACKAGING, SEED_PROCESSES, SEED_SETTINGS,
} from './reference';
import type { EngineSettings, QuoteInput, ReferenceData, VolumeBracket } from './types';

const ref: ReferenceData = {
  costLines: SEED_COST_LINES, packaging: SEED_PACKAGING, processes: SEED_PROCESSES,
  destinations: SEED_DESTINATIONS, fx: SEED_FX, settings: SEED_SETTINGS,
};

const input = (bags: number): QuoteInput => ({
  destinationKey: 'ny', incoterm: 'DDP', processKey: 'washed', packagingKey: 'jute_70',
  bags, kcUsdPerLb: 3.2, premiumUsdPerLb: 0.45, holdMonths: 2,
  fromMonth: '2026-08', toMonth: '2026-12', waiveFixedCost: false,
});

describe('which bracket an order falls into', () => {
  it('reads the boundaries as written, both ends inclusive', () => {
    expect(volumeBand(50, SEED_SETTINGS).minMargin).toBe(0.24);
    expect(volumeBand(70, SEED_SETTINGS).minMargin).toBe(0.24);
    expect(volumeBand(71, SEED_SETTINGS).minMargin).toBe(0.21);
    expect(volumeBand(140, SEED_SETTINGS).minMargin).toBe(0.21);
    expect(volumeBand(141, SEED_SETTINGS).minMargin).toBe(0.18);
    expect(volumeBand(240, SEED_SETTINGS).minMargin).toBe(0.18);
    expect(volumeBand(241, SEED_SETTINGS).minMargin).toBe(0.16);
  });

  it('runs the last bracket to any size', () => {
    expect(volumeBand(100_000, SEED_SETTINGS).minMargin).toBe(0.16);
    expect(volumeBand(100_000, SEED_SETTINGS).label).toBe('241+ bags');
  });

  it('marks anything under the smallest bracket as outside policy', () => {
    const band = volumeBand(30, SEED_SETTINGS);
    expect(band.belowPolicy).toBe(true);
    expect(band.bracket).toBeNull();
    // Still priced, so the desk can see what taking it would cost.
    expect(band.minMargin).toBe(0.24);
  });

  it('falls back to the flat floor when no brackets are configured', () => {
    const flat: EngineSettings = { ...SEED_SETTINGS, volumeBrackets: [] };
    expect(volumeBand(60, flat).minMargin).toBe(flat.minMargin);
    expect(volumeBand(60, flat).belowPolicy).toBe(false);
  });

  it('does not care what order the brackets were saved in', () => {
    const shuffled: EngineSettings = {
      ...SEED_SETTINGS,
      volumeBrackets: [...SEED_SETTINGS.volumeBrackets].reverse(),
    };
    expect(volumeBand(100, shuffled).minMargin).toBe(0.21);
  });
});

describe('the quote a bracket produces', () => {
  it('holds a small order to a higher floor than a large one', () => {
    const small = calculateQuote(input(60), ref);
    const large = calculateQuote(input(300), ref);
    expect(small.band.minMargin).toBe(0.24);
    expect(large.band.minMargin).toBe(0.16);
    // Same coffee, same costs — only the floor moved.
    expect(small.totalCostUsdPerLb).toBeCloseTo(large.totalCostUsdPerLb, 10);
    expect(small.floor.priceUsdPerLb).toBeGreaterThan(large.floor.priceUsdPerLb);
  });

  it('starts the ladder at the bracket floor, not below it', () => {
    const small = calculateQuote(input(60), ref);
    expect(small.ladder[0].margin).toBe(0.24);
    expect(small.ladder.every((r) => r.margin >= 0.24)).toBe(true);
    // The published rungs above it survive.
    expect(small.ladder.map((r) => r.margin)).toContain(0.25);
    expect(small.ladder.map((r) => r.margin)).toContain(0.3);
  });

  it('keeps the whole ladder for an order in the last bracket', () => {
    const large = calculateQuote(input(300), ref);
    expect(large.ladder.map((r) => r.margin)).toEqual([0.16, 0.2, 0.225, 0.25, 0.3]);
  });

  it('warns, in the trader’s own view, when the order is under the minimum', () => {
    const tiny = calculateQuote(input(30), ref);
    const warning = tiny.warnings.find((w) => /under the 50-bag minimum/i.test(w.text));
    expect(warning).toBeDefined();
    expect(warning?.adminOnly).toBe(false);
  });
});

describe('order sizes where asking for more costs less', () => {
  it('finds the run at the top of each bracket', () => {
    expect(deadZones(SEED_SETTINGS.volumeBrackets)).toEqual([
      { from: 69, to: 70, nextBags: 71 },
      { from: 136, to: 140, nextBags: 141 },
      { from: 236, to: 240, nextBags: 241 },
    ]);
  });

  it('grows the run when the steps are widened', () => {
    const steep: VolumeBracket[] = [
      { fromBags: 50, toBags: 70, minMargin: 0.3 },
      { fromBags: 71, toBags: 140, minMargin: 0.25 },
      { fromBags: 141, toBags: 240, minMargin: 0.2 },
      { fromBags: 241, toBags: null, minMargin: 0.16 },
    ];
    expect(deadZones(steep)).toEqual([
      { from: 67, to: 70, nextBags: 71 },
      { from: 133, to: 140, nextBags: 141 },
      { from: 230, to: 240, nextBags: 241 },
    ]);
  });

  it('reports none when the steps are gentle enough', () => {
    const gentle: VolumeBracket[] = [
      { fromBags: 50, toBags: 70, minMargin: 0.17 },
      { fromBags: 71, toBags: null, minMargin: 0.16 },
    ];
    expect(deadZones(gentle)).toEqual([]);
  });

  it('is a property of the margins alone, whatever the coffee costs', () => {
    // The cost cancels out of the comparison, so a different market cannot
    // move the run. This is why admin can be shown it before saving.
    for (const kc of [1.2, 3.2, 9]) {
      const at240 = calculateQuote({ ...input(240), kcUsdPerLb: kc }, ref);
      const at241 = calculateQuote({ ...input(241), kcUsdPerLb: kc }, ref);
      expect(at241.floor.totalValueUsd).toBeLessThan(at240.floor.totalValueUsd);
    }
  });
});

describe('telling the client to round up', () => {
  it('offers the next bracket when it genuinely costs less', () => {
    const at240 = calculateQuote(input(240), ref);
    const advice = roundUpAdvice(input(240), ref, at240.floor.totalValueUsd);
    expect(advice).not.toBeNull();
    expect(advice!.toBags).toBe(241);
    expect(advice!.savingUsd).toBeGreaterThan(0);
  });

  it('says nothing when the larger order is not cheaper', () => {
    const at150 = calculateQuote(input(150), ref);
    expect(roundUpAdvice(input(150), ref, at150.floor.totalValueUsd)).toBeNull();
  });

  it('has nothing to offer from the last bracket', () => {
    const at300 = calculateQuote(input(300), ref);
    expect(roundUpAdvice(input(300), ref, at300.floor.totalValueUsd)).toBeNull();
  });

  it('quotes a saving the desk can actually stand behind', () => {
    const at240 = calculateQuote(input(240), ref);
    const advice = roundUpAdvice(input(240), ref, at240.floor.totalValueUsd)!;
    const at241 = calculateQuote(input(241), ref);
    expect(at240.floor.totalValueUsd - at241.floor.totalValueUsd).toBeCloseTo(advice.savingUsd, 6);
    expect(advice.displayPrice).toBe(at241.floor.displayPrice);
  });
});

describe('what the coffee type adds', () => {
  const priceOf = (processKey: string) =>
    calculateQuote({ ...input(250), processKey }, ref);

  it('charges nothing for a plain washed lot', () => {
    expect(priceOf('washed').typePremiumUsdPerLb).toBe(0);
  });

  it('charges the desk’s figure for the types that carry one', () => {
    expect(priceOf('decaf').typePremiumUsdPerLb).toBeCloseTo(0.30, 10);
    expect(priceOf('organic').typePremiumUsdPerLb).toBeCloseTo(0.35, 10);
    expect(priceOf('supremo').typePremiumUsdPerLb).toBeCloseTo(0.25, 10);
  });

  it('counts it as coffee, not as milling', () => {
    const washed = priceOf('washed');
    const organic = priceOf('organic');
    // It joins the green coffee, where the monthly differential already sits.
    expect(organic.greenCoffeeUsdPerLb - washed.greenCoffeeUsdPerLb).toBeCloseTo(0.35, 10);
    // Milling is unchanged: these types are seeded at the same processing cost.
    const milling = (r: typeof washed) => r.lines.find((l) => l.key === 'milling')!.usdPerLb;
    expect(milling(organic)).toBeCloseTo(milling(washed), 10);
  });

  it('carries through to the cost and the price', () => {
    const washed = priceOf('washed');
    const decaf = priceOf('decaf');
    expect(decaf.totalCostUsdPerLb).toBeGreaterThan(washed.totalCostUsdPerLb);
    expect(decaf.floor.priceUsdPerLb).toBeGreaterThan(washed.floor.priceUsdPerLb);
    // Thirty cents of coffee costs more than thirty cents to sell, because the
    // margin is charged on it too.
    expect(decaf.floor.priceUsdPerLb - washed.floor.priceUsdPerLb).toBeGreaterThan(0.3);
  });

  it('is financed like the rest of the cargo on a DDP hold', () => {
    const held = (processKey: string) =>
      calculateQuote({ ...input(250), processKey, incoterm: 'DDP', holdMonths: 6 }, ref);
    expect(held('organic').financeUsdPerLb).toBeGreaterThan(held('washed').financeUsdPerLb);
  });

  it('names the type it priced, for the breakdown to show', () => {
    expect(priceOf('organic').typeLabel).toBe('Organic');
    expect(priceOf('washed').typeLabel).toBe('Fully washed');
  });
});

describe('a shipment priced by hand', () => {
  const ship = (id: string, kcCents: number, bags: number, priceOverride: number | null = null) => ({
    id, label: id, kcCents, bags, priceOverride,
  });
  const base = {
    destinationKey: 'ny', incoterm: 'DDP' as const, processKey: 'washed', packagingKey: 'jute_70',
    premiumUsdPerLb: 0.45, holdMonths: 2,
    fromMonth: '2026-08', toMonth: '2026-12', waiveFixedCost: false,
  };

  it('leaves everything as it was when no price is set', () => {
    const c = calculateContract([ship('a', 320, 100), ship('b', 340, 150)], base, 0.2, ref);
    expect(c.setPriceCount).toBe(0);
    expect(c.shipments.every((s) => s.pricedBy === 'margin')).toBe(true);
    // Every shipment on one margin: the blend earns it, plus the sliver that
    // rounding each price up to the cent adds.
    expect(c.blendedMargin).toBeGreaterThanOrEqual(0.2);
    expect(c.blendedMargin).toBeLessThan(0.201);
  });

  it('takes the price it was given, and marks it', () => {
    const c = calculateContract([ship('a', 320, 100, 6.5), ship('b', 340, 150)], base, 0.2, ref);
    const [a, b] = c.shipments;
    expect(a.pricedBy).toBe('set');
    expect(a.displayPrice).toBe(6.5);
    expect(b.pricedBy).toBe('margin');
    expect(c.setPriceCount).toBe(1);
  });

  it('reports what a hand-set price actually earns', () => {
    const c = calculateContract([ship('a', 320, 100, 6.5)], base, 0.2, ref);
    const a = c.shipments[0];
    // Not the contract margin — the one this price leaves against its own cost.
    expect(a.marginAchieved).toBeCloseTo(
      marginAtPrice(a.priceUsdPerLb, a.result.totalCostUsdPerLb, a.result.marginBaseUsdPerLb, 'on_price'),
      10,
    );
    expect(a.marginAchieved).not.toBeCloseTo(0.2, 3);
  });

  it('carries the set price into the blend', () => {
    const onMargin = calculateContract([ship('a', 320, 100), ship('b', 340, 150)], base, 0.2, ref);
    const dearer = calculateContract([ship('a', 320, 100, 9), ship('b', 340, 150)], base, 0.2, ref);
    expect(dearer.consolidatedDisplay).toBeGreaterThan(onMargin.consolidatedDisplay);
    expect(dearer.totalValueUsd).toBeGreaterThan(onMargin.totalValueUsd);
  });

  it('blends by volume, not by shipment count', () => {
    // The small shipment is dear, the large one is not. The blend must lean
    // to the large one.
    const c = calculateContract([ship('a', 320, 10, 9), ship('b', 320, 490, 5)], base, 0.2, ref);
    expect(c.consolidatedDisplay).toBeLessThan(5.2);
    expect(c.consolidatedDisplay).toBeGreaterThan(5);
  });

  it('is the price the client arrives at by adding the contract up', () => {
    const c = calculateContract([ship('a', 320, 100, 6.5), ship('b', 340, 150, 5.75)], base, 0.2, ref);
    const perLb = c.totalValueUsd / c.totalLbs;
    // Rounded up like any quoted price, so never below what the lines sum to.
    expect(c.consolidatedUsdPerLb).toBeGreaterThanOrEqual(perLb - 1e-9);
    expect(c.consolidatedUsdPerLb - perLb).toBeLessThan(0.01);
  });

  it('ignores a price that is not a price', () => {
    for (const bad of [0, -3, Number.NaN]) {
      const c = calculateContract([ship('a', 320, 100, bad)], base, 0.2, ref);
      expect(c.shipments[0].pricedBy).toBe('margin');
    }
  });

  it('lets the contract margin still drive the rest', () => {
    const low = calculateContract([ship('a', 320, 100, 6.5), ship('b', 340, 150)], base, 0.18, ref);
    const high = calculateContract([ship('a', 320, 100, 6.5), ship('b', 340, 150)], base, 0.28, ref);
    expect(low.shipments[0].displayPrice).toBe(high.shipments[0].displayPrice);
    expect(high.shipments[1].displayPrice).toBeGreaterThan(low.shipments[1].displayPrice);
  });
});
