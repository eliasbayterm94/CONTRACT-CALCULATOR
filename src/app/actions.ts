'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';
import {
  COOKIE_MAX_AGE,
  COOKIE_NAME,
  currentAdmin,
  issueToken,
  requireAdmin,
  verifyPassword,
} from '@/lib/auth';
import { getDb, getReferenceData, logAudit, setKcPrice, setPremium, setSetting } from '@/lib/db';
import { clearFxOverride, overrideFxRate, refreshFxRates } from '@/lib/fx';
import { calculateContract, calculateQuote } from '@/lib/pricing/engine';
import type { CurrencyCode, QuoteInput, Shipment } from '@/lib/pricing/types';
import { trmToUsdPerCop } from '@/lib/pricing/units';
import type { ScheduleMonth } from '@/lib/pricing/schedule';

export interface ActionResult {
  ok: boolean;
  message: string;
}

const num = (form: FormData, key: string, fallback = 0): number => {
  const parsed = Number(String(form.get(key) ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};
const str = (form: FormData, key: string): string => String(form.get(key) ?? '').trim();

/* ------------------------------------------------------------------ auth -- */

export async function signIn(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const password = str(form, 'password');
  if (!password) return { ok: false, message: 'Enter the admin password.' };
  if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
    return { ok: false, message: 'ADMIN_PASSWORD and SESSION_SECRET are not configured on the server.' };
  }
  if (!verifyPassword(password)) return { ok: false, message: 'Incorrect password.' };

  const actor = str(form, 'name') || 'admin';
  const store = await cookies();
  store.set(COOKIE_NAME, issueToken(actor), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
  logAudit(actor, 'session', null, 'sign_in');
  revalidatePath('/', 'layout');
  return { ok: true, message: `Signed in as ${actor}.` };
}

export async function signOut(): Promise<void> {
  const actor = (await currentAdmin()) ?? 'unknown';
  const store = await cookies();
  store.delete(COOKIE_NAME);
  logAudit(actor, 'session', null, 'sign_out');
  revalidatePath('/', 'layout');
}

async function guard(): Promise<{ actor: string } | ActionResult> {
  try {
    return { actor: await requireAdmin() };
  } catch {
    return { ok: false, message: 'Sign in to make changes.' };
  }
}

function refreshAll(): void {
  revalidatePath('/');
  revalidatePath('/multi');
  revalidatePath('/admin');
}

/* ------------------------------------------------------- admin mutations -- */

export async function saveKcPrices(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const g = await guard();
  if ('ok' in g) return g;
  let count = 0;
  for (const [key, value] of form.entries()) {
    if (!key.startsWith('kc_')) continue;
    const raw = String(value).trim();
    // An empty box means "leave this month alone", not "the price is zero".
    if (raw === '') continue;
    const cents = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(cents) || cents < 0) continue;
    setKcPrice(key.slice(3), cents, g.actor);
    count += 1;
  }
  logAudit(g.actor, 'kc_prices', null, 'bulk_update', { count });
  refreshAll();
  return { ok: true, message: `Updated ${count} contract month${count === 1 ? '' : 's'}.` };
}

export async function savePremiums(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const g = await guard();
  if ('ok' in g) return g;
  let count = 0;
  for (const [key, value] of form.entries()) {
    if (!key.startsWith('prem_')) continue;
    const raw = String(value).trim();
    if (raw === '') continue;
    const cents = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(cents)) continue;
    setPremium(key.slice(5), 'standard', cents, g.actor);
    count += 1;
  }
  logAudit(g.actor, 'premiums', null, 'bulk_update', { count });
  refreshAll();
  return { ok: true, message: `Updated ${count} monthly premium${count === 1 ? '' : 's'}.` };
}

export async function saveCostLines(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const g = await guard();
  if ('ok' in g) return g;
  const keys = form.getAll('cl_key').map(String);
  const stmt = getDb().prepare(
    `UPDATE cost_lines SET amount = ?, lbs_per_unit = ?, currency = ?, is_margin = ?, active = ?
     WHERE key = ?`,
  );
  getDb().transaction(() => {
    for (const key of keys) {
      stmt.run(
        num(form, `cl_amount_${key}`),
        num(form, `cl_lbs_${key}`),
        str(form, `cl_currency_${key}`) || 'COP',
        form.get(`cl_margin_${key}`) ? 1 : 0,
        form.get(`cl_active_${key}`) ? 1 : 0,
        key,
      );
    }
  })();
  logAudit(g.actor, 'cost_lines', null, 'bulk_update', { keys });
  refreshAll();
  return { ok: true, message: `Saved ${keys.length} cost lines.` };
}

export async function saveDestinations(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const g = await guard();
  if ('ok' in g) return g;
  const keys = form.getAll('d_key').map(String);
  const stmt = getDb().prepare(
    `UPDATE destinations SET
       quote_currency = ?, quote_unit = ?, seafreight_amount = ?, import_amount = ?,
       unloading_amount = ?, storage_amount = ?, storage_currency = ?, active = ?
     WHERE key = ?`,
  );
  getDb().transaction(() => {
    for (const key of keys) {
      stmt.run(
        str(form, `d_cur_${key}`) || 'USD',
        str(form, `d_unit_${key}`) || 'lb',
        num(form, `d_sea_${key}`),
        num(form, `d_imp_${key}`),
        num(form, `d_unl_${key}`),
        num(form, `d_stor_${key}`),
        str(form, `d_storcur_${key}`) || 'USD',
        form.get(`d_active_${key}`) ? 1 : 0,
        key,
      );
    }
  })();
  logAudit(g.actor, 'destinations', null, 'bulk_update', { keys });
  refreshAll();
  return { ok: true, message: `Saved ${keys.length} destinations.` };
}

export async function savePackagingAndProcess(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const g = await guard();
  if ('ok' in g) return g;
  const packKeys = form.getAll('p_key').map(String);
  const procKeys = form.getAll('pr_key').map(String);
  const pack = getDb().prepare(
    'UPDATE packaging_types SET amount = ?, lbs_per_unit = ?, trader_default = ?, active = ? WHERE key = ?',
  );
  const proc = getDb().prepare(
    'UPDATE process_types SET amount = ?, lbs_per_unit = ?, active = ? WHERE key = ?',
  );
  const traderDefault = str(form, 'trader_packaging');
  getDb().transaction(() => {
    for (const key of packKeys) {
      pack.run(
        num(form, `p_amount_${key}`),
        num(form, `p_lbs_${key}`),
        key === traderDefault ? 1 : 0,
        form.get(`p_active_${key}`) ? 1 : 0,
        key,
      );
    }
    for (const key of procKeys) {
      proc.run(
        num(form, `pr_amount_${key}`),
        num(form, `pr_lbs_${key}`),
        form.get(`pr_active_${key}`) ? 1 : 0,
        key,
      );
    }
  })();
  logAudit(g.actor, 'packaging_process', null, 'bulk_update', { packKeys, procKeys });
  refreshAll();
  return {
    ok: true,
    message: `Saved ${packKeys.length} packaging types and ${procKeys.length} processes.`,
  };
}

export async function saveEngineSettings(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const g = await guard();
  if ('ok' in g) return g;

  const minMargin = num(form, 'minMargin') / 100;
  if (minMargin < 0 || minMargin >= 1) {
    return { ok: false, message: 'Floor margin must be between 0% and 100%.' };
  }
  const ladder = str(form, 'ladder')
    .split(/[,\s]+/)
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x) && x > 0 && x < 100)
    .map((x) => x / 100)
    .sort((a, b) => a - b);
  if (ladder.length === 0) {
    return { ok: false, message: 'Give at least one ladder rung, as percentages.' };
  }
  const freeHoldMonths = Math.max(0, Math.round(num(form, 'freeHoldMonths')));

  setSetting('marginMode', str(form, 'marginMode') || 'on_price');
  setSetting('marginBase', str(form, 'marginBase') || 'full_landed_cost');
  setSetting('minMargin', minMargin);
  setSetting('ladder', ladder);
  setSetting('financeMonthlyRate', num(form, 'financeMonthlyRate') / 100);
  setSetting('freeHoldMonths', freeHoldMonths);
  logAudit(g.actor, 'settings', null, 'update', { minMargin, ladder, freeHoldMonths });
  refreshAll();
  return { ok: true, message: 'Pricing settings saved.' };
}

export async function refreshRates(): Promise<ActionResult> {
  const g = await guard();
  if ('ok' in g) return g;
  const result = await refreshFxRates(g.actor);
  refreshAll();
  const parts: string[] = [];
  if (result.updated.length) parts.push(`Updated ${result.updated.map((u) => u.currency).join(', ')}.`);
  if (result.skipped.length) parts.push(`Kept overrides: ${result.skipped.map((s) => s.currency).join(', ')}.`);
  if (result.errors.length) parts.push(`Failed: ${result.errors.join('; ')}`);
  return { ok: result.errors.length === 0, message: parts.join(' ') || 'Nothing to update.' };
}

export async function saveFxOverrides(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const g = await guard();
  if ('ok' in g) return g;
  const currencies = form.getAll('fx_key').map(String) as CurrencyCode[];
  const pinned: string[] = [];
  const released: string[] = [];

  for (const currency of currencies) {
    if (currency === 'USD') continue;
    if (form.get(`fx_clear_${currency}`)) {
      clearFxOverride(currency, g.actor);
      released.push(currency);
      continue;
    }
    if (!form.get(`fx_pin_${currency}`)) continue;
    const typed = num(form, `fx_value_${currency}`);
    if (typed <= 0) return { ok: false, message: `${currency} rate must be greater than zero.` };
    // TRM is typed the way a trader says it — pesos per dollar — and stored inverted.
    overrideFxRate(currency, currency === 'COP' ? trmToUsdPerCop(typed) : typed, g.actor);
    pinned.push(currency);
  }

  refreshAll();
  const parts: string[] = [];
  if (pinned.length) parts.push(`Pinned ${pinned.join(', ')}.`);
  if (released.length) parts.push(`Released ${released.join(', ')}.`);
  return { ok: true, message: parts.join(' ') || 'No FX changes.' };
}

/* ----------------------------------------------------------- save quotes -- */

function newReference(): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `FC-${day}-${randomUUID().slice(0, 4).toUpperCase()}`;
}

export interface SaveQuotePayload {
  input: QuoteInput;
  clientName: string;
  chosenMargin: number | null;
  chosenPriceUsdPerLb: number | null;
  schedule: ScheduleMonth[];
}

export async function saveQuote(
  payload: SaveQuotePayload,
): Promise<ActionResult & { reference?: string }> {
  const ref = getReferenceData();
  // Recompute server-side rather than trusting numbers posted by the browser.
  let result;
  try {
    result = calculateQuote(payload.input, ref);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }

  const actor = (await currentAdmin()) ?? 'trader';
  const reference = newReference();

  getDb()
    .prepare(
      `INSERT INTO quotes
        (reference, client_name, input_json, result_json, snapshot_json, schedule_json,
         from_month, to_month, hold_months, waived_fixed_cost,
         chosen_margin, chosen_price_usd_per_lb, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      reference,
      payload.clientName || null,
      JSON.stringify(payload.input),
      JSON.stringify(result),
      JSON.stringify(ref),
      JSON.stringify(payload.schedule),
      payload.input.fromMonth,
      payload.input.toMonth,
      payload.input.holdMonths,
      result.waivedFixedCost ? 1 : 0,
      payload.chosenMargin,
      payload.chosenPriceUsdPerLb,
      actor,
    );

  logAudit(actor, 'quotes', reference, 'create', {
    destination: payload.input.destinationKey,
    incoterm: payload.input.incoterm,
  });
  revalidatePath('/quotes');
  return { ok: true, message: `Saved as ${reference}.`, reference };
}

export interface SaveContractPayload {
  base: Omit<QuoteInput, 'bags' | 'kcUsdPerLb'>;
  shipments: Shipment[];
  margin: number;
  clientName: string;
}

export async function saveContract(
  payload: SaveContractPayload,
): Promise<ActionResult & { reference?: string }> {
  const g = await guard();
  if ('ok' in g) return g;
  const ref = getReferenceData();
  let contract;
  try {
    contract = calculateContract(payload.shipments, payload.base, payload.margin, ref);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }

  const reference = newReference();
  const representative: QuoteInput = {
    ...payload.base,
    bags: contract.totalBags,
    kcUsdPerLb: contract.weightedKcUsdPerLb,
  };

  getDb()
    .prepare(
      `INSERT INTO quotes
        (reference, client_name, input_json, result_json, snapshot_json, shipments_json,
         from_month, to_month, hold_months, waived_fixed_cost,
         chosen_margin, chosen_price_usd_per_lb, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      reference,
      payload.clientName || null,
      JSON.stringify(representative),
      JSON.stringify(contract),
      JSON.stringify(ref),
      JSON.stringify(payload.shipments),
      payload.base.fromMonth,
      payload.base.toMonth,
      payload.base.holdMonths,
      payload.base.waiveFixedCost ? 1 : 0,
      payload.margin,
      contract.consolidatedUsdPerLb,
      g.actor,
    );

  logAudit(g.actor, 'quotes', reference, 'create_contract', {
    shipments: payload.shipments.length,
    destination: payload.base.destinationKey,
  });
  revalidatePath('/quotes');
  return { ok: true, message: `Saved as ${reference}.`, reference };
}
