import { createDriver } from './drivers';
import {
  AUDIT_LIMIT,
  STATE_VERSION,
  type AppState,
  type AuditEntry,
  type FxRow,
  type KcPrice,
  type KcSpot,
  type PremiumOverride,
  type SeasonalPremium,
  type StoreDriver,
} from './types';
import {
  SEED_COST_LINES,
  SEED_DESTINATIONS,
  SEED_FX,
  SEED_PACKAGING,
  SEED_PROCESSES,
  SEED_SETTINGS,
} from '../pricing/reference';
import { upcomingContractMonths } from '../kc';
import type { CurrencyCode, EngineSettings, ReferenceData } from '../pricing/types';

export type {
  FxRow,
  KcPrice,
  KcSpot,
  PremiumOverride,
  PremiumResolution,
  SeasonalPremium,
  AuditEntry,
} from './types';

let driver: Promise<StoreDriver> | null = null;
let cached: AppState | null = null;
let inFlight: Promise<AppState> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getDriver(): Promise<StoreDriver> {
  driver ??= createDriver();
  return driver;
}

function seedState(now = new Date()): AppState {
  const stamp = now.toISOString();
  const months = upcomingContractMonths(now, 8);
  return {
    version: STATE_VERSION,
    settings: { ...SEED_SETTINGS },
    costLines: SEED_COST_LINES.map((l) => ({ ...l })),
    packaging: SEED_PACKAGING.map((p) => ({ ...p })),
    processes: SEED_PROCESSES.map((p) => ({ ...p })),
    destinations: SEED_DESTINATIONS.map((d) => ({ ...d })),
    fx: (Object.entries(SEED_FX) as Array<[CurrencyCode, number]>).map(([currency, usdPerUnit]) => ({
      currency,
      usdPerUnit,
      source: 'seed',
      isOverride: false,
      fetchedAt: stamp,
    })),
    kcPrices: months.map((m) => ({ monthKey: m.key, priceCents: 0, updatedAt: stamp, updatedBy: 'seed' })),
    seasonalPremiums: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      premiumCents: 0,
      updatedAt: stamp,
      updatedBy: 'seed',
    })),
    premiumOverrides: [],
    kcSpot: null,
    audit: [],
  };
}

/**
 * The current state, seeded on first use.
 *
 * Cached for the life of the process. A serverless instance handles one request
 * at a time and is short-lived, so the cache is a per-invocation read rather
 * than a shared one that could go stale behind another writer.
 */
export async function loadState(): Promise<AppState> {
  if (cached) return cached;
  // A page renders many accessors at once. Without this they would each miss
  // the cache, each seed, and each write a different fresh document.
  inFlight ??= readState().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function readState(): Promise<AppState> {
  const stored = await (await getDriver()).load();
  if (stored) {
    const migrated = migrate(stored);
    if (migrated) {
      // Only write when the shape actually moved, so a normal read stays a read.
      if (migrated !== stored) await (await getDriver()).save(migrated);
      cached = migrated;
      return cached;
    }
  }
  const fresh = seedState();
  await (await getDriver()).save(fresh);
  cached = fresh;
  return fresh;
}

/**
 * Bring a stored document up to the current shape, or give up on it.
 *
 * Re-seeding on a version bump would throw away the desk's costed lines and
 * rates along with the shape change. Every migration here has to carry the
 * configuration across, or say plainly that it cannot.
 */
export function migrate(stored: AppState): AppState | null {
  if (stored.version === STATE_VERSION) return stored;

  if (stored.version === 1) {
    const stamp = new Date().toISOString();
    // Version 1 kept premiums against KC contract months, which is the wrong
    // axis for a harvest differential — it left a shipment month like August
    // with no row at all. Those figures cannot be mapped onto calendar months
    // without inventing them, so the seasonal table starts empty and the desk
    // sets it once. Everything else carries across untouched.
    const { premiums: _dropped, ...rest } = stored as AppState & { premiums?: unknown };
    return {
      ...rest,
      version: 2,
      seasonalPremiums: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        premiumCents: 0,
        updatedAt: stamp,
        updatedBy: 'seed',
      })),
      premiumOverrides: [],
    };
  }

  return null;
}

/** Read, change, write. The document is small enough to rewrite whole. */
export async function mutateState<T>(change: (state: AppState) => T): Promise<T> {
  // Serialised: two overlapping writes would otherwise each re-read, change
  // their own copy, and the later save would drop the earlier one's rows.
  const run = queue.then(async () => {
    // Always re-read before writing: another instance may have saved since
    // this one loaded, and the cache would otherwise write stale rows back.
    cached = null;
    const state = await loadState();
    const result = change(state);
    await (await getDriver()).save(state);
    cached = state;
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

/** Drop the cache so the next read comes from the driver. */
export function forgetState(): void {
  cached = null;
}

export async function storeName(): Promise<string> {
  return (await getDriver()).name;
}

/* ------------------------------------------------------------- settings -- */

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const state = await loadState();
  const value = state.settings[key];
  return value === undefined ? fallback : (value as T);
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await mutateState((state) => {
    state.settings[key] = value;
  });
}

export async function getEngineSettings(): Promise<EngineSettings> {
  const state = await loadState();
  return { ...SEED_SETTINGS, ...(state.settings as Partial<EngineSettings>) };
}

/* ------------------------------------------------------ reference tables -- */

export async function getCostLines(includeInactive = false) {
  const state = await loadState();
  return [...state.costLines]
    .filter((l) => includeInactive || l.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function getPackaging(includeInactive = false) {
  const state = await loadState();
  return [...state.packaging]
    .filter((p) => includeInactive || p.active)
    .sort((a, b) => b.kgPerUnit - a.kgPerUnit);
}

export async function getProcesses(includeInactive = false) {
  const state = await loadState();
  return [...state.processes]
    .filter((p) => includeInactive || p.active)
    .sort((a, b) => a.amount - b.amount);
}

export async function getDestinations(includeInactive = false) {
  const state = await loadState();
  return state.destinations.filter((d) => includeInactive || d.active);
}

export async function getFxRows(): Promise<FxRow[]> {
  const state = await loadState();
  return [...state.fx].sort((a, b) => a.currency.localeCompare(b.currency));
}

export async function getFxTable() {
  const rows = await getFxRows();
  const table = {} as Record<CurrencyCode, number>;
  for (const row of rows) table[row.currency] = row.usdPerUnit;
  table.USD = 1;
  return table;
}

export async function getReferenceData(): Promise<ReferenceData> {
  const [costLines, packaging, processes, destinations, fx, settings] = await Promise.all([
    getCostLines(),
    getPackaging(),
    getProcesses(),
    getDestinations(),
    getFxTable(),
    getEngineSettings(),
  ]);
  return { costLines, packaging, processes, destinations, fx, settings };
}

/* ------------------------------------------------------------ KC + premiums */

export async function getKcPrices(): Promise<KcPrice[]> {
  return (await loadState()).kcPrices;
}

export async function setKcPrice(monthKey: string, priceCents: number, actor: string): Promise<void> {
  await mutateState((state) => {
    const existing = state.kcPrices.find((k) => k.monthKey === monthKey);
    const stamp = new Date().toISOString();
    if (existing) Object.assign(existing, { priceCents, updatedAt: stamp, updatedBy: actor });
    else state.kcPrices.push({ monthKey, priceCents, updatedAt: stamp, updatedBy: actor });
  });
}

/* The pure half of the setters below: apply to a state the caller already
   holds, so many rows cost one write rather than one write each. */

export function applyKcPrice(state: AppState, monthKey: string, priceCents: number, actor: string): void {
  const stamp = new Date().toISOString();
  const row = state.kcPrices.find((k) => k.monthKey === monthKey);
  if (row) Object.assign(row, { priceCents, updatedAt: stamp, updatedBy: actor });
  else state.kcPrices.push({ monthKey, priceCents, updatedAt: stamp, updatedBy: actor });
}

export function applySeasonalPremium(state: AppState, month: number, premiumCents: number, actor: string): void {
  const stamp = new Date().toISOString();
  const row = state.seasonalPremiums.find((p) => p.month === month);
  if (row) Object.assign(row, { premiumCents, updatedAt: stamp, updatedBy: actor });
  else state.seasonalPremiums.push({ month, premiumCents, updatedAt: stamp, updatedBy: actor });
}

export function applyPremiumOverride(
  state: AppState,
  monthKey: string,
  premiumCents: number,
  note: string,
  actor: string,
): void {
  const stamp = new Date().toISOString();
  const row = state.premiumOverrides.find((p) => p.monthKey === monthKey);
  if (row) Object.assign(row, { premiumCents, note, updatedAt: stamp, updatedBy: actor });
  else state.premiumOverrides.push({ monthKey, premiumCents, note, updatedAt: stamp, updatedBy: actor });
}

export function applyClearPremiumOverride(state: AppState, monthKey: string): void {
  state.premiumOverrides = state.premiumOverrides.filter((p) => p.monthKey !== monthKey);
}

export function applyFxOverride(
  state: AppState,
  currency: CurrencyCode,
  usdPerUnit: number,
  source: string,
): void {
  const fetchedAt = new Date().toISOString();
  const row = state.fx.find((r) => r.currency === currency);
  if (row) Object.assign(row, { usdPerUnit, source, isOverride: true, fetchedAt });
  else state.fx.push({ currency, usdPerUnit, source, isOverride: true, fetchedAt });
}

export function applyClearFxOverride(state: AppState, currency: CurrencyCode): void {
  const row = state.fx.find((r) => r.currency === currency);
  if (row) row.isOverride = false;
}

export async function getSeasonalPremiums(): Promise<SeasonalPremium[]> {
  const state = await loadState();
  return [...state.seasonalPremiums].sort((a, b) => a.month - b.month);
}

export async function getPremiumOverrides(): Promise<PremiumOverride[]> {
  const state = await loadState();
  return [...state.premiumOverrides].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

export async function setSeasonalPremium(
  month: number,
  premiumCents: number,
  actor: string,
): Promise<void> {
  await mutateState((state) => {
    const stamp = new Date().toISOString();
    const existing = state.seasonalPremiums.find((p) => p.month === month);
    if (existing) Object.assign(existing, { premiumCents, updatedAt: stamp, updatedBy: actor });
    else state.seasonalPremiums.push({ month, premiumCents, updatedAt: stamp, updatedBy: actor });
  });
}

export async function setPremiumOverride(
  monthKey: string,
  premiumCents: number,
  note: string,
  actor: string,
): Promise<void> {
  await mutateState((state) => {
    const stamp = new Date().toISOString();
    const existing = state.premiumOverrides.find((p) => p.monthKey === monthKey);
    if (existing) Object.assign(existing, { premiumCents, note, updatedAt: stamp, updatedBy: actor });
    else state.premiumOverrides.push({ monthKey, premiumCents, note, updatedAt: stamp, updatedBy: actor });
  });
}

export async function clearPremiumOverride(monthKey: string): Promise<void> {
  await mutateState((state) => {
    state.premiumOverrides = state.premiumOverrides.filter((p) => p.monthKey !== monthKey);
  });
}

export async function getKcSpot(): Promise<KcSpot | null> {
  return (await loadState()).kcSpot;
}

export async function setKcSpot(priceCents: number, asOf: string, source: string): Promise<void> {
  await mutateState((state) => {
    state.kcSpot = { priceCents, asOf, source, fetchedAt: new Date().toISOString() };
  });
}

/* ---------------------------------------------------------------- audit -- */

/**
 * Add an audit entry to a state already being mutated.
 *
 * The write-through version below is a whole document read and write of its
 * own. Beside a save that is doing the same thing, that is two round trips to
 * a store that lives over the network, and two chances to fail. Bulk saves
 * fold their entry in here instead.
 */
export function appendAudit(
  state: AppState,
  actor: string,
  entity: string,
  entityId: string | null,
  action: string,
  detail?: unknown,
): void {
  const id = (state.audit[0]?.id ?? 0) + 1;
  state.audit.unshift({
    id,
    at: new Date().toISOString(),
    actor,
    entity,
    entityId,
    action,
    detail: detail === undefined ? null : JSON.stringify(detail),
  });
  if (state.audit.length > AUDIT_LIMIT) state.audit.length = AUDIT_LIMIT;
}

export async function logAudit(
  actor: string,
  entity: string,
  entityId: string | null,
  action: string,
  detail?: unknown,
): Promise<void> {
  await mutateState((state) => {
    const id = (state.audit[0]?.id ?? 0) + 1;
    state.audit.unshift({
      id,
      at: new Date().toISOString(),
      actor,
      entity,
      entityId,
      action,
      detail: detail === undefined ? null : JSON.stringify(detail),
    });
    state.audit.length = Math.min(state.audit.length, AUDIT_LIMIT);
  });
}

export async function getAuditLog(limit = 25): Promise<AuditEntry[]> {
  return (await loadState()).audit.slice(0, limit);
}
