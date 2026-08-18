import type { CurrencyCode, FxTable, QuoteUnit } from './types';

/** Pounds in one kilogram. */
export const LB_PER_KG = 2.2046226218487757;

/** Pounds in one metric tonne. */
export const LB_PER_MT = LB_PER_KG * 1000;

/** A standard 17.5 MT coffee container, in pounds. Matches the source sheet. */
export const DEFAULT_LBS_PER_CONTAINER = 38580.5;

/** Pounds in the 32.5 MT truck load ground transport is quoted against. */
export const LBS_PER_TRUCK = 71649.5;

/**
 * Client-facing prices carry two decimals and always round up, so a quote can
 * never land below the price the engine computed. Costs keep full precision —
 * only what the client is quoted gets rounded.
 */
export const PRICE_DP = 2;

export function ceilPrice(value: number): number {
  if (!Number.isFinite(value)) return value;
  // The epsilon keeps a value already on the cent from being pushed up one.
  return Math.ceil(value * 100 - 1e-9) / 100;
}

/** Convert an amount in `currency` to US dollars. */
export function toUsd(amount: number, currency: CurrencyCode, fx: FxTable): number {
  const rate = fx[currency];
  if (!rate || !Number.isFinite(rate)) throw new Error(`Missing or invalid FX rate for ${currency}`);
  return amount * rate;
}

/** Convert US dollars to `currency`. */
export function fromUsd(amountUsd: number, currency: CurrencyCode, fx: FxTable): number {
  const rate = fx[currency];
  if (!rate || !Number.isFinite(rate)) throw new Error(`Missing or invalid FX rate for ${currency}`);
  return amountUsd / rate;
}

/**
 * A USD/lb price in the unit and currency a destination is quoted in. US
 * destinations take USD/lb; everyone else their own currency per kilo.
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

/** Inverse of `toQuoteUnit` — a client-facing price back to USD/lb. */
export function fromQuoteUnit(
  price: number,
  currency: CurrencyCode,
  unit: QuoteUnit,
  fx: FxTable,
): number {
  const perUnitUsd = toUsd(price, currency, fx);
  return unit === 'lb' ? perUnitUsd : unit === 'kg' ? perUnitUsd / LB_PER_KG : perUnitUsd / LB_PER_MT;
}

/** A whole-contract total in the currency the client is invoiced in. */
export function totalInQuoteCurrency(
  totalUsd: number,
  currency: CurrencyCode,
  fx: FxTable,
): number {
  return fromUsd(totalUsd, currency, fx);
}

/** KC futures quote in US cents/lb -> USD/lb. */
export const centsToUsd = (cents: number): number => cents / 100;

/** USD/lb -> KC-style US cents/lb. */
export const usdToCents = (usd: number): number => usd * 100;

/** TRM (COP per USD) expressed the way the FX table wants it: USD per COP. */
export function trmToUsdPerCop(trm: number): number {
  if (!trm || !Number.isFinite(trm) || trm <= 0) throw new Error(`Invalid TRM: ${trm}`);
  return 1 / trm;
}

/** USD per COP back to a human-readable TRM. */
export const usdPerCopToTrm = (usdPerCop: number): number => 1 / usdPerCop;

export const UNIT_LABEL: Record<QuoteUnit, string> = { lb: 'lb', kg: 'kg', mt: 'MT' };
