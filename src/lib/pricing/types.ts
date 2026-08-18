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

export interface ProcessType {
  key: string;
  label: string;
  amount: number;
  lbsPerUnit: number;
  currency: CurrencyCode;
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
  /** KC + quality premium, USD/lb. */
  greenCoffeeUsdPerLb: number;
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
}

export interface ShipmentResult extends Shipment {
  result: QuoteResult;
  priceUsdPerLb: number;
  displayPrice: number;
  valueUsd: number;
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
  /** Sum of the shipment lines — what a client gets by adding the quote up. */
  totalValueUsd: number;
  quoteCurrency: CurrencyCode;
  quoteUnit: QuoteUnit;
  warnings: QuoteWarning[];
}
