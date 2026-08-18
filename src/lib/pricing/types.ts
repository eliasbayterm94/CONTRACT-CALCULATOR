/**
 * Domain types for the Forest Coffee contract quote engine.
 *
 * Everything in the engine normalises to USD per pound (USD/lb), which is the
 * unit the Coffee "C" (KC) futures contract trades in. Display conversion to
 * other units/currencies happens at the very edge, in `units.ts`.
 */

export type CurrencyCode = 'USD' | 'COP' | 'EUR' | 'AUD' | 'GBP' | 'CAD';

export const CURRENCIES: CurrencyCode[] = ['USD', 'COP', 'EUR', 'AUD', 'GBP', 'CAD'];

/** Incoterm ladder. Each tier is a superset of the one before it. */
export type Incoterm = 'FOB' | 'CIF' | 'DDP';

export const INCOTERMS: Incoterm[] = ['FOB', 'CIF', 'DDP'];

/**
 * Which incoterm tier a cost line first appears at.
 *  - `fob`     : always included
 *  - `freight` : included from CIF up (ocean freight)
 *  - `import`  : included from DDP up (import clearance, unloading)
 *  - `optional`: only when the trader switches it on (storage, finance)
 */
export type CostGroup = 'fob' | 'freight' | 'import' | 'optional';

/**
 * How a cost line's raw amount converts to a per-pound figure.
 *  - `per_lb`  : amount is already per pound
 *  - `per_unit`: amount covers `lbsPerUnit` pounds (a bag, a container, a truck)
 *  - `rate`    : amount is a monthly rate applied to a value base (finance)
 */
export type CostBasis = 'per_lb' | 'per_unit' | 'rate';

/**
 * What a cost line's amount is keyed on. Lines that vary by a quote selection
 * look their amount up from a table instead of carrying a single fixed value.
 */
export type CostDriver =
  | 'fixed'        // one amount, always
  | 'packaging'    // varies by packaging type (70 / 35 / 24 kg)
  | 'process'      // varies by milling type (washed / honey / natural)
  | 'destination'; // varies by destination (seafreight, import, unloading, storage)

export interface CostLine {
  /** Stable machine key, e.g. `milling`. */
  key: string;
  /** Human label shown on the quote breakdown. */
  label: string;
  group: CostGroup;
  basis: CostBasis;
  driver: CostDriver;
  currency: CurrencyCode;
  /** Amount when `driver === 'fixed'`. Ignored otherwise. */
  amount: number;
  /** Pounds covered by one `amount` when `basis === 'per_unit'`. */
  lbsPerUnit: number;
  /** Multiplied by the number of months the line is carried (storage, finance). */
  perMonth: boolean;
  /** Trader can switch this line off on an individual quote. */
  optional: boolean;
  /** Off unless explicitly enabled (storage, finance). */
  defaultOn: boolean;
  /**
   * When true this line is treated as margin rather than cost: it is excluded
   * from the cost base the margin percentage is calculated against, so the
   * quote does not earn margin on its own margin.
   */
  isMargin: boolean;
  sortOrder: number;
  active: boolean;
}

/** A packaging option: bag size, its cost, and the pounds it holds. */
export interface PackagingType {
  key: string;
  label: string;
  kgPerUnit: number;
  lbsPerUnit: number;
  /** Cost of one unit of packaging. */
  amount: number;
  currency: CurrencyCode;
  active: boolean;
}

/** A milling / process option and what milling that process costs. */
export interface ProcessType {
  key: string;
  label: string;
  amount: number;
  /** Pounds covered by one `amount` of milling cost. */
  lbsPerUnit: number;
  currency: CurrencyCode;
  active: boolean;
}

export interface Destination {
  key: string;
  label: string;
  /** Currency this destination's clients are quoted in. */
  quoteCurrency: CurrencyCode;
  /** `lb` for US destinations, `kg` for everyone else. */
  quoteUnit: QuoteUnit;
  /** Ocean freight for one container. */
  seafreightAmount: number;
  seafreightCurrency: CurrencyCode;
  seafreightLbsPerUnit: number;
  /** Import clearance for one container. */
  importAmount: number;
  importCurrency: CurrencyCode;
  importLbsPerUnit: number;
  /** Unloading, DDP only. */
  unloadingAmount: number;
  unloadingCurrency: CurrencyCode;
  unloadingLbsPerUnit: number;
  /** Warehouse storage, charged per packaging unit per month. */
  storageAmount: number;
  storageCurrency: CurrencyCode;
  /** Incoterms that are legal for this destination. */
  allowedIncoterms: Incoterm[];
  active: boolean;
}

export type QuoteUnit = 'lb' | 'kg' | 'mt';

/** How the margin percentage is interpreted. */
export type MarginMode =
  /** margin is a share of the final selling price: price = cost / (1 - m) */
  | 'on_price'
  /** margin is a markup on cost: price = cost * (1 + m) */
  | 'on_cost';

/** What the margin percentage is charged against. */
export type MarginBase =
  /** green coffee + every cost line (default) */
  | 'full_landed_cost'
  /** the logistics/processing differential only, not the coffee itself */
  | 'differential_only';

/** FX expressed as US dollars per one unit of the currency. */
export type FxTable = Record<CurrencyCode, number>;

export interface EngineSettings {
  marginMode: MarginMode;
  marginBase: MarginBase;
  /** Floor margin the engine always prices at, as a fraction (0.16 = 16%). */
  minMargin: number;
  /** Inclusive bounds and step of the displayed margin ladder, as fractions. */
  ladderFrom: number;
  ladderTo: number;
  ladderStep: number;
  /** Monthly finance rate as a fraction (0.0072 = 0.72% per month). */
  financeMonthlyRate: number;
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
  /** Number of containers, or a direct pound figure — see `quantityMode`. */
  quantity: number;
  quantityMode: 'containers' | 'bags' | 'lbs';
  /** Pounds in one container. Configurable; 38,580.5 lb = 17.5 MT. */
  lbsPerContainer: number;
  /** KC contract month key, e.g. `2026H`. Informational for the engine. */
  kcMonth: string;
  /** KC price in USD/lb for that month (KC quotes in US cents; convert first). */
  kcPriceUsdPerLb: number;
  /** Quality differential over KC in USD/lb, from the monthly premium table. */
  premiumUsdPerLb: number;
  /** Cost line keys the trader has switched off. */
  disabledLines: string[];
  /** Cost line keys the trader has switched on (for `defaultOn: false` lines). */
  enabledLines: string[];
  storageMonths: number;
  financeMonths: number;
}

export interface CostLineResult {
  key: string;
  label: string;
  group: CostGroup;
  currency: CurrencyCode;
  /** Raw amount in its native currency, before conversion. */
  nativeAmount: number;
  /** Native currency per pound, before FX. Null for `rate` lines. */
  nativePerLb: number | null;
  usdPerLb: number;
  isMargin: boolean;
  included: boolean;
  /** Why the line was excluded, for the breakdown UI. */
  excludedReason?: string;
}

export interface MarginRung {
  margin: number;
  priceUsdPerLb: number;
  marginUsdPerLb: number;
  totalValueUsd: number;
  displayPrice: number;
}

export interface QuoteResult {
  lines: CostLineResult[];
  /** Sum of every included cost line, USD/lb. Excludes finance. */
  differentialUsdPerLb: number;
  /** KC + quality premium, USD/lb. */
  greenCoffeeUsdPerLb: number;
  financeUsdPerLb: number;
  storageUsdPerLb: number;
  /** Green coffee + differential + finance. The break-even. */
  totalCostUsdPerLb: number;
  /** The base the margin percentage is applied to. */
  marginBaseUsdPerLb: number;
  totalLbs: number;
  containers: number;
  bags: number;
  /** Price at the configured floor margin. */
  floor: MarginRung;
  ladder: MarginRung[];
  quoteCurrency: CurrencyCode;
  quoteUnit: QuoteUnit;
  /** Share of the differential that is COP-denominated, i.e. TRM-exposed. */
  copExposureUsdPerLb: number;
  warnings: string[];
}
