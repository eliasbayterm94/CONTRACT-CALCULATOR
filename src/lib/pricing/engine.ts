import type {
  ContractResult,
  CostLine,
  CostLineResult,
  CostLineTrace,
  Destination,
  EngineSettings,
  MarginRung,
  PackagingType,
  PriceStep,
  ProcessType,
  QuoteInput,
  QuoteResult,
  QuoteWarning,
  Reconciliation,
  ReferenceData,
  Shipment,
  ShipmentResult,
} from './types';
import {
  DEFAULT_LBS_PER_CONTAINER,
  LB_PER_KG,
  LB_PER_MT,
  ceilPrice,
  fromQuoteUnit,
  toQuoteUnit,
  toUsd,
} from './units';
import { monthSpan } from './schedule';

/**
 * Price for a given margin.
 *
 * `cost` is the full break-even. `base` is the slice of it the margin is
 * charged against — normally the whole thing, but admin can narrow it to the
 * logistics differential or exclude lines flagged as margin.
 *
 *  - `on_cost` : markup. price = cost + m * base
 *  - `on_price`: gross margin. The base is grossed up so margin is `m` of the
 *                grossed-up portion; anything outside it passes through at
 *                cost. With base === cost this is the familiar cost / (1 - m).
 */
export function priceAtMargin(
  margin: number,
  cost: number,
  base: number,
  mode: EngineSettings['marginMode'],
): number {
  if (mode === 'on_cost') return cost + margin * base;
  if (margin >= 1) return Number.POSITIVE_INFINITY;
  return cost - base + base / (1 - margin);
}

/** Inverse of `priceAtMargin`: what margin does this selling price imply? */
export function marginAtPrice(
  price: number,
  cost: number,
  base: number,
  mode: EngineSettings['marginMode'],
): number {
  if (base <= 0) return 0;
  if (mode === 'on_cost') return (price - cost) / base;
  const grossed = price - cost + base;
  if (grossed <= 0) return Number.NEGATIVE_INFINITY;
  return 1 - base / grossed;
}

/** Months of storage and finance actually billed, after the free window. */
export function billableMonths(holdMonths: number, freeHoldMonths: number): number {
  return Math.max(0, holdMonths - freeHoldMonths);
}

/** The hold can never exceed the contract's own shipment window. */
export function cappedHold(holdMonths: number, fromMonth: string, toMonth: string): number {
  return Math.max(1, Math.min(holdMonths, monthSpan(fromMonth, toMonth), 12));
}

function need<T extends { key: string }>(list: T[], key: string, what: string): T {
  const found = list.find((x) => x.key === key);
  if (!found) throw new Error(`Unknown ${what}: "${key}"`);
  return found;
}

interface ResolvedAmount {
  amount: number;
  currency: CostLine['currency'];
  lbs: number;
}

/**
 * Look up a cost line's amount. Lines driven by a quote selection read their
 * value from the packaging, process or destination tables rather than carrying
 * an amount of their own.
 */
function resolveAmount(
  line: CostLine,
  packaging: PackagingType,
  process: ProcessType,
  destination: Destination,
): ResolvedAmount {
  switch (line.driver) {
    case 'packaging':
      return { amount: packaging.amount, currency: packaging.currency, lbs: packaging.lbsPerUnit };
    case 'process':
      return { amount: process.amount, currency: process.currency, lbs: process.lbsPerUnit };
    case 'destination': {
      if (line.key === 'seafreight') {
        return {
          amount: destination.seafreightAmount,
          currency: destination.seafreightCurrency,
          lbs: destination.seafreightLbsPerUnit,
        };
      }
      if (line.key === 'import_cost') {
        return {
          amount: destination.importAmount,
          currency: destination.importCurrency,
          lbs: destination.importLbsPerUnit,
        };
      }
      if (line.key === 'unloading_ddp') {
        return {
          amount: destination.unloadingAmount,
          currency: destination.unloadingCurrency,
          lbs: destination.unloadingLbsPerUnit,
        };
      }
      if (line.key === 'storage') {
        // Storage is billed per packaging unit per month, so smaller bags cost
        // more per pound to hold — same as the source sheet.
        return {
          amount: destination.storageAmount,
          currency: destination.storageCurrency,
          lbs: packaging.lbsPerUnit,
        };
      }
      throw new Error(`Cost line "${line.key}" is destination-driven but has no lookup`);
    }
    case 'fixed':
    default:
      return { amount: line.amount, currency: line.currency, lbs: line.lbsPerUnit };
  }
}

export function calculateQuote(input: QuoteInput, ref: ReferenceData): QuoteResult {
  const { fx, settings } = ref;
  const destination = need(ref.destinations, input.destinationKey, 'destination');
  const process = need(ref.processes, input.processKey, 'process');
  const packaging = need(ref.packaging, input.packagingKey, 'packaging type');
  const warnings: QuoteWarning[] = [];

  const hold = cappedHold(input.holdMonths, input.fromMonth, input.toMonth);
  const months = billableMonths(hold, settings.freeHoldMonths);

  const totalLbs = input.bags * packaging.lbsPerUnit;
  const containers = totalLbs / DEFAULT_LBS_PER_CONTAINER;

  if (input.bags > 0 && Math.abs(containers - Math.round(containers)) > 0.005) {
    warnings.push({
      text:
        `${input.bags} bags is ${containers.toFixed(2)} containers. Freight, port and inland ` +
        `transport assume full loads, so a part load understates them.`,
      adminOnly: false,
    });
  }
  if (!destination.allowedIncoterms.includes(input.incoterm)) {
    warnings.push({
      text: `${input.incoterm} is not configured as an allowed incoterm for ${destination.label}.`,
      adminOnly: true,
    });
  }

  // ---- per-line costs -----------------------------------------------------
  const lines: CostLineResult[] = [];
  let differentialUsdPerLb = 0;
  let storageUsdPerLb = 0;
  let copExposureUsdPerLb = 0;
  let financeIndex = -1;
  let waivedFixedCost = false;

  for (const line of [...ref.costLines].sort((a, b) => a.sortOrder - b.sortOrder)) {
    let included = true;
    let excludedReason: string | undefined;

    if (!line.active) {
      included = false;
      excludedReason = 'Disabled in admin';
    } else if (line.waivable && input.waiveFixedCost) {
      included = false;
      excludedReason = 'Waived — strategic deal';
      waivedFixedCost = true;
    } else if (line.group === 'freight' && input.incoterm === 'FOB') {
      included = false;
      excludedReason = 'FOB — buyer pays ocean freight';
    } else if (line.group === 'import' && input.incoterm !== 'DDP') {
      included = false;
      excludedReason = `${input.incoterm} — buyer clears import`;
    } else if (line.group === 'hold') {
      // Carrying cost only lands on us under DDP. On FOB and CIF the buyer owns
      // the coffee from the port onward and carries it themselves.
      if (input.incoterm !== 'DDP') {
        included = false;
        excludedReason = `${input.incoterm} — the buyer carries the coffee`;
      } else if (months <= 0) {
        included = false;
        excludedReason = `Covered by fixed cost up to ${settings.freeHoldMonths} months`;
      }
    }

    // Finance is a rate on the cargo value, so it can only be priced once the
    // rest of the stack is known. Park it and fill it in below.
    if (line.basis === 'rate') {
      lines.push({
        key: line.key,
        label: line.label,
        group: line.group,
        currency: 'USD',
        nativeAmount: line.amount,
        nativePerLb: null,
        usdPerLb: 0,
        isMargin: line.isMargin,
        included,
        excludedReason,
        trace: {
          basis: 'rate',
          source: SOURCE_OF[line.driver ?? 'fixed'],
          lbsPerUnit: 0,
          nativePerLbPerMonth: 0,
          monthsApplied: months,
          fxUsdPerUnit: 1,
        },
      });
      if (included) financeIndex = lines.length - 1;
      continue;
    }

    const resolved = resolveAmount(line, packaging, process, destination);
    const perUnit =
      line.basis === 'per_lb'
        ? resolved.amount
        : resolved.lbs > 0
          ? resolved.amount / resolved.lbs
          : 0;
    const nativePerLb = perUnit * (line.perMonth ? months : 1);
    const usdPerLb = included ? toUsd(nativePerLb, resolved.currency, fx) : 0;

    if (included) {
      differentialUsdPerLb += usdPerLb;
      if (line.key === 'storage') storageUsdPerLb += usdPerLb;
      if (resolved.currency === 'COP') copExposureUsdPerLb += usdPerLb;
      if (resolved.amount === 0) {
        warnings.push({
          text: `${line.label} is configured at zero for ${destination.label}.`,
          adminOnly: true,
        });
      }
      if (line.basis === 'per_unit' && resolved.lbs <= 0) {
        warnings.push({
          text: `${line.label} has no pounds-per-unit configured and was priced at zero.`,
          adminOnly: true,
        });
      }
    }

    lines.push({
      key: line.key,
      label: line.label,
      group: line.group,
      currency: resolved.currency,
      nativeAmount: resolved.amount,
      nativePerLb,
      usdPerLb,
      isMargin: line.isMargin,
      included,
      excludedReason,
      trace: {
        basis: line.basis,
        source: SOURCE_OF[line.driver ?? 'fixed'],
        lbsPerUnit: line.basis === 'per_unit' ? resolved.lbs : 0,
        nativePerLbPerMonth: perUnit,
        monthsApplied: line.perMonth ? months : 1,
        fxUsdPerUnit: fx[resolved.currency] ?? Number.NaN,
      },
    });
  }

  // ---- green coffee + finance --------------------------------------------
  const greenCoffeeUsdPerLb = input.kcUsdPerLb + input.premiumUsdPerLb;
  if (input.kcUsdPerLb <= 0) warnings.push({ text: 'No KC price entered.', adminOnly: false });
  if (input.premiumUsdPerLb === 0) {
    warnings.push({ text: 'No quality premium set for this quote.', adminOnly: true });
  }

  // Finance is charged on the full cargo value — the coffee plus everything
  // spent getting it there — not just the logistics differential.
  let financeUsdPerLb = 0;
  if (financeIndex >= 0) {
    const chargedOn = greenCoffeeUsdPerLb + differentialUsdPerLb;
    financeUsdPerLb = settings.financeMonthlyRate * months * chargedOn;
    lines[financeIndex].usdPerLb = financeUsdPerLb;
    lines[financeIndex].trace.rate = {
      monthlyRate: settings.financeMonthlyRate,
      months,
      chargedOnUsdPerLb: chargedOn,
    };
  }

  const totalCostUsdPerLb = greenCoffeeUsdPerLb + differentialUsdPerLb + financeUsdPerLb;

  // ---- margin -------------------------------------------------------------
  const marginExcluded = lines
    .filter((l) => l.included && l.isMargin)
    .reduce((sum, l) => sum + l.usdPerLb, 0);
  const rawBase =
    settings.marginBase === 'full_landed_cost'
      ? totalCostUsdPerLb
      : differentialUsdPerLb + financeUsdPerLb;
  const marginBaseUsdPerLb = Math.max(0, rawBase - marginExcluded);

  // Round first, then derive. The client multiplies the quoted price by the
  // quantity, so contract value and margin have to come from the rounded
  // number rather than the raw one.
  const rung = (margin: number): MarginRung => {
    const raw = priceAtMargin(margin, totalCostUsdPerLb, marginBaseUsdPerLb, settings.marginMode);
    const displayPrice = ceilPrice(
      toQuoteUnit(raw, destination.quoteCurrency, destination.quoteUnit, fx),
    );
    const priceUsdPerLb = fromQuoteUnit(
      displayPrice,
      destination.quoteCurrency,
      destination.quoteUnit,
      fx,
    );
    return {
      margin,
      priceUsdPerLb,
      displayPrice,
      marginUsdPerLb: priceUsdPerLb - totalCostUsdPerLb,
      totalValueUsd: priceUsdPerLb * totalLbs,
    };
  };

  const ladderMargins = [...settings.ladder].sort((a, b) => a - b);
  if (!ladderMargins.some((m) => Math.abs(m - settings.minMargin) < 1e-9)) {
    ladderMargins.unshift(settings.minMargin);
  }

  return {
    lines,
    differentialUsdPerLb,
    greenCoffeeUsdPerLb,
    financeUsdPerLb,
    storageUsdPerLb,
    totalCostUsdPerLb,
    marginBaseUsdPerLb,
    totalLbs,
    bags: input.bags,
    containers,
    billableMonths: months,
    waivedFixedCost,
    copExposureUsdPerLb,
    quoteCurrency: destination.quoteCurrency,
    quoteUnit: destination.quoteUnit,
    floor: rung(settings.minMargin),
    ladder: ladderMargins.map(rung),
    warnings,
  };
}

/** Which reference table a line's amount came from, for the audit view. */
const SOURCE_OF: Record<string, CostLineTrace['source']> = {
  fixed: 'Fixed',
  packaging: 'Packaging',
  process: 'Process',
  destination: 'Destination',
};

/**
 * Add the published lines back up and compare to the reported total.
 *
 * calculateQuote accumulates its total while walking the lines, so a cost that
 * reached the total without reaching the table — or the reverse — would not
 * show up anywhere. This adds the table up on its own and says whether the two
 * agree.
 */
export function reconcile(result: QuoteResult): Reconciliation {
  const includedLinesUsdPerLb = result.lines
    .filter((line) => line.included)
    .reduce((sum, line) => sum + line.usdPerLb, 0);
  const rebuiltTotalUsdPerLb = result.greenCoffeeUsdPerLb + includedLinesUsdPerLb;
  const differenceUsdPerLb = rebuiltTotalUsdPerLb - result.totalCostUsdPerLb;
  return {
    greenCoffeeUsdPerLb: result.greenCoffeeUsdPerLb,
    includedLinesUsdPerLb,
    rebuiltTotalUsdPerLb,
    reportedTotalUsdPerLb: result.totalCostUsdPerLb,
    differenceUsdPerLb,
    // A tenth of a millionth of a cent per pound: floating-point noise, not a
    // costing error. On a full container that is under a thousandth of a cent.
    matches: Math.abs(differenceUsdPerLb) < 1e-9,
  };
}

const n = (value: number, digits = 4): string =>
  Number.isFinite(value)
    ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '—';

/**
 * Every step from break-even cost to the price the client is shown.
 *
 * Written out so the numbers can be checked by hand: each step names its
 * operands, and the last steps show what the rounding cost — the quoted price
 * is rounded up, so the margin actually earned is a little above the one asked
 * for, and the contract value follows the rounded price rather than the raw
 * one.
 */
export function explainRung(
  rung: MarginRung,
  result: QuoteResult,
  settings: EngineSettings,
  fx: ReferenceData['fx'],
): PriceStep[] {
  const cost = result.totalCostUsdPerLb;
  const base = result.marginBaseUsdPerLb;
  const excluded = result.lines
    .filter((line) => line.included && line.isMargin)
    .reduce((sum, line) => sum + line.usdPerLb, 0);
  const raw = priceAtMargin(rung.margin, cost, base, settings.marginMode);
  const inQuoteUnit = toQuoteUnit(raw, result.quoteCurrency, result.quoteUnit, fx);
  const perLbFactor =
    result.quoteUnit === 'lb' ? 1 : result.quoteUnit === 'kg' ? LB_PER_KG : LB_PER_MT;
  const rate = fx[result.quoteCurrency] ?? Number.NaN;

  const steps: PriceStep[] = [
    {
      label: 'Break-even cost',
      detail: `green coffee ${n(result.greenCoffeeUsdPerLb)} + differential ${n(result.differentialUsdPerLb)} + finance ${n(result.financeUsdPerLb)}`,
      value: cost,
      kind: 'usdPerLb',
    },
    {
      label: 'Margin base',
      detail:
        settings.marginBase === 'full_landed_cost'
          ? excluded > 0
            ? `the full cost ${n(cost)} less ${n(excluded)} of lines flagged as margin`
            : `the full break-even cost, no lines flagged as margin`
          : `differential ${n(result.differentialUsdPerLb)} + finance ${n(result.financeUsdPerLb)}${excluded > 0 ? ` less ${n(excluded)} flagged as margin` : ''}`,
      value: base,
      kind: 'usdPerLb',
    },
    {
      label: `Price at ${(rung.margin * 100).toFixed(2)}%`,
      detail:
        settings.marginMode === 'on_cost'
          ? `markup: ${n(cost)} + ${(rung.margin * 100).toFixed(2)}% x ${n(base)}`
          : `gross margin: ${n(cost)} - ${n(base)} + ${n(base)} / (1 - ${rung.margin.toFixed(4)})`,
      value: raw,
      kind: 'usdPerLb',
    },
  ];

  if (result.quoteUnit !== 'lb' || result.quoteCurrency !== 'USD') {
    steps.push({
      label: `In ${result.quoteCurrency} per ${result.quoteUnit}`,
      detail: `${n(raw)} x ${n(perLbFactor, 6)} lb per ${result.quoteUnit} / ${n(rate, 6)} USD per ${result.quoteCurrency}`,
      value: inQuoteUnit,
      kind: 'quotePrice',
    });
  }

  steps.push(
    {
      label: 'Rounded up, 2 decimals',
      detail: `${n(inQuoteUnit)} rounded up, never down, so the quote cannot land under the computed price`,
      value: rung.displayPrice,
      kind: 'quotePrice',
    },
    {
      label: 'That price back in USD/lb',
      detail: 'everything below is derived from the rounded price, so the client can multiply it out',
      value: rung.priceUsdPerLb,
      kind: 'usdPerLb',
    },
    {
      label: 'Margin actually earned',
      detail: `${n(rung.priceUsdPerLb)} against cost ${n(cost)} — rounding up adds ${n(rung.priceUsdPerLb - raw, 6)}/lb`,
      value: marginAtPrice(rung.priceUsdPerLb, cost, base, settings.marginMode),
      kind: 'ratio',
    },
    {
      label: 'Contract value',
      detail: `${n(rung.priceUsdPerLb)} x ${n(result.totalLbs, 1)} lb (${result.bags} bags)`,
      value: rung.totalValueUsd,
      kind: 'usdTotal',
    },
  );

  return steps;
}

/** Price a quote at an arbitrary margin, outside the published ladder. */
export function rungAt(margin: number, input: QuoteInput, ref: ReferenceData): MarginRung {
  const result = calculateQuote(input, ref);
  const raw = priceAtMargin(
    margin,
    result.totalCostUsdPerLb,
    result.marginBaseUsdPerLb,
    ref.settings.marginMode,
  );
  const destination = need(ref.destinations, input.destinationKey, 'destination');
  const displayPrice = ceilPrice(
    toQuoteUnit(raw, destination.quoteCurrency, destination.quoteUnit, ref.fx),
  );
  const priceUsdPerLb = fromQuoteUnit(
    displayPrice,
    destination.quoteCurrency,
    destination.quoteUnit,
    ref.fx,
  );
  return {
    margin,
    priceUsdPerLb,
    displayPrice,
    marginUsdPerLb: priceUsdPerLb - result.totalCostUsdPerLb,
    totalValueUsd: priceUsdPerLb * result.totalLbs,
  };
}

/**
 * Reverse solve: the trader names a target selling price and we report the
 * margin it implies, plus whether it clears the floor.
 */
export function solveForPrice(
  targetUsdPerLb: number,
  result: QuoteResult,
  settings: EngineSettings,
): { margin: number; marginUsdPerLb: number; belowFloor: boolean; belowCost: boolean } {
  const margin = marginAtPrice(
    targetUsdPerLb,
    result.totalCostUsdPerLb,
    result.marginBaseUsdPerLb,
    settings.marginMode,
  );
  return {
    margin,
    marginUsdPerLb: targetUsdPerLb - result.totalCostUsdPerLb,
    belowFloor: margin < settings.minMargin,
    belowCost: targetUsdPerLb < result.totalCostUsdPerLb,
  };
}

/**
 * What KC would have to be for a named price to carry a named margin.
 *
 * Price is affine in the KC leg — the finance line scales it, nothing bends it
 * — so two evaluations pin the line exactly, whatever the margin mode or base
 * is set to. No iteration, and it stays correct if the policy changes.
 *
 * Returns null when the price does not respond to KC at all.
 */
export function kcForTarget(
  targetUsdPerLb: number,
  margin: number,
  input: QuoteInput,
  ref: ReferenceData,
): number | null {
  const priceAt = (kcUsdPerLb: number) => {
    const r = calculateQuote({ ...input, kcUsdPerLb }, ref);
    return priceAtMargin(margin, r.totalCostUsdPerLb, r.marginBaseUsdPerLb, ref.settings.marginMode);
  };
  const atZero = priceAt(0);
  const slope = priceAt(1) - atZero;
  if (!Number.isFinite(slope) || Math.abs(slope) < 1e-9) return null;
  return (targetUsdPerLb - atZero) / slope;
}

/**
 * A contract shipped across several months, each against its own KC.
 *
 * Because `priceAtMargin` is affine in cost and base, the volume-weighted price
 * equals the price computed from the volume-weighted cost — so the blended
 * figure and its reverse solve use exactly the same functions as a single
 * quote, rather than a parallel code path that could drift.
 */
export function calculateContract(
  shipments: Shipment[],
  base: Omit<QuoteInput, 'bags' | 'kcUsdPerLb'>,
  margin: number,
  ref: ReferenceData,
): ContractResult {
  const destination = need(ref.destinations, base.destinationKey, 'destination');
  const warnings: QuoteWarning[] = [];

  const priced: ShipmentResult[] = shipments.map((s) => {
    const result = calculateQuote(
      { ...base, bags: s.bags, kcUsdPerLb: s.kcCents / 100 },
      ref,
    );
    const raw = priceAtMargin(
      margin,
      result.totalCostUsdPerLb,
      result.marginBaseUsdPerLb,
      ref.settings.marginMode,
    );
    const displayPrice = ceilPrice(
      toQuoteUnit(raw, destination.quoteCurrency, destination.quoteUnit, ref.fx),
    );
    const priceUsdPerLb = fromQuoteUnit(
      displayPrice,
      destination.quoteCurrency,
      destination.quoteUnit,
      ref.fx,
    );
    return {
      ...s,
      result,
      priceUsdPerLb,
      displayPrice,
      valueUsd: priceUsdPerLb * result.totalLbs,
    };
  });

  const totalLbs = priced.reduce((sum, x) => sum + x.result.totalLbs, 0);
  const totalBags = priced.reduce((sum, x) => sum + x.bags, 0);
  const weight = (pick: (x: ShipmentResult) => number) =>
    totalLbs > 0 ? priced.reduce((sum, x) => sum + pick(x) * x.result.totalLbs, 0) / totalLbs : 0;

  const weightedCostUsdPerLb = weight((x) => x.result.totalCostUsdPerLb);
  const weightedMarginBaseUsdPerLb = weight((x) => x.result.marginBaseUsdPerLb);
  const weightedKcUsdPerLb = weight((x) => x.kcCents / 100);

  const blendedRaw = priceAtMargin(
    margin,
    weightedCostUsdPerLb,
    weightedMarginBaseUsdPerLb,
    ref.settings.marginMode,
  );
  const consolidatedDisplay = ceilPrice(
    toQuoteUnit(blendedRaw, destination.quoteCurrency, destination.quoteUnit, ref.fx),
  );
  const consolidatedUsdPerLb = fromQuoteUnit(
    consolidatedDisplay,
    destination.quoteCurrency,
    destination.quoteUnit,
    ref.fx,
  );

  if (priced.some((x) => x.bags <= 0)) {
    warnings.push({ text: 'A shipment has no bags — it adds nothing to the blend.', adminOnly: false });
  }
  if (priced.some((x) => x.kcCents <= 0)) {
    warnings.push({ text: 'A shipment has no KC price entered.', adminOnly: false });
  }

  return {
    shipments: priced,
    margin,
    totalLbs,
    totalBags,
    weightedCostUsdPerLb,
    weightedMarginBaseUsdPerLb,
    weightedKcUsdPerLb,
    consolidatedUsdPerLb,
    consolidatedDisplay,
    // The contract is the sum of its shipment lines — that is the figure a
    // client gets by adding the quote up. The blended price is a summary on
    // top of it, rounded on its own.
    totalValueUsd: priced.reduce((sum, x) => sum + x.valueUsd, 0),
    quoteCurrency: destination.quoteCurrency,
    quoteUnit: destination.quoteUnit,
    warnings,
  };
}
