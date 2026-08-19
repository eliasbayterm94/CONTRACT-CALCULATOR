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

export interface Premium {
  monthKey: string;
  qualityKey: string;
  premiumCents: number;
  updatedAt: string;
  updatedBy: string | null;
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
  premiums: Premium[];
  kcSpot: KcSpot | null;
  audit: AuditEntry[];
}

export const STATE_VERSION = 1;

/** The audit trail is a rolling window, not an archive. */
export const AUDIT_LIMIT = 200;

export interface StoreDriver {
  readonly name: string;
  load(): Promise<AppState | null>;
  save(state: AppState): Promise<void>;
}
