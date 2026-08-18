import type {
  CostLine,
  CostLineResult,
  Destination,
  EngineSettings,
  MarginRung,
  PackagingType,
  ProcessType,
  QuoteInput,
  QuoteResult,
  ReferenceData,
} from './types';
import { toQuoteUnit, toUsd } from './units';

/**
 * Price for a given margin.
 *
 * `cost` is the full break-even (green coffee + every cost line). `base` is the
 * slice of that cost the margin percentage is charged against — normally the
 * whole thing, but the admin module can narrow it to the logistics differential
 * or exclude lines flagged as margin.
 *
 *  - `on_cost` : markup. price = cost + m * base
 *  - `on_price`: gross margin. The base is grossed up so that margin is `m` of
 *                the grossed-up portion; anything outside the base passes
 *                through at cost. With base === cost this is the familiar
 *                price = cost / (1 - m).
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

/** Build the ladder of margin steps, always including the floor. */
function buildLadder(settings: EngineSettings): number[] {
  const { ladderFrom, ladderTo, ladderStep, minMargin } = settings;
  const steps: number[] = [];
  if (ladderStep > 0) {
    // Work in basis points so 0.02 steps don't drift on floating point.
    const from = Math.round(ladderFrom * 10000);
    const to = Math.round(ladderTo * 10000);
    const step = Math.round(ladderStep * 10000);
    for (let bp = from; bp <= to + 1; bp += step) steps.push(bp / 10000);
  }
  if (!steps.some((m) => Math.abs(m - minMargin) < 1e-9)) steps.unshift(minMargin);
  return steps.sort((a, b) => a - b);
}

function need<T extends { key: string; active?: boolean }>(
  list: T[],
  key: string,
  what: string,
): T {
  const found = list.find((x) => x.key === key);
  if (!found) throw new Error(`Unknown ${what}: "${key}"`);
  return found;
}

interface ResolvedAmount {
  amount: number;
  currency: CostLine['currency'];
  lbsPerUnit: number;
}

/**
 * Look up a cost line's amount. Lines driven by a quote selection read their
 * value from the packaging / process / destination tables instead of carrying
 * a fixed amount of their own.
 */
function resolveAmount(
  line: CostLine,
  packaging: PackagingType,
  process: ProcessType,
  destination: Destination,
): ResolvedAmount {
  switch (line.driver) {
    case 'packaging':
      return {
        amount: packaging.amount,
        currency: packaging.currency,
        lbsPerUnit: packaging.lbsPerUnit,
      };
    case 'process':
      return { amount: process.amount, currency: process.currency, lbsPerUnit: process.lbsPerUnit };
    case 'destination': {
      if (line.key === 'seafreight') {
        return {
          amount: destination.seafreightAmount,
          currency: destination.seafreightCurrency,
          lbsPerUnit: destination.seafreightLbsPerUnit,
        };
      }
      if (line.key === 'import_cost') {
        return {
          amount: destination.importAmount,
          currency: destination.importCurrency,
          lbsPerUnit: destination.importLbsPerUnit,
        };
      }
      if (line.key === 'unloading_ddp') {
        return {
          amount: destination.unloadingAmount,
          currency: destination.unloadingCurrency,
          lbsPerUnit: destination.unloadingLbsPerUnit,
        };
      }
      if (line.key === 'storage') {
        // Storage is billed per packaging unit per month, so smaller bags cost
        // more per pound to hold — same as the source sheet.
        return {
          amount: destination.storageAmount,
          currency: destination.storageCurrency,
          lbsPerUnit: packaging.lbsPerUnit,
        };
      }
      throw new Error(`Cost line "${line.key}" is destination-driven but has no lookup`);
    }
    case 'fixed':
    default:
      return { amount: line.amount, currency: line.currency, lbsPerUnit: line.lbsPerUnit };
  }
}

export function calculateQuote(input: QuoteInput, ref: ReferenceData): QuoteResult {
  const { fx, settings } = ref;
  const destination = need(ref.destinations, input.destinationKey, 'destination');
  const process = need(ref.processes, input.processKey, 'process');
  const packaging = need(ref.packaging, input.packagingKey, 'packaging type');
  const warnings: string[] = [];

  // ---- quantity -----------------------------------------------------------
  const lbsPerContainer = input.lbsPerContainer > 0 ? input.lbsPerContainer : 38580.5;
  const totalLbs =
    input.quantityMode === 'containers'
      ? input.quantity * lbsPerContainer
      : input.quantityMode === 'bags'
        ? input.quantity * packaging.lbsPerUnit
        : input.quantity;
  const containers = totalLbs / lbsPerContainer;
  const bags = totalLbs / packaging.lbsPerUnit;

  if (totalLbs <= 0) warnings.push('Quantity is zero — totals will be zero.');
  if (Math.abs(containers - Math.round(containers)) > 0.001) {
    warnings.push(
      `${containers.toFixed(2)} containers is not a whole load. Per-pound freight, port and ` +
        `transport costs assume full containers, so a partial load will be understated.`,
    );
  }
  if (!destination.allowedIncoterms.includes(input.incoterm)) {
    warnings.push(`${input.incoterm} is not configured as an allowed incoterm for ${destination.label}.`);
  }

  // ---- per-line costs -----------------------------------------------------
  const lines: CostLineResult[] = [];
  let differentialUsdPerLb = 0;
  let storageUsdPerLb = 0;
  let copExposureUsdPerLb = 0;
  let financeLineIndex = -1;

  const ordered = [...ref.costLines].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const line of ordered) {
    let included = true;
    let excludedReason: string | undefined;

    if (!line.active) {
      included = false;
      excludedReason = 'Disabled in admin';
    } else if (line.group === 'freight' && input.incoterm === 'FOB') {
      included = false;
      excludedReason = 'FOB — buyer pays ocean freight';
    } else if (line.group === 'import' && input.incoterm !== 'DDP') {
      included = false;
      excludedReason = `${input.incoterm} — buyer clears import`;
    } else if (line.group === 'optional') {
      const on =
        input.enabledLines.includes(line.key) ||
        (line.defaultOn && !input.disabledLines.includes(line.key));
      if (!on) {
        included = false;
        excludedReason = 'Not enabled on this quote';
      }
    } else if (line.optional && input.disabledLines.includes(line.key)) {
      included = false;
      excludedReason = 'Switched off on this quote';
    }

    const months =
      line.key === 'storage'
        ? input.storageMonths
        : line.key === 'finance'
          ? input.financeMonths
          : 0;
    if (included && line.perMonth && months <= 0) {
      included = false;
      excludedReason = 'Zero months';
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
      });
      if (included) financeLineIndex = lines.length - 1;
      continue;
    }

    const resolved = resolveAmount(line, packaging, process, destination);
    const perUnit =
      line.basis === 'per_lb'
        ? resolved.amount
        : resolved.lbsPerUnit > 0
          ? resolved.amount / resolved.lbsPerUnit
          : 0;
    const nativePerLb = perUnit * (line.perMonth ? months : 1);
    const usdPerLb = included ? toUsd(nativePerLb, resolved.currency, fx) : 0;

    if (included) {
      differentialUsdPerLb += usdPerLb;
      if (line.key === 'storage') storageUsdPerLb += usdPerLb;
      if (resolved.currency === 'COP') copExposureUsdPerLb += usdPerLb;
    }
    if (included && line.basis === 'per_unit' && resolved.lbsPerUnit <= 0) {
      warnings.push(`${line.label} has no pounds-per-unit configured and was priced at zero.`);
    }
    if (included && resolved.amount === 0) {
      warnings.push(`${line.label} is configured at zero for ${destination.label}.`);
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
    });
  }

  // ---- green coffee + finance --------------------------------------------
  const greenCoffeeUsdPerLb = input.kcPriceUsdPerLb + input.premiumUsdPerLb;
  if (input.kcPriceUsdPerLb <= 0) warnings.push('No KC price entered for this month.');
  if (input.premiumUsdPerLb === 0) warnings.push('No quality premium set for this month.');

  // Finance is charged on the full cargo value — the coffee plus everything
  // spent getting it to the client — not just the logistics differential.
  const financeBase = greenCoffeeUsdPerLb + differentialUsdPerLb;
  let financeUsdPerLb = 0;
  if (financeLineIndex >= 0) {
    financeUsdPerLb = settings.financeMonthlyRate * input.financeMonths * financeBase;
    lines[financeLineIndex].usdPerLb = financeUsdPerLb;
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

  const rung = (margin: number): MarginRung => {
    const priceUsdPerLb = priceAtMargin(
      margin,
      totalCostUsdPerLb,
      marginBaseUsdPerLb,
      settings.marginMode,
    );
    return {
      margin,
      priceUsdPerLb,
      marginUsdPerLb: priceUsdPerLb - totalCostUsdPerLb,
      totalValueUsd: priceUsdPerLb * totalLbs,
      displayPrice: toQuoteUnit(
        priceUsdPerLb,
        destination.quoteCurrency,
        destination.quoteUnit,
        fx,
      ),
    };
  };

  return {
    lines,
    differentialUsdPerLb,
    greenCoffeeUsdPerLb,
    financeUsdPerLb,
    storageUsdPerLb,
    totalCostUsdPerLb,
    marginBaseUsdPerLb,
    totalLbs,
    containers,
    bags,
    floor: rung(settings.minMargin),
    ladder: buildLadder(settings).map(rung),
    quoteCurrency: destination.quoteCurrency,
    quoteUnit: destination.quoteUnit,
    copExposureUsdPerLb,
    warnings,
  };
}

/**
 * Reverse solve: the trader names a target selling price and we report the
 * margin it implies, plus whether that clears the configured floor.
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

/** Forward solve: the trader names a margin and we report the price. */
export function solveForMargin(
  margin: number,
  result: QuoteResult,
  settings: EngineSettings,
): MarginRung {
  const priceUsdPerLb = priceAtMargin(
    margin,
    result.totalCostUsdPerLb,
    result.marginBaseUsdPerLb,
    settings.marginMode,
  );
  return {
    margin,
    priceUsdPerLb,
    marginUsdPerLb: priceUsdPerLb - result.totalCostUsdPerLb,
    totalValueUsd: priceUsdPerLb * result.totalLbs,
    displayPrice: priceUsdPerLb,
  };
}
