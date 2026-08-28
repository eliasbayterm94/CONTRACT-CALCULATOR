import type {
  CostLine,
  CurrencyCode,
  Destination,
  PackagingType,
  ProcessType,
} from '../pricing/types';

export interface FxRow {
  currency: CurrencyCode;
  usdPerUnit: number;
  source: string;
  isOverride: boolean;
  fetchedAt: string;
}

export interface KcPrice {
  monthKey: string;
  priceCents: number;
  updatedAt: string;
  updatedBy: string | null;
}

/**
 * The quality differential over KC, for one month of the calendar year.
 *
 * It tracks the harvest, not the futures board — the coffee arriving in
 * October is a different differential from the coffee arriving in May,
 * whatever KC month either prices against. Set once, applies every year.
 */
export interface SeasonalPremium {
  /** Month of the year, 1 for January through 12 for December. */
  month: number;
  premiumCents: number;
  updatedAt: string;
  updatedBy: string | null;
}

/**
 * One dated month that departs from the seasonal figure.
 *
 * The season is the shape; a short crop or a run on a particular lot is the
 * exception, and it belongs to that year only.
 */
export interface PremiumOverride {
  /** Calendar month, `YYYY-MM`. */
  monthKey: string;
  premiumCents: number;
  note: string;
  updatedAt: string;
  updatedBy: string | null;
}

/** Which figure a month resolved to, and where it came from. */
export interface PremiumResolution {
  monthKey: string;
  premiumCents: number;
  source: 'override' | 'seasonal' | 'unset';
  note: string;
}

export interface KcSpot {
  priceCents: number;
  asOf: string;
  source: string;
  fetchedAt: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  entity: string;
  entityId: string | null;
  action: string;
  detail: string | null;
}

/**
 * Everything the app persists, in one document.
 *
 * It is configuration, not a ledger — sixty-odd rows that one admin edits a few
 * times a week. A single document read and written whole is simpler than a
 * database, and it drops the native SQLite module that a serverless build has
 * to compile.
 */
export interface AppState {
  /** Bumped when the shape changes, so a stale document can be re-seeded. */
  version: number;
  settings: Record<string, unknown>;
  costLines: CostLine[];
  packaging: PackagingType[];
  processes: ProcessType[];
  destinations: Destination[];
  fx: FxRow[];
  kcPrices: KcPrice[];
  seasonalPremiums: SeasonalPremium[];
  premiumOverrides: PremiumOverride[];
  kcSpot: KcSpot | null;
  audit: AuditEntry[];
}

export const STATE_VERSION = 4;

/** The audit trail is a rolling window, not an archive. */
export const AUDIT_LIMIT = 200;

export interface StoreDriver {
  readonly name: string;
  load(): Promise<AppState | null>;
  save(state: AppState): Promise<void>;
}
