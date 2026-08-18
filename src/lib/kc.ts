/**
 * Coffee "C" (KC) contract month helpers.
 *
 * KC trades five delivery months a year, each with a single-letter code:
 * March (H), May (K), July (N), September (U) and December (Z). A month key
 * here is the year followed by the code, e.g. `2026H`.
 */

export interface ContractMonth {
  /** e.g. `2026H` */
  key: string;
  year: number;
  /** 1-12 */
  month: number;
  code: 'H' | 'K' | 'N' | 'U' | 'Z';
  /** e.g. `Mar 26 (H)` */
  label: string;
}

const CODES: Array<{ month: number; code: ContractMonth['code']; short: string }> = [
  { month: 3, code: 'H', short: 'Mar' },
  { month: 5, code: 'K', short: 'May' },
  { month: 7, code: 'N', short: 'Jul' },
  { month: 9, code: 'U', short: 'Sep' },
  { month: 12, code: 'Z', short: 'Dec' },
];

function build(year: number, spec: (typeof CODES)[number]): ContractMonth {
  return {
    key: `${year}${spec.code}`,
    year,
    month: spec.month,
    code: spec.code,
    label: `${spec.short} ${String(year).slice(2)} (${spec.code})`,
  };
}

/** The next `count` contract months at or after the given date. */
export function upcomingContractMonths(from: Date, count = 8): ContractMonth[] {
  const out: ContractMonth[] = [];
  let year = from.getUTCFullYear();
  const fromMonth = from.getUTCMonth() + 1;
  while (out.length < count) {
    for (const spec of CODES) {
      if (out.length >= count) break;
      if (year === from.getUTCFullYear() && spec.month < fromMonth) continue;
      out.push(build(year, spec));
    }
    year += 1;
  }
  return out;
}

/**
 * The contract month a shipment prices against: the first delivery month at or
 * after the shipment month. Traders can override this on the quote.
 */
export function contractMonthForShipment(shipYear: number, shipMonth: number): ContractMonth {
  for (const spec of CODES) {
    if (spec.month >= shipMonth) return build(shipYear, spec);
  }
  return build(shipYear + 1, CODES[0]);
}

export function parseMonthKey(key: string): ContractMonth | null {
  const match = /^(\d{4})([HKNUZ])$/.exec(key);
  if (!match) return null;
  const spec = CODES.find((c) => c.code === match[2]);
  if (!spec) return null;
  return build(Number(match[1]), spec);
}

export function monthKeyLabel(key: string): string {
  return parseMonthKey(key)?.label ?? key;
}

/** Sort helper: chronological order by delivery date. */
export function compareMonthKeys(a: string, b: string): number {
  const pa = parseMonthKey(a);
  const pb = parseMonthKey(b);
  if (!pa || !pb) return a.localeCompare(b);
  return pa.year - pb.year || pa.month - pb.month;
}
