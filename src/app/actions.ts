'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import {
  COOKIE_MAX_AGE,
  COOKIE_NAME,
  clearFailedAttempts,
  currentAdmin,
  isAdminCodeSet,
  issueToken,
  lockoutRemaining,
  recordFailedAttempt,
  requireAdmin,
  setAdminCode,
  verifyAdminCode,
} from '@/lib/auth';
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

/* ------------------------------------------------------------------ auth -- */

/** Minimum that is worth calling a code rather than a guess. */
const MIN_CODE_LENGTH = 6;

async function startSession(actor: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, await issueToken(actor), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

function waitMessage(seconds: number): string {
  if (seconds >= 60) {
    const minutes = Math.ceil(seconds / 60);
    return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }
  return `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`;
}

/** First run: whoever opens admin first chooses the code. */
async function createAdminCodeImpl(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  if (await isAdminCodeSet()) {
    return { ok: false, message: 'A code is already set. Sign in with it, or change it once inside.' };
  }
  const code = str(form, 'code');
  const confirm = str(form, 'confirm');
  if (code.length < MIN_CODE_LENGTH) {
    return { ok: false, message: `Use at least ${MIN_CODE_LENGTH} characters.` };
  }
  if (code !== confirm) return { ok: false, message: 'The two codes do not match.' };

  const actor = str(form, 'name') || 'admin';
  await setAdminCode(code);
  await startSession(actor);
  await logAudit(actor, 'session', null, 'code_created');
  revalidatePath('/', 'layout');
  return { ok: true, message: `Code set. You are signed in as ${actor}.` };
}

async function signInImpl(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const waiting = await lockoutRemaining();
  if (waiting > 0) return { ok: false, message: waitMessage(waiting) };

  const code = str(form, 'code');
  if (!code) return { ok: false, message: 'Enter the admin code.' };
  if (!(await isAdminCodeSet())) return { ok: false, message: 'No admin code has been set yet.' };

  if (!(await verifyAdminCode(code))) {
    const wait = await recordFailedAttempt();
    await logAudit(str(form, 'name') || 'unknown', 'session', null, 'sign_in_failed');
    return {
      ok: false,
      message: wait > 0 ? `Wrong code. ${waitMessage(wait)}` : 'Wrong code.',
    };
  }

  await clearFailedAttempts();
  const actor = str(form, 'name') || 'admin';
  await startSession(actor);
  await logAudit(actor, 'session', null, 'sign_in');
  revalidatePath('/', 'layout');
  return { ok: true, message: `Signed in as ${actor}.` };
}

/** Change the code from inside. Requires the current one, so a stolen session cannot lock you out. */
async function changeAdminCodeImpl(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const g = await guard();
  if ('ok' in g) return g;
  if (process.env.ADMIN_PASSWORD) {
    return { ok: false, message: 'The code is set by ADMIN_PASSWORD on this server. Change it there.' };
  }
  const current = str(form, 'current');
  const next = str(form, 'code');
  const confirm = str(form, 'confirm');
  if (!(await verifyAdminCode(current))) return { ok: false, message: 'That is not the current code.' };
  if (next.length < MIN_CODE_LENGTH) {
    return { ok: false, message: `Use at least ${MIN_CODE_LENGTH} characters.` };
  }
  if (next !== confirm) return { ok: false, message: 'The two codes do not match.' };
  if (next === current) return { ok: false, message: 'That is the code you already have.' };

  await setAdminCode(next);
  await logAudit(g.actor, 'session', null, 'code_changed');
  return { ok: true, message: 'Code changed. It applies from the next sign-in.' };
}

export async function signOut(): Promise<void> {
  const actor = (await currentAdmin()) ?? 'unknown';
  const store = await cookies();
  store.delete(COOKIE_NAME);
  await logAudit(actor, 'session', null, 'sign_out');
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

async function saveKcPricesImpl(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const g = await guard();
  if ('ok' in g) return g;
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
  const g = await guard();
  if ('ok' in g) return g;
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
  const g = await guard();
  if ('ok' in g) return g;

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
  const g = await guard();
  if ('ok' in g) return g;
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
  const g = await guard();
  if ('ok' in g) return g;
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
  const g = await guard();
  if ('ok' in g) return g;
  const packKeys = form.getAll('p_key').map(String);
  const procKeys = form.getAll('pr_key').map(String);
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
    for (const key of procKeys) {
      const proc = state.processes.find((p) => p.key === key);
      if (!proc) continue;
      proc.amount = num(form, `pr_amount_${key}`);
      proc.lbsPerUnit = num(form, `pr_lbs_${key}`);
      proc.active = Boolean(form.get(`pr_active_${key}`));
    }
    appendAudit(state, g.actor, 'packaging_process', null, 'bulk_update', { packKeys, procKeys });
  });
  refreshAll();
  return {
    ok: true,
    message: `Saved ${packKeys.length} packaging types and ${procKeys.length} processes.`,
  };
}

async function saveEngineSettingsImpl(
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

async function saveFxOverridesImpl(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const g = await guard();
  if ('ok' in g) return g;
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
export const createAdminCode = guarded('createAdminCode', createAdminCodeImpl);
export const signIn = guarded('signIn', signInImpl);
export const changeAdminCode = guarded('changeAdminCode', changeAdminCodeImpl);
export const refreshRates = guarded('refreshRates', refreshRatesImpl);
