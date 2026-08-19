import type { PremiumOverride, PremiumResolution, SeasonalPremium } from '../store/types';

/**
 * The quality differential for one shipment month.
 *
 * Two layers, in this order: a dated override for that exact month, then the
 * seasonal figure for its month of the year. A differential follows the
 * harvest, so the season is the shape and a dated row is the exception — a
 * short crop, a run on a lot — that belongs to one year only.
 *
 * Nothing here falls back to a neighbouring month. A month with no figure
 * reports itself unset rather than quietly borrowing one, because a premium
 * invented from the next month along is a costing error that prices like a
 * fact. The screen says so and the trader decides.
 */
export function premiumForMonth(
  monthKey: string,
  seasonal: SeasonalPremium[],
  overrides: PremiumOverride[],
): PremiumResolution {
  const override = overrides.find((o) => o.monthKey === monthKey);
  if (override) {
    return {
      monthKey,
      premiumCents: override.premiumCents,
      source: 'override',
      note: override.note,
    };
  }

  const month = monthOfYear(monthKey);
  const row = month === null ? undefined : seasonal.find((s) => s.month === month);
  if (row && row.updatedBy !== 'seed') {
    return { monthKey, premiumCents: row.premiumCents, source: 'seasonal', note: '' };
  }

  return { monthKey, premiumCents: row?.premiumCents ?? 0, source: 'unset', note: '' };
}

/** 1 for January through 12 for December, or null if the key is not a month. */
export function monthOfYear(monthKey: string): number | null {
  const month = Number(monthKey.split('-')[1]);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

export const MONTH_OF_YEAR_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
