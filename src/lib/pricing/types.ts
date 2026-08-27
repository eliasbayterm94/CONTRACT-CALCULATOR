/**
 * Domain types for the Forest Coffee contract quote engine.
 *
 * Everything normalises to USD per pound — the unit the Coffee "C" (KC) futures
 * contract trades in. Conversion to the unit and currency a client is actually
 * quoted in happens at the edge, in `units.ts`.
 */

export type CurrencyCode = 'USD' | 'COP' | 'EUR' | 'AUD' | 'GBP' | 'CAD';

export const CURRENCIES: CurrencyCode[] = ['USD', 'COP', 'EUR', 'AUD', 'GBP', 'CAD'];

/** Incoterm ladder. Each tier is a superset of the one before it. */
export type Incoterm = 'FOB' | 'CIF' | 'DDP';

export const INCOTERMS: Incoterm[] = ['FOB', 'CIF', 'DDP'];

/**
 * Which stage of the journey a cost line belongs to.
 *  - `fob`     : always included
 *  - `freight` : from CIF up — ocean freight
 *  - `import`  : DDP only — import clearance and unloading
 *  - `hold`    : DDP only — storage and finance while we carry the coffee
 */
export type CostGroup = 'fob' | 'freight' | 'import' | 'hold';

export const COST_GROUP_LABEL: Record<CostGroup, string> = {
  fob: 'Origin & FOB',
  freight: 'Ocean freight',
  import: 'Destination',
  hold: 'Holding the contract',
};

/**
 * How a cost line's raw amount becomes a per-pound figure.
 *  - `per_lb`  : already per pound
 *  - `per_unit`: covers `lbsPerUnit` pounds — a bag, a container, a truck
 *  - `rate`    : a monthly rate applied to the cargo value (finance)
 */
export type CostBasis = 'per_lb' | 'per_unit' | 'rate';

/** What a line's amount is keyed on. */
export type CostDriver = 'fixed' | 'packaging' | 'process' | 'destination';

export interface CostLine {
  key: string;
  label: string;
  group: CostGroup;
  basis: CostBasis;
  driver: CostDriver;
  currency: CurrencyCode;
  /** Amount when `driver === 'fixed'`. Ignored otherwise. */
  amount: number;
  /** Pounds covered by one `amount` when `basis === 'per_unit'`. */
  lbsPerUnit: number;
  /** Multiplied by the months the line is carried (storage, finance). */
  perMonth: boolean;
  /**
   * Treated as margin rather than cost: still recovered in the price, but kept
   * out of the base the margin percentage is charged against.
   */
  isMargin: boolean;
  /** Admin can waive this line on a strategic deal. */
  waivable: boolean;
  sortOrder: number;
  active: boolean;
}

export interface PackagingType {
  key: string;
  label: string;
  kgPerUnit: number;
  lbsPerUnit: number;
  amount: number;
  currency: CurrencyCode;
  /** The one packaging traders may quote. Admin can use any active type. */
  traderDefault: boolean;
  active: boolean;
}

/**
 * A coffee type: what it costs to mill, and what the type itself is worth.
 *
 * The milling amount is a processing cost in pesos a bag. The premium is a
 * quality differential in US cents a pound, the same kind of figure as the
 * monthly one — decaf and organic are dearer coffee, not dearer milling.
 */
export interface ProcessType {
  key: string;
  label: string;
  /** Milling, in `currency` per `lbsPerUnit` pounds. */
  amount: number;
  lbsPerUnit: number;
  currency: CurrencyCode;
  /** What this type adds over a plain washed coffee, US cents per pound. */
  premiumCents: number;
  active: boolean;
}

export type QuoteUnit = 'lb' | 'kg' | 'mt';

export interface Destination {
  key: string;
  label: string;
  quoteCurrency: CurrencyCode;
  quoteUnit: QuoteUnit;
  seafreightAmount: number;
  seafreightCurrency: CurrencyCode;
  seafreightLbsPerUnit: number;
  importAmount: number;
  importCurrency: CurrencyCode;
  importLbsPerUnit: number;
  unloadingAmount: number;
  unloadingCurrency: CurrencyCode;
  unloadingLbsPerUnit: number;
  /** Warehouse storage, per packaging unit per month. */
  storageAmount: number;
  storageCurrency: CurrencyCode;
  allowedIncoterms: Incoterm[];
  active: boolean;
}

/** How the margin percentage is interpreted. */
export type MarginMode =
  /** a share of the final selling price: price = cost / (1 - m) */
  | 'on_price'
  /** a markup on cost: price = cost * (1 + m) */
  | 'on_cost';

/** What the margin percentage is charged against. */
export type MarginBase = 'full_landed_cost' | 'differential_only';

/** FX expressed as US dollars per one unit of the currency. */
export type FxTable = Record<CurrencyCode, number>;

export interface EngineSettings {
  marginMode: MarginMode;
  marginBase: MarginBase;
  /** Floor margin every quote is held to, as a fraction. */
  minMargin: number;
  /** The rungs shown to traders, as fractions, in ascending order. */
  ladder: number[];
  /** Monthly finance rate as a fraction (0.0072 = 0.72% per month). */
  financeMonthlyRate: number;
  /** Months of carry the fixed cost already covers before storage and finance bill. */
  freeHoldMonths: number;
  /** Days a quoted price is held, before the C market moves it. */
  validDays: number;
  /** How old a rate or premium may get before the desk is warned, in days. */
  staleAfterDays: number;
  /**
   * Floor margin by order size, largest orders last.
   *
   * The coffee costs the same per pound at any volume — a part load rides in a
   * shared container, so freight and port are already shared pro rata. A
   * volume break is therefore a commercial decision and nothing else, which is
   * why it moves the floor rather than the cost.
   */
  volumeBrackets: VolumeBracket[];
}

export interface VolumeBracket {
  fromBags: number;
  /** Null on the last bracket: it runs to any size. */
  toBags: number | null;
  minMargin: number;
}

/** Which bracket an order fell into, and what it means for the quote. */
export interface VolumeBand {
  bracket: VolumeBracket | null;
  minMargin: number;
  /** Below the smallest bracket: outside policy, not a quote a trader may send. */
  belowPolicy: boolean;
  label: string;
}

/**
 * An order size where asking for more costs the client less.
 *
 * A hard bracket steps the margin down, so near the top of a band the total
 * for one more bag can fall below the total for one fewer. Both totals are
 * real; the smaller order is simply the worse deal, and the desk should say so
 * rather than let the client find it.
 */
export interface RoundUpAdvice {
  /** The first bag count of the next bracket. */
  toBags: number;
  savingUsd: number;
  /** The price the client would pay there, in their own currency and unit. */
  displayPrice: number;
}

/** One rung of the "what if the C moves" table. */
export interface SensitivityRow {
  /** KC move from the quoted level, in US cents per pound. */
  moveCents: number;
  kcCents: number;
  /** The quoted price at that KC, in the client's currency and unit. */
  displayPrice: number;
  /** Change from the quoted price, same currency and unit. */
  deltaDisplay: number;
  totalValueUsd: number;
}

/** A stored figure that may have gone out of date. */
export interface StaleFigure {
  label: string;
  /** Where it is edited, so the warning says what to do about it. */
  where: string;
  ageDays: number;
  /** True once the age is past the desk's tolerance. */
  stale: boolean;
  updatedAt: string | null;
}

export interface ReferenceData {
  costLines: CostLine[];
  packaging: PackagingType[];
  processes: ProcessType[];
  destinations: Destination[];
  fx: FxTable;
  settings: EngineSettings;
}

export interface QuoteInput {
  destinationKey: string;
  incoterm: Incoterm;
  processKey: string;
  packagingKey: string;
  /** Quantity in bags. Pounds follow from the packaging type. */
  bags: number;
  /** KC price in USD/lb. KC quotes in US cents — convert first. */
  kcUsdPerLb: number;
  /** Quality differential over KC, USD/lb. */
  premiumUsdPerLb: number;
  /** Months the contract is held, 1-12. Capped by the shipment window. */
  holdMonths: number;
  /** First and last shipment month, `YYYY-MM`. */
  fromMonth: string;
  toMonth: string;
  /** Admin override: quote without recovering the fixed cost. */
  waiveFixedCost: boolean;
}

export interface CostLineResult {
  key: string;
  label: string;
  group: CostGroup;
  currency: CurrencyCode;
  /** Raw amount in its native currency, before conversion. */
  nativeAmount: number;
  /** Native currency per pound. Null for `rate` lines. */
  nativePerLb: number | null;
  usdPerLb: number;
  isMargin: boolean;
  included: boolean;
  /** Why the line was left out, for the breakdown. */
  excludedReason?: string;
  /** Every operand that produced `usdPerLb`, so the figure can be checked. */
  trace: CostLineTrace;
}

/**
 * The working behind one cost line.
 *
 * A breakdown that shows only the answer cannot be audited — a wrong divisor
 * and a wrong rate look identical once they are multiplied together. These are
 * the operands, kept so the admin view can lay the arithmetic out in full.
 */
export interface CostLineTrace {
  basis: CostLine['basis'];
  /** Which table the amount was read from. */
  source: 'Fixed' | 'Packaging' | 'Process' | 'Destination';
  /** Pounds the native amount covers. Zero for per-lb and rate lines. */
  lbsPerUnit: number;
  /** Native currency per pound, before any month multiplier. */
  nativePerLbPerMonth: number;
  /** 1 unless the line is billed for each month the contract is held. */
  monthsApplied: number;
  /** USD per unit of this line's currency. 1 for USD. */
  fxUsdPerUnit: number;
  /** Rate lines only: the monthly rate and the cargo value it was charged on. */
  rate?: { monthlyRate: number; months: number; chargedOnUsdPerLb: number };
}

/** One line of the cost-to-price derivation. */
export interface PriceStep {
  label: string;
  /** The arithmetic that produced `value`, operands already substituted. */
  detail: string;
  value: number;
  kind: 'usdPerLb' | 'quotePrice' | 'ratio' | 'usdTotal';
}

/**
 * An independent re-addition of the breakdown.
 *
 * The engine accumulates the total as it walks the lines; this adds the
 * published lines back up separately and compares. A mismatch means a cost was
 * counted into the total without appearing in the table, or the reverse.
 */
export interface Reconciliation {
  greenCoffeeUsdPerLb: number;
  /** Every included line, finance included, added back up. */
  includedLinesUsdPerLb: number;
  /** Green coffee plus those lines. */
  rebuiltTotalUsdPerLb: number;
  /** What the engine reported. */
  reportedTotalUsdPerLb: number;
  differenceUsdPerLb: number;
  matches: boolean;
}

export interface MarginRung {
  margin: number;
  /** USD/lb implied by the rounded client-facing price. */
  priceUsdPerLb: number;
  /** The quoted price, in the client's unit and currency, rounded up. */
  displayPrice: number;
  marginUsdPerLb: number;
  totalValueUsd: number;
}

export interface QuoteWarning {
  text: string;
  /** A cost-table problem a trader can neither see nor fix. */
  adminOnly: boolean;
}

export interface QuoteResult {
  lines: CostLineResult[];
  /** Every included cost line except finance, USD/lb. */
  differentialUsdPerLb: number;
  /** KC + quality premium + coffee type premium, USD/lb. */
  greenCoffeeUsdPerLb: number;
  /** What the coffee type adds over a plain washed lot, USD/lb. */
  typePremiumUsdPerLb: number;
  typeLabel: string;
  financeUsdPerLb: number;
  storageUsdPerLb: number;
  /** Green coffee + differential + finance. The break-even. */
  totalCostUsdPerLb: number;
  marginBaseUsdPerLb: number;
  totalLbs: number;
  bags: number;
  containers: number;
  /** Months of storage and finance actually billed. */
  billableMonths: number;
  waivedFixedCost: boolean;
  /** Share of the differential that is peso-denominated, i.e. TRM-exposed. */
  copExposureUsdPerLb: number;
  /** The volume bracket this order fell into, and the floor it sets. */
  band: VolumeBand;
  quoteCurrency: CurrencyCode;
  quoteUnit: QuoteUnit;
  floor: MarginRung;
  ladder: MarginRung[];
  warnings: QuoteWarning[];
}

/** One shipment inside a multi-shipment contract. */
export interface Shipment {
  id: string;
  label: string;
  /** KC for this shipment's month, in US cents/lb. */
  kcCents: number;
  bags: number;
  /**
   * A price set by hand for this shipment, in the client's currency and unit.
   *
   * Null means the contract margin decides it. A month is sometimes agreed on
   * its own — a price already given, a lot already committed — and the
   * question that follows is what it does to the blend.
   */
  priceOverride?: number | null;
}

export interface ShipmentResult extends Shipment {
  result: QuoteResult;
  priceUsdPerLb: number;
  displayPrice: number;
  valueUsd: number;
  /** Whether the price came from the contract margin or was set by hand. */
  pricedBy: 'margin' | 'set';
  /** What this shipment's price actually earns, once it is fixed. */
  marginAchieved: number;
}

export interface ContractResult {
  shipments: ShipmentResult[];
  margin: number;
  totalLbs: number;
  totalBags: number;
  /** Volume-weighted averages across the shipments. */
  weightedCostUsdPerLb: number;
  weightedMarginBaseUsdPerLb: number;
  weightedKcUsdPerLb: number;
  /** The single blended price quoted for the whole contract. */
  consolidatedUsdPerLb: number;
  consolidatedDisplay: number;
  /** The margin the blend actually earns, after any price set by hand. */
  blendedMargin: number;
  /** How many shipments carry a price of their own. */
  setPriceCount: number;
  /** Sum of the shipment lines — what a client gets by adding the quote up. */
  totalValueUsd: number;
  quoteCurrency: CurrencyCode;
  quoteUnit: QuoteUnit;
  warnings: QuoteWarning[];
}
