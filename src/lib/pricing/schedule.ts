/**
 * The contract calendar.
 *
 * A contract runs from one shipment month to another and the volume is drawn
 * down evenly across that window. Months are keyed `YYYY-MM`.
 */

export const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export interface CalendarMonth {
  key: string;
  label: string;
}

export function monthIndex(key: string): number {
  const [year, month] = key.split('-').map(Number);
  return year * 12 + (month - 1);
}

export function monthKeyFrom(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  if (!Number.isFinite(year) || !MONTH_NAMES[month - 1]) return key;
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** A rolling window of selectable shipment months, opening at `from`. */
export function monthOptions(from: Date, count = 24): CalendarMonth[] {
  const first = from.getUTCFullYear() * 12 + from.getUTCMonth();
  return Array.from({ length: count }, (_, i) => {
    const key = monthKeyFrom(first + i);
    return { key, label: monthLabel(key) };
  });
}

/** Every month the contract covers, first and last inclusive. */
export function monthsBetween(fromKey: string, toKey: string): CalendarMonth[] {
  const start = monthIndex(fromKey);
  const end = Math.max(start, monthIndex(toKey));
  const out: CalendarMonth[] = [];
  for (let i = start; i <= end; i += 1) {
    const key = monthKeyFrom(i);
    out.push({ key, label: monthLabel(key) });
  }
  return out;
}

export function monthSpan(fromKey: string, toKey: string): number {
  return Math.max(1, monthIndex(toKey) - monthIndex(fromKey) + 1);
}

/**
 * Spread whole units across a window so the parts add up to the whole: everyone
 * gets the floor, then the remainder goes to the largest fractions. Used for
 * both bags and monthly billing, so a client adding either column lands exactly
 * on the printed total.
 */
export function apportion(exact: number[], total: number): number[] {
  const target = Math.round(total);
  const out = exact.map((v) => Math.floor(v));
  const byFraction = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  let rest = target - out.reduce((sum, v) => sum + v, 0);
  for (let k = 0; rest > 0 && byFraction.length; k += 1, rest -= 1) {
    out[byFraction[k % byFraction.length].i] += 1;
  }
  return out;
}

export interface ScheduleMonth extends CalendarMonth {
  bags: number;
  lbs: number;
  /** Billing in the client's currency, apportioned to sum to the contract total. */
  billing: number;
}

export interface DeliveryPlan {
  months: ScheduleMonth[];
  /** Average bags a month; whole when the split is even. */
  perMonthBags: number;
  even: boolean;
  /** Contract total in the client's currency. */
  totalValue: number;
}

/**
 * Split the volume and the billing across the contract window. Bags are whole,
 * so any remainder rides on the earliest months rather than leaving a
 * fractional sack behind.
 */
export function deliveryPlan(
  fromKey: string,
  toKey: string,
  totalBags: number,
  lbsPerBag: number,
  totalValue: number,
): DeliveryPlan {
  const months = monthsBetween(fromKey, toKey);
  const bags = apportion(months.map(() => totalBags / months.length), totalBags);
  const exactValue = bags.map((b) => (totalBags > 0 ? (totalValue * b) / totalBags : 0));
  const billing = apportion(exactValue, totalValue);
  return {
    months: months.map((m, i) => ({
      ...m,
      bags: bags[i],
      lbs: bags[i] * lbsPerBag,
      billing: billing[i],
    })),
    perMonthBags: months.length ? totalBags / months.length : 0,
    even: bags.every((b) => b === bags[0]),
    totalValue,
  };
}
