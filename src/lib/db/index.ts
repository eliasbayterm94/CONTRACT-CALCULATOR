import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type {
  CostLine,
  CurrencyCode,
  Destination,
  EngineSettings,
  FxTable,
  Incoterm,
  PackagingType,
  ProcessType,
  QuoteUnit,
  ReferenceData,
} from '../pricing/types';
import { SEED_SETTINGS } from '../pricing/reference';

let db: Database.Database | null = null;

/** Where the SQLite file lives. Override with DATABASE_PATH in deployment. */
function databasePath(): string {
  return process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'calculator.db');
}

export function getDb(): Database.Database {
  if (db) return db;
  const file = databasePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(path.join(process.cwd(), 'src/lib/db/schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}

/* ------------------------------------------------------------------ rows -- */

interface CostLineRow {
  key: string;
  label: string;
  cost_group: string;
  basis: string;
  driver: string;
  currency: string;
  amount: number;
  lbs_per_unit: number;
  per_month: number;
  optional: number;
  default_on: number;
  is_margin: number;
  sort_order: number;
  active: number;
}

function toCostLine(r: CostLineRow): CostLine {
  return {
    key: r.key,
    label: r.label,
    group: r.cost_group as CostLine['group'],
    basis: r.basis as CostLine['basis'],
    driver: r.driver as CostLine['driver'],
    currency: r.currency as CurrencyCode,
    amount: r.amount,
    lbsPerUnit: r.lbs_per_unit,
    perMonth: !!r.per_month,
    optional: !!r.optional,
    defaultOn: !!r.default_on,
    isMargin: !!r.is_margin,
    sortOrder: r.sort_order,
    active: !!r.active,
  };
}

interface DestinationRow {
  key: string;
  label: string;
  quote_currency: string;
  quote_unit: string;
  seafreight_amount: number;
  seafreight_currency: string;
  seafreight_lbs_per_unit: number;
  import_amount: number;
  import_currency: string;
  import_lbs_per_unit: number;
  unloading_amount: number;
  unloading_currency: string;
  unloading_lbs_per_unit: number;
  storage_amount: number;
  storage_currency: string;
  allowed_incoterms: string;
  active: number;
}

function toDestination(r: DestinationRow): Destination {
  return {
    key: r.key,
    label: r.label,
    quoteCurrency: r.quote_currency as CurrencyCode,
    quoteUnit: r.quote_unit as QuoteUnit,
    seafreightAmount: r.seafreight_amount,
    seafreightCurrency: r.seafreight_currency as CurrencyCode,
    seafreightLbsPerUnit: r.seafreight_lbs_per_unit,
    importAmount: r.import_amount,
    importCurrency: r.import_currency as CurrencyCode,
    importLbsPerUnit: r.import_lbs_per_unit,
    unloadingAmount: r.unloading_amount,
    unloadingCurrency: r.unloading_currency as CurrencyCode,
    unloadingLbsPerUnit: r.unloading_lbs_per_unit,
    storageAmount: r.storage_amount,
    storageCurrency: r.storage_currency as CurrencyCode,
    allowedIncoterms: r.allowed_incoterms.split(',').filter(Boolean) as Incoterm[],
    active: !!r.active,
  };
}

/* --------------------------------------------------------------- readers -- */

export function getCostLines(includeInactive = false): CostLine[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM cost_lines ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort_order`,
    )
    .all() as CostLineRow[];
  return rows.map(toCostLine);
}

interface PackagingRow {
  key: string;
  label: string;
  kg_per_unit: number;
  lbs_per_unit: number;
  amount: number;
  currency: string;
  active: number;
}

interface ProcessRow {
  key: string;
  label: string;
  amount: number;
  lbs_per_unit: number;
  currency: string;
  active: number;
}

export function getPackaging(includeInactive = false): PackagingType[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM packaging_types ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY kg_per_unit DESC`,
    )
    .all() as PackagingRow[];
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    kgPerUnit: r.kg_per_unit,
    lbsPerUnit: r.lbs_per_unit,
    amount: r.amount,
    currency: r.currency as CurrencyCode,
    active: !!r.active,
  }));
}

export function getProcesses(includeInactive = false): ProcessType[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM process_types ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY amount`,
    )
    .all() as ProcessRow[];
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    amount: r.amount,
    lbsPerUnit: r.lbs_per_unit,
    currency: r.currency as CurrencyCode,
    active: !!r.active,
  }));
}

export function getDestinations(includeInactive = false): Destination[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM destinations ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort_order, label`,
    )
    .all() as DestinationRow[];
  return rows.map(toDestination);
}

export interface FxRow {
  currency: CurrencyCode;
  usdPerUnit: number;
  source: string;
  isOverride: boolean;
  fetchedAt: string;
}

export function getFxRows(): FxRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM fx_rates ORDER BY currency')
    .all() as Array<{
    currency: string;
    usd_per_unit: number;
    source: string;
    is_override: number;
    fetched_at: string;
  }>;
  return rows.map((r) => ({
    currency: r.currency as CurrencyCode,
    usdPerUnit: r.usd_per_unit,
    source: r.source,
    isOverride: !!r.is_override,
    fetchedAt: r.fetched_at,
  }));
}

export function getFxTable(): FxTable {
  const table = {} as FxTable;
  for (const row of getFxRows()) table[row.currency] = row.usdPerUnit;
  table.USD = 1;
  return table;
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value));
}

export function getEngineSettings(): EngineSettings {
  return {
    marginMode: getSetting('marginMode', SEED_SETTINGS.marginMode),
    marginBase: getSetting('marginBase', SEED_SETTINGS.marginBase),
    minMargin: getSetting('minMargin', SEED_SETTINGS.minMargin),
    ladderFrom: getSetting('ladderFrom', SEED_SETTINGS.ladderFrom),
    ladderTo: getSetting('ladderTo', SEED_SETTINGS.ladderTo),
    ladderStep: getSetting('ladderStep', SEED_SETTINGS.ladderStep),
    financeMonthlyRate: getSetting('financeMonthlyRate', SEED_SETTINGS.financeMonthlyRate),
  };
}

export function getReferenceData(): ReferenceData {
  return {
    costLines: getCostLines(),
    packaging: getPackaging(),
    processes: getProcesses(),
    destinations: getDestinations(),
    fx: getFxTable(),
    settings: getEngineSettings(),
  };
}

export interface KcPrice {
  monthKey: string;
  priceCents: number;
  updatedAt: string;
  updatedBy: string | null;
}

export function getKcPrices(): KcPrice[] {
  const rows = getDb().prepare('SELECT * FROM kc_prices ORDER BY month_key').all() as Array<{
    month_key: string;
    price_cents: number;
    updated_at: string;
    updated_by: string | null;
  }>;
  return rows.map((r) => ({
    monthKey: r.month_key,
    priceCents: r.price_cents,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  }));
}

export function setKcPrice(monthKey: string, priceCents: number, actor: string): void {
  getDb()
    .prepare(
      `INSERT INTO kc_prices (month_key, price_cents, updated_at, updated_by)
       VALUES (?, ?, datetime('now'), ?)
       ON CONFLICT(month_key) DO UPDATE SET
         price_cents = excluded.price_cents,
         updated_at  = excluded.updated_at,
         updated_by  = excluded.updated_by`,
    )
    .run(monthKey, priceCents, actor);
}

export interface Premium {
  monthKey: string;
  qualityKey: string;
  premiumCents: number;
  updatedAt: string;
  updatedBy: string | null;
}

export function getPremiums(): Premium[] {
  const rows = getDb()
    .prepare('SELECT * FROM premiums ORDER BY month_key, quality_key')
    .all() as Array<{
    month_key: string;
    quality_key: string;
    premium_cents: number;
    updated_at: string;
    updated_by: string | null;
  }>;
  return rows.map((r) => ({
    monthKey: r.month_key,
    qualityKey: r.quality_key,
    premiumCents: r.premium_cents,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  }));
}

export function setPremium(
  monthKey: string,
  qualityKey: string,
  premiumCents: number,
  actor: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO premiums (month_key, quality_key, premium_cents, updated_at, updated_by)
       VALUES (?, ?, ?, datetime('now'), ?)
       ON CONFLICT(month_key, quality_key) DO UPDATE SET
         premium_cents = excluded.premium_cents,
         updated_at    = excluded.updated_at,
         updated_by    = excluded.updated_by`,
    )
    .run(monthKey, qualityKey, premiumCents, actor);
}

export function logAudit(
  actor: string,
  entity: string,
  entityId: string | null,
  action: string,
  detail?: unknown,
): void {
  getDb()
    .prepare('INSERT INTO audit_log (actor, entity, entity_id, action, detail) VALUES (?, ?, ?, ?, ?)')
    .run(actor, entity, entityId, action, detail === undefined ? null : JSON.stringify(detail));
}

export interface AuditRow {
  id: number;
  at: string;
  actor: string;
  entity: string;
  entityId: string | null;
  action: string;
  detail: string | null;
}

export function getAuditLog(limit = 100): AuditRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?')
    .all(limit) as Array<Omit<AuditRow, 'entityId'> & { entity_id: string | null }>;
  return rows.map((r) => ({ ...r, entityId: r.entity_id }));
}
