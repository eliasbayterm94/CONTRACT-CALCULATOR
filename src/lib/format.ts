import type { CurrencyCode, QuoteUnit } from './pricing/types';
import { UNIT_LABEL, unitPrecision } from './pricing/units';

const SYMBOL: Partial<Record<CurrencyCode, string>> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  CAD: 'C$',
  COP: 'COP ',
};

export function money(value: number, currency: CurrencyCode = 'USD', digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return `${SYMBOL[currency] ?? `${currency} `}${value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** A price in the unit and currency the client is quoted in. */
export function unitPrice(value: number, currency: CurrencyCode, unit: QuoteUnit): string {
  if (!Number.isFinite(value)) return '—';
  return `${money(value, currency, unitPrecision(unit))}/${UNIT_LABEL[unit]}`;
}

/** US cents per pound, the unit KC itself trades in. */
export function cents(usdPerLb: number, digits = 2): string {
  if (!Number.isFinite(usdPerLb)) return '—';
  return `${(usdPerLb * 100).toFixed(digits)}¢`;
}

export function percent(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return '—';
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function plain(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function shortDate(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
