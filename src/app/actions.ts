'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { DESK_ACTOR, VIEW_COOKIE, VIEW_MAX_AGE } from '@/lib/auth';
import {
  appendAudit,
  applyClearFxOverride,
  applyClearPremiumOverride,
  applyFxOverride,
  applyKcPrice,
  applyPremiumOverride,
  applySeasonalPremium,
  logAudit,
  mutateState,
  setSetting,
} from '@/lib/store';
import { refreshFxRates } from '@/lib/fx';
import { guarded } from '@/lib/actionGuard';
import type { CurrencyCode, QuoteUnit } from '@/lib/pricing/types';
import { trmToUsdPerCop } from '@/lib/pricing/units';

export interface ActionResult {
  ok: boolean;
  message: string;
}

const num = (form: FormData, key: string, fallback = 0): number => {
  const parsed = Number(String(form.get(key) ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};
const str = (form: FormData, key: string): string => String(form.get(key) ?? '').trim();

/* ------------------------------------------------------------------ desk -- */

/**
 * Every caller is the desk.
 *
 * With no sign-in there is nobody to turn away, so this exists only to keep
 * one name on the audit log and one shape for the actions below.
 */
function guard(): { actor: string } {
  return { actor: DESK_ACTOR };
}

function refreshAll(): void {
  revalidatePath('/');
  revalidatePath('/multi');
  revalidatePath('/admin');
}

/**
 * Look at the desk as a trader would, or stop.
 *
 * Nothing about the session changes — this only tells the screens to draw the
 * trader's version. An admin in the preview keeps every right they had, so
 * there is no way to get stuck on the wrong side of it.
 */
export async function setTraderView(on: boolean): Promise<void> {
  const store = await cookies();
  if (on) {
    store.set(VIEW_COOKIE, 'trader', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: VIEW_MAX_AGE,
    });
  } else {
    store.delete(VIEW_COOKIE);
  }
  refreshAll();
}

/* ------------------------------------------------------- admin mutations -- */

async function saveKcPricesImpl(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const g = guard();
  const entered: Array<[string, number]> = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith('kc_')) continue;
    const raw = String(value).trim();
    // An empty box means "leave this month alone", not "the price is zero".
    if (raw === '') continue;
    const cents = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(cents) || cents < 0) continue;
    entered.push([key.slice(3), cents]);
  }
  const count = entered.length;
  // One document write for the lot. A row at a time is a network round trip
  // each against a store that lives over the wire.
  await mutateState((state) => {
    for (const [monthKey, cents] of entered) applyKcPrice(state, monthKey, cents, g.actor);
    appendAudit(state, g.actor, 'kc_prices', null, 'bulk_update', { count });
  });
  refreshAll();
  return { ok: true, message: `Updated ${count} contract month${count === 1 ? '' : 's'}.` };
}

/** The seasonal table: one differential per month of the calendar year. */
async function saveSeasonalPremiumsImpl(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const g = guard();
  const entered: Array<[number, number]> = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith('season_')) continue;
    const month = Number(key.slice(7));
    if (!Number.isInteger(month) || month < 1 || month > 12) continue;
    const raw = String(value).trim();
    // Empty means "leave this month alone". Zero is a figure; blank is not.
    if (raw === '') continue;
    const cents = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(cents)) continue;
    entered.push([month, cents]);
  }
  const count = entered.length;
  await mutateState((state) => {
    for (const [month, cents] of entered) applySeasonalPremium(state, month, cents, g.actor);
    appendAudit(state, g.actor, 'seasonal_premiums', null, 'bulk_update', { count });
  });
  refreshAll();
  return { ok: true, message: `Updated ${count} month${count === 1 ? '' : 's'} of the season.` };
}

/** Dated exceptions: a month that departs from its season, plus why. */
async function savePremiumOverridesImpl(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const g = guard();

  const removed: string[] = [];
  const kept: Array<[string, number, string]> = [];
  for (const monthKey of form.getAll('override_key').map(String)) {
    if (form.get(`override_drop_${monthKey}`)) {
      removed.push(monthKey);
      continue;
    }
    const cents = num(form, `override_value_${monthKey}`);
    if (!Number.isFinite(cents)) continue;
    kept.push([monthKey, cents, str(form, `override_note_${monthKey}`)]);
  }

  const addMonth = str(form, 'override_new_month');
  const addRaw = String(form.get('override_new_value') ?? '').trim();
  let added = '';
  if (addMonth && addRaw !== '') {
    const cents = Number(addRaw.replace(/,/g, ''));
    if (!Number.isFinite(cents)) {
      return { ok: false, message: 'The new exception needs a number.' };
    }
    kept.push([addMonth, cents, str(form, 'override_new_note')]);
    added = addMonth;
  }

  await mutateState((state) => {
    for (const monthKey of removed) applyClearPremiumOverride(state, monthKey);
    for (const [monthKey, cents, note] of kept) {
      applyPremiumOverride(state, monthKey, cents, note, g.actor);
    }
    appendAudit(state, g.actor, 'premium_overrides', null, 'bulk_update', { removed, added });
  });
  refreshAll();
  const parts: string[] = [];
  if (added) parts.push(`Added ${added}.`);
  if (removed.length) parts.push(`Removed ${removed.join(', ')}.`);
  return { ok: true, message: parts.join(' ') || 'Exceptions saved.' };
}

async function saveCostLinesImpl(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const g = guard();
  const keys = form.getAll('cl_key').map(String);
  await mutateState((state) => {
    for (const key of keys) {
      const line = state.costLines.find((l) => l.key === key);
      if (!line) continue;
      line.amount = num(form, `cl_amount_${key}`);
      line.lbsPerUnit = num(form, `cl_lbs_${key}`);
      line.currency = (str(form, `cl_currency_${key}`) || 'COP') as CurrencyCode;
      line.isMargin = Boolean(form.get(`cl_margin_${key}`));
      line.active = Boolean(form.get(`cl_active_${key}`));
    }
    appendAudit(state, g.actor, 'cost_lines', null, 'bulk_update', { keys });
  });
  refreshAll();
  return { ok: true, message: `Saved ${keys.length} cost lines.` };
}

async function saveDestinationsImpl(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const g = guard();
  const keys = form.getAll('d_key').map(String);
  await mutateState((state) => {
    for (const key of keys) {
      const dest = state.destinations.find((d) => d.key === key);
      if (!dest) continue;
      dest.quoteCurrency = (str(form, `d_cur_${key}`) || 'USD') as CurrencyCode;
      dest.quoteUnit = (str(form, `d_unit_${key}`) || 'lb') as QuoteUnit;
      dest.seafreightAmount = num(form, `d_sea_${key}`);
      dest.importAmount = num(form, `d_imp_${key}`);
      dest.unloadingAmount = num(form, `d_unl_${key}`);
      dest.storageAmount = num(form, `d_stor_${key}`);
      dest.storageCurrency = (str(form, `d_storcur_${key}`) || 'USD') as CurrencyCode;
      dest.active = Boolean(form.get(`d_active_${key}`));
    }
    appendAudit(state, g.actor, 'destinations', null, 'bulk_update', { keys });
  });
  refreshAll();
  return { ok: true, message: `Saved ${keys.length} destinations.` };
}

async function savePackagingAndProcessImpl(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const g = guard();
  const packKeys = form.getAll('p_key').map(String);
  const traderDefault = str(form, 'trader_packaging');
  await mutateState((state) => {
    for (const key of packKeys) {
      const pack = state.packaging.find((p) => p.key === key);
      if (!pack) continue;
      pack.amount = num(form, `p_amount_${key}`);
      pack.lbsPerUnit = num(form, `p_lbs_${key}`);
      pack.traderDefault = key === traderDefault;
      pack.active = Boolean(form.get(`p_active_${key}`));
    }
    appendAudit(state, g.actor, 'packaging', null, 'bulk_update', { packKeys });
  });
  refreshAll();
  return {
    ok: true,
    message: `Saved ${packKeys.length} packaging types.`,
  };
}

async function saveEngineSettingsImpl(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const g = guard();

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
  const validDays = Math.max(1, Math.round(num(form, 'validDays', 1)));

  // The bracket table, read back in the order the rows were rendered.
  const bracketFroms = form.getAll('bracket_from').map((v) => Math.round(Number(v)));
  const bracketMargins = form.getAll('bracket_margin').map((v) => Number(v) / 100);
  const volumeBrackets = bracketFroms
    .map((fromBags, i) => ({ fromBags, minMargin: bracketMargins[i] }))
    .filter((b) => Number.isFinite(b.fromBags) && b.fromBags > 0 && Number.isFinite(b.minMargin))
    .sort((a, b) => a.fromBags - b.fromBags)
    // A bracket runs up to the bag before the next one starts, and the last
    // runs to any size — so the bands can never gap or overlap.
    .map((b, i, all) => ({
      fromBags: b.fromBags,
      toBags: i === all.length - 1 ? null : all[i + 1].fromBags - 1,
      minMargin: b.minMargin,
    }));
  if (volumeBrackets.some((b) => b.minMargin < 0 || b.minMargin >= 1)) {
    return { ok: false, message: 'Every bracket margin must be between 0% and 100%.' };
  }
  if (volumeBrackets.length && new Set(bracketFroms).size !== bracketFroms.length) {
    return { ok: false, message: 'Two brackets cannot start at the same quantity.' };
  }
  const staleAfterDays = Math.max(1, Math.round(num(form, 'staleAfterDays', 7)));

  await mutateState((state) => {
    Object.assign(state.settings, {
      marginMode: str(form, 'marginMode') || 'on_price',
      marginBase: str(form, 'marginBase') || 'full_landed_cost',
      minMargin,
      ladder,
      financeMonthlyRate: num(form, 'financeMonthlyRate') / 100,
      freeHoldMonths,
      validDays,
      staleAfterDays,
      volumeBrackets,
    });
    appendAudit(state, g.actor, 'settings', null, 'update', { minMargin, ladder, freeHoldMonths });
  });
  refreshAll();
  return { ok: true, message: 'Pricing settings saved.' };
}

async function refreshRatesImpl(): Promise<ActionResult> {
  const g = guard();
  const result = await refreshFxRates(g.actor);
  refreshAll();
  const parts: string[] = [];
  if (result.updated.length) parts.push(`Updated ${result.updated.map((u) => u.currency).join(', ')}.`);
  if (result.skipped.length) parts.push(`Kept overrides: ${result.skipped.map((s) => s.currency).join(', ')}.`);
  if (result.errors.length) parts.push(`Failed: ${result.errors.join('; ')}`);
  return { ok: result.errors.length === 0, message: parts.join(' ') || 'Nothing to update.' };
}

async function saveFxOverridesImpl(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const g = guard();
  const currencies = form.getAll('fx_key').map(String) as CurrencyCode[];
  const pinned: string[] = [];
  const released: string[] = [];
  const toPin: Array<[CurrencyCode, number]> = [];
  const toRelease: CurrencyCode[] = [];

  // The pin is the whole switch. Ticked, the typed rate is held against every
  // fetch; unticked, the row goes back to whatever the feed last said. An
  // earlier version required the pin before it would even read the box, so a
  // typed rate was thrown away without a word — the field simply stayed
  // different from the stored rate, and the editor said "unsaved" forever.
  for (const currency of currencies) {
    if (currency === 'USD') continue;

    if (!form.get(`fx_pin_${currency}`)) {
      toRelease.push(currency);
      continue;
    }

    const typed = num(form, `fx_value_${currency}`);
    if (typed <= 0) return { ok: false, message: `${currency} rate must be greater than zero.` };
    // TRM is typed the way a trader says it — pesos per dollar — and stored inverted.
    toPin.push([currency, currency === 'COP' ? trmToUsdPerCop(typed) : typed]);
    pinned.push(currency);
  }

  await mutateState((state) => {
    for (const currency of toRelease) {
      // Only report the ones that were actually pinned to begin with.
      if (!state.fx.find((r) => r.currency === currency)?.isOverride) continue;
      applyClearFxOverride(state, currency);
      released.push(currency);
    }
    for (const [currency, usdPerUnit] of toPin) {
      applyFxOverride(state, currency, usdPerUnit, 'Manual override');
    }
    appendAudit(state, g.actor, 'fx_rates', null, 'bulk_override', { pinned, released });
  });
  refreshAll();
  const parts: string[] = [];
  if (pinned.length) parts.push(`Pinned ${pinned.join(', ')}.`);
  if (released.length) parts.push(`Released ${released.join(', ')} back to the feed.`);
  return { ok: true, message: parts.join(' ') || 'No FX changes.' };
}


/**
 * The coffee types a quote can be built on, and what each is worth.
 *
 * A type carries two figures that are not the same kind of thing: milling,
 * which is a processing cost in pesos a bag, and the premium the type itself
 * commands, in US cents a pound over a plain washed lot.
 */
async function saveCoffeeTypesImpl(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const g = guard();

  const keys = form.getAll('ct_key').map(String);
  const newLabel = str(form, 'ct_new_label');
  const newKey = newLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

  if (newLabel && !newKey) {
    return { ok: false, message: 'That name has no letters or numbers in it.' };
  }

  let added = '';
  const result = await mutateState((state) => {
    for (const key of keys) {
      const row = state.processes.find((p) => p.key === key);
      if (!row) continue;
      row.label = str(form, `ct_label_${key}`) || row.label;
      row.amount = num(form, `ct_amount_${key}`);
      row.premiumCents = num(form, `ct_premium_${key}`);
      row.active = Boolean(form.get(`ct_active_${key}`));
    }

    if (newKey) {
      if (state.processes.some((p) => p.key === newKey)) {
        return `"${newLabel}" is already on the list.`;
      }
      state.processes.push({
        key: newKey,
        label: newLabel,
        amount: num(form, 'ct_new_amount'),
        lbsPerUnit: state.processes[0]?.lbsPerUnit ?? 154.322,
        currency: state.processes[0]?.currency ?? 'COP',
        premiumCents: num(form, 'ct_new_premium'),
        active: true,
      });
      added = newLabel;
    }

    appendAudit(state, g.actor, 'coffee_types', null, 'bulk_update', { keys, added });
    return null;
  });

  if (result) return { ok: false, message: result };
  refreshAll();
  return {
    ok: true,
    message: added ? `Saved, and added ${added}.` : `Saved ${keys.length} coffee types.`,
  };
}

/* --------------------------------------------------- exported actions -- */

// Every one is wrapped, so a store that will not answer shows up in the save
// bar rather than as a blank page with a digest on it.
export const saveKcPrices = guarded('saveKcPrices', saveKcPricesImpl);
export const saveSeasonalPremiums = guarded('saveSeasonalPremiums', saveSeasonalPremiumsImpl);
export const savePremiumOverrides = guarded('savePremiumOverrides', savePremiumOverridesImpl);
export const saveCostLines = guarded('saveCostLines', saveCostLinesImpl);
export const saveDestinations = guarded('saveDestinations', saveDestinationsImpl);
export const savePackagingAndProcess = guarded('savePackagingAndProcess', savePackagingAndProcessImpl);
export const saveEngineSettings = guarded('saveEngineSettings', saveEngineSettingsImpl);
export const saveFxOverrides = guarded('saveFxOverrides', saveFxOverridesImpl);
export const refreshRates = guarded('refreshRates', refreshRatesImpl);
export const saveCoffeeTypes = guarded('saveCoffeeTypes', saveCoffeeTypesImpl);
