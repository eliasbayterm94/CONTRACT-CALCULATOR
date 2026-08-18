import type { CurrencyCode, FxTable, QuoteUnit } from './types';

/** Pounds in one kilogram. */
export const LB_PER_KG = 2.2046226218487757;

/** Pounds in one metric tonne. */
export const LB_PER_MT = LB_PER_KG * 1000;

/** A standard 17.5 MT coffee container, in pounds. Matches the source sheet. */
export const DEFAULT_LBS_PER_CONTAINER = 38580.5;

/** Convert an amount in `currency` to US dollars. */
export function toUsd(amount: number, currency: CurrencyCode, fx: FxTable): number {
  const rate = fx[currency];
  if (!rate || !Number.isFinite(rate)) {
    throw new Error(`Missing or invalid FX rate for ${currency}`);
  }
  return amount * rate;
}

/** Convert US dollars to `currency`. */
export function fromUsd(amountUsd: number, currency: CurrencyCode, fx: FxTable): number {
  const rate = fx[currency];
  if (!rate || !Number.isFinite(rate)) {
    throw new Error(`Missing or invalid FX rate for ${currency}`);
  }
  return amountUsd / rate;
}

/**
 * Convert a USD/lb price into the unit and currency a destination is quoted in.
 * US destinations take USD/lb; everyone else takes their own currency per kg.
 */
export function toQuoteUnit(
  usdPerLb: number,
  currency: CurrencyCode,
  unit: QuoteUnit,
  fx: FxTable,
): number {
  const perUnitUsd =
    unit === 'lb' ? usdPerLb : unit === 'kg' ? usdPerLb * LB_PER_KG : usdPerLb * LB_PER_MT;
  return fromUsd(perUnitUsd, currency, fx);
}

/** Inverse of `toQuoteUnit` — takes a client-facing price back to USD/lb. */
export function fromQuoteUnit(
  price: number,
  currency: CurrencyCode,
  unit: QuoteUnit,
  fx: FxTable,
): number {
  const perUnitUsd = toUsd(price, currency, fx);
  return unit === 'lb' ? perUnitUsd : unit === 'kg' ? perUnitUsd / LB_PER_KG : perUnitUsd / LB_PER_MT;
}

/** KC futures quote in US cents/lb -> USD/lb. */
export function centsToUsd(cents: number): number {
  return cents / 100;
}

/** USD/lb -> KC-style US cents/lb. */
export function usdToCents(usd: number): number {
  return usd * 100;
}

/** TRM (COP per USD) expressed the way the FX table wants it: USD per COP. */
export function trmToUsdPerCop(trm: number): number {
  if (!trm || !Number.isFinite(trm) || trm <= 0) {
    throw new Error(`Invalid TRM: ${trm}`);
  }
  return 1 / trm;
}

/** USD per COP back to a human-readable TRM. */
export function usdPerCopToTrm(usdPerCop: number): number {
  return 1 / usdPerCop;
}

export const UNIT_LABEL: Record<QuoteUnit, string> = {
  lb: 'lb',
  kg: 'kg',
  mt: 'MT',
};

/** Decimal places worth showing for a price in the given unit. */
export function unitPrecision(unit: QuoteUnit): number {
  return unit === 'lb' ? 4 : unit === 'kg' ? 3 : 2;
}
