/**
 * Seed the database from the Forest Spot Contracts process sheet.
 *
 * Safe to re-run: reference rows are upserted, and KC prices, premiums and any
 * FX overrides already entered by a trader are left alone.
 */
import { getDb, getFxRows, getKcPrices, setSetting } from './index';
import {
  SEED_COST_LINES,
  SEED_DESTINATIONS,
  SEED_FX,
  SEED_PACKAGING,
  SEED_PROCESSES,
  SEED_SETTINGS,
} from '../pricing/reference';
import { upcomingContractMonths } from '../kc';
import { DEFAULT_LBS_PER_CONTAINER } from '../pricing/units';
import type { CurrencyCode } from '../pricing/types';

export function seed(now = new Date()): void {
  const db = getDb();

  const costLine = db.prepare(`
    INSERT INTO cost_lines
      (key, label, cost_group, basis, driver, currency, amount, lbs_per_unit,
       per_month, optional, default_on, is_margin, sort_order, active)
    VALUES (@key, @label, @group, @basis, @driver, @currency, @amount, @lbsPerUnit,
            @perMonth, @optional, @defaultOn, @isMargin, @sortOrder, 1)
    ON CONFLICT(key) DO UPDATE SET
      label = excluded.label, cost_group = excluded.cost_group, basis = excluded.basis,
      driver = excluded.driver, sort_order = excluded.sort_order`);

  const packaging = db.prepare(`
    INSERT INTO packaging_types (key, label, kg_per_unit, lbs_per_unit, amount, currency, active)
    VALUES (@key, @label, @kgPerUnit, @lbsPerUnit, @amount, @currency, 1)
    ON CONFLICT(key) DO UPDATE SET label = excluded.label`);

  const process = db.prepare(`
    INSERT INTO process_types (key, label, amount, lbs_per_unit, currency, active)
    VALUES (@key, @label, @amount, @lbsPerUnit, @currency, 1)
    ON CONFLICT(key) DO UPDATE SET label = excluded.label`);

  const destination = db.prepare(`
    INSERT INTO destinations
      (key, label, quote_currency, quote_unit,
       seafreight_amount, seafreight_currency, seafreight_lbs_per_unit,
       import_amount, import_currency, import_lbs_per_unit,
       unloading_amount, unloading_currency, unloading_lbs_per_unit,
       storage_amount, storage_currency, allowed_incoterms, sort_order, active)
    VALUES (@key, @label, @quoteCurrency, @quoteUnit,
            @seafreightAmount, @seafreightCurrency, @seafreightLbs,
            @importAmount, @importCurrency, @importLbs,
            @unloadingAmount, @unloadingCurrency, @unloadingLbs,
            @storageAmount, @storageCurrency, @allowedIncoterms, @sortOrder, 1)
    ON CONFLICT(key) DO UPDATE SET label = excluded.label, sort_order = excluded.sort_order`);

  const fx = db.prepare(`
    INSERT INTO fx_rates (currency, usd_per_unit, source, is_override)
    VALUES (?, ?, 'seed', 0)
    ON CONFLICT(currency) DO NOTHING`);

  const kc = db.prepare(
    `INSERT INTO kc_prices (month_key, price_cents, updated_by) VALUES (?, 0, 'seed')
     ON CONFLICT(month_key) DO NOTHING`,
  );
  const premium = db.prepare(
    `INSERT INTO premiums (month_key, quality_key, premium_cents, updated_by)
     VALUES (?, 'standard', 0, 'seed')
     ON CONFLICT(month_key, quality_key) DO NOTHING`,
  );

  db.transaction(() => {
    for (const line of SEED_COST_LINES) {
      costLine.run({
        ...line,
        perMonth: line.perMonth ? 1 : 0,
        optional: line.optional ? 1 : 0,
        defaultOn: line.defaultOn ? 1 : 0,
        isMargin: line.isMargin ? 1 : 0,
      });
    }
    for (const p of SEED_PACKAGING) packaging.run(p);
    for (const p of SEED_PROCESSES) process.run(p);
    SEED_DESTINATIONS.forEach((d, i) =>
      destination.run({
        key: d.key,
        label: d.label,
        quoteCurrency: d.quoteCurrency,
        quoteUnit: d.quoteUnit,
        seafreightAmount: d.seafreightAmount,
        seafreightCurrency: d.seafreightCurrency,
        seafreightLbs: d.seafreightLbsPerUnit,
        importAmount: d.importAmount,
        importCurrency: d.importCurrency,
        importLbs: d.importLbsPerUnit,
        unloadingAmount: d.unloadingAmount,
        unloadingCurrency: d.unloadingCurrency,
        unloadingLbs: d.unloadingLbsPerUnit,
        storageAmount: d.storageAmount,
        storageCurrency: d.storageCurrency,
        allowedIncoterms: d.allowedIncoterms.join(','),
        sortOrder: i * 10,
      }),
    );
    for (const [currency, rate] of Object.entries(SEED_FX)) {
      fx.run(currency as CurrencyCode, rate);
    }
    for (const m of upcomingContractMonths(now, 8)) {
      kc.run(m.key);
      premium.run(m.key);
    }

    for (const [key, value] of Object.entries(SEED_SETTINGS)) setSetting(key, value);
    setSetting('lbsPerContainer', DEFAULT_LBS_PER_CONTAINER);
  })();
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  seed();
  const fxCount = getFxRows().length;
  const kcCount = getKcPrices().length;
  console.log(
    `Seeded: ${SEED_COST_LINES.length} cost lines, ${SEED_DESTINATIONS.length} destinations, ` +
      `${SEED_PACKAGING.length} packaging types, ${SEED_PROCESSES.length} processes, ` +
      `${fxCount} FX rates, ${kcCount} contract months.`,
  );
}

/** Seed on first run so a fresh checkout boots with the sheet already loaded. */
export function ensureSeeded(): void {
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM cost_lines').get() as { c: number };
  if (!row || row.c === 0) seed();
}
