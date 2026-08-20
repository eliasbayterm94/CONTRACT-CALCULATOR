'use client';

import { Fragment, useCallback, useMemo, useState } from 'react';
import PriceText from './PriceText';
import QuoteSheetDialog from './QuoteSheetDialog';
import KcField from './KcField';
import NumberInput from './NumberInput';
import ShortcutSheet from './ShortcutSheet';
import { advanceOnEnter, useShortcuts, type Shortcut } from './useShortcuts';
import {
  calculateQuote,
  cappedHold,
  explainRung,
  kcForTarget,
  reconcile,
  roundUpAdvice,
  rungAt,
  sensitivity,
  solveForPrice,
  staleFigures,
  validUntil,
} from '@/lib/pricing/engine';
import {
  INCOTERMS,
  type CostLineResult,
  type CurrencyCode,
  type Incoterm,
  type PriceStep,
  type QuoteInput,
  type QuoteUnit,
  type ReferenceData,
} from '@/lib/pricing/types';
import { PRICE_DP, UNIT_LABEL, fromQuoteUnit, toQuoteUnit, totalInQuoteCurrency } from '@/lib/pricing/units';
import { deliveryPlan, monthLabel, monthSpan, type CalendarMonth } from '@/lib/pricing/schedule';
import { MONTH_OF_YEAR_NAMES, monthOfYear, premiumForMonth } from '@/lib/pricing/premium';
import type { PremiumOverride, SeasonalPremium } from '@/lib/store/types';
import { cents, longDate, money, percent, plain } from '@/lib/format';
import type { QuoteSheetData } from '@/lib/quoteSheet';
import { draftReference } from '@/lib/quoteSheet';

interface Props {
  reference: ReferenceData;
  /** Stored figures with the date they were last set, for the staleness check. */
  freshness: Array<{ label: string; where: string; updatedAt: string | null }>;
  months: CalendarMonth[];
  isAdmin: boolean;
  defaultKcCents: number;
  /** The seasonal differential table and its dated exceptions. */
  season: SeasonalPremium[];
  overrides: PremiumOverride[];
  kcSpot: { priceCents: number; asOf: string; source: string } | null;
}

const marginLabel = (m: number) => `${(m * 100).toFixed((m * 100) % 1 === 0 ? 0 : 1)}%`;

export default function QuoteBuilder({
  reference,
  freshness,
  months,
  isAdmin,
  defaultKcCents,
  season,
  overrides,
  kcSpot,
}: Props) {
  const settings = reference.settings;
  const traderPackaging =
    reference.packaging.find((p) => p.traderDefault)?.key ?? reference.packaging[0]?.key ?? '';

  const [clientName, setClientName] = useState('');
  const [destinationKey, setDestinationKey] = useState(reference.destinations[0]?.key ?? '');
  const [incoterm, setIncoterm] = useState<Incoterm>('DDP');
  const [processKey, setProcessKey] = useState(reference.processes[0]?.key ?? '');
  const [packagingKey, setPackagingKey] = useState(traderPackaging);
  const [bags, setBags] = useState(250);
  const [kcCents, setKcCents] = useState(String(defaultKcCents || ''));
  // Null means "whatever the shipment month says". A typed figure overrides it
  // for this quote only, and the month can be handed back at any point.
  const [premiumEdit, setPremiumEdit] = useState<string | null>(null);
  const [fromMonth, setFromMonth] = useState(months[0]?.key ?? '');
  const [toMonth, setToMonth] = useState(months[4]?.key ?? months[months.length - 1]?.key ?? '');
  const [holdMonths, setHoldMonths] = useState(2);
  const [waiveFixedCost, setWaiveFixedCost] = useState(false);

  /**
   * The differential the first shipment month resolves to.
   *
   * The premium follows the harvest, so a contract shipping from August is
   * priced on August's figure whatever KC month it hedges against. Where the
   * two used to be tangled, a shipment month with no KC contract of its own
   * simply had no premium at all.
   */
  const premium = useMemo(
    () => premiumForMonth(fromMonth, season, overrides),
    [fromMonth, season, overrides],
  );
  const premiumCents = premiumEdit ?? (premium.source === 'unset' ? '' : String(premium.premiumCents));
  const premiumOverridden = premiumEdit !== null && premiumEdit !== String(premium.premiumCents);
  const monthName = MONTH_OF_YEAR_NAMES[(monthOfYear(fromMonth) ?? 1) - 1];

  const [marginInput, setMarginInput] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [targetMargin, setTargetMargin] = useState('20');

  const [sheet, setSheet] = useState<QuoteSheetData | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // The audit view. Off by default — the breakdown answers "what does it cost",
  // this answers "and where did that number come from", which is a different
  // question and a much longer table.
  const [showWorking, setShowWorking] = useState(false);
  const [auditMargin, setAuditMargin] = useState(settings.minMargin);

  // The window is authoritative: the last month cannot precede the first, and
  // the coffee cannot be held longer than the contract actually runs.
  const safeTo = monthSpan(fromMonth, toMonth) > 0 && toMonth >= fromMonth ? toMonth : fromMonth;
  const span = monthSpan(fromMonth, safeTo);
  const holdCap = Math.min(12, span);
  const effectiveHold = cappedHold(holdMonths, fromMonth, safeTo);

  const input: QuoteInput = useMemo(
    () => ({
      destinationKey,
      incoterm,
      processKey,
      packagingKey: isAdmin ? packagingKey : traderPackaging,
      bags: Number(bags) || 0,
      kcUsdPerLb: (Number(kcCents) || 0) / 100,
      premiumUsdPerLb: (Number(premiumCents) || 0) / 100,
      holdMonths: effectiveHold,
      fromMonth,
      toMonth: safeTo,
      waiveFixedCost: isAdmin && waiveFixedCost,
    }),
    [destinationKey, incoterm, processKey, packagingKey, isAdmin, traderPackaging, bags,
      kcCents, premiumCents, effectiveHold, fromMonth, safeTo, waiveFixedCost],
  );

  const { result, error } = useMemo(() => {
    try {
      return { result: calculateQuote(input, reference), error: null as string | null };
    } catch (e) {
      return { result: null, error: (e as Error).message };
    }
  }, [input, reference]);

  const destination = reference.destinations.find((d) => d.key === destinationKey);
  const unitLabel = destination ? `${destination.quoteCurrency}/${UNIT_LABEL[destination.quoteUnit]}` : '';

  /** The rung the trader is working with: a typed margin, else the floor. */
  const activeRung = useMemo(() => {
    if (!result) return null;
    return marginInput.trim() === '' ? result.floor : rungAt(Number(marginInput) / 100, input, reference);
  }, [result, marginInput, input, reference]);

  const plan = useMemo(() => {
    if (!result || !destination || !activeRung) return null;
    return deliveryPlan(
      fromMonth,
      safeTo,
      result.bags,
      result.totalLbs / (result.bags || 1),
      totalInQuoteCurrency(activeRung.totalValueUsd, destination.quoteCurrency, reference.fx),
    );
  }, [result, destination, activeRung, fromMonth, safeTo, reference.fx]);

  const solvedFromPrice = useMemo(() => {
    if (!result || !destination || priceInput.trim() === '') return null;
    const usdPerLb = fromQuoteUnit(
      Number(priceInput), destination.quoteCurrency, destination.quoteUnit, reference.fx,
    );
    if (!Number.isFinite(usdPerLb)) return null;
    return { usdPerLb, ...solveForPrice(usdPerLb, result, settings) };
  }, [result, destination, priceInput, reference.fx, settings]);

  const solvedKc = useMemo(() => {
    if (!result || !destination || targetPrice.trim() === '' || targetMargin.trim() === '') return null;
    const usdPerLb = fromQuoteUnit(
      Number(targetPrice), destination.quoteCurrency, destination.quoteUnit, reference.fx,
    );
    const margin = Number(targetMargin) / 100;
    if (!Number.isFinite(usdPerLb) || !Number.isFinite(margin)) return null;
    const needed = kcForTarget(usdPerLb, margin, input, reference);
    return needed === null ? null : { needed, margin, move: needed - input.kcUsdPerLb };
  }, [result, destination, targetPrice, targetMargin, reference, input]);

  // Rendered on the client, so the clock is the trader's own — the date on the
  // sheet matches the day they are actually sitting at.
  const [today] = useState(() => new Date());

  const holdsUntil = useMemo(
    () => validUntil(today, settings.validDays),
    [today, settings.validDays],
  );

  const buildSheet = useCallback((): QuoteSheetData | null => {
    if (!result || !destination || !activeRung || !plan) return null;
    const unit = UNIT_LABEL[destination.quoteUnit];
    return {
      title: 'Price quote',
      client: clientName || '—',
      reference: draftReference(Date.now()),
      terms: [
        ['Destination', destination.label],
        ['Incoterm', incoterm],
        ['Coffee type', reference.processes.find((p) => p.key === input.processKey)?.label ?? ''],
        ['Packaging', reference.packaging.find((p) => p.key === input.packagingKey)?.label ?? ''],
        ['Quantity', `${plain(result.bags, 0)} bags · ${plain(result.totalLbs, 0)} lb`],
        ['Shipment window', `${monthLabel(fromMonth)} – ${monthLabel(safeTo)}`],
        ['Contract held', `${effectiveHold} month${effectiveHold === 1 ? '' : 's'}`],
      ],
      priceLabel: `Price per ${unit}`,
      price: money(activeRung.displayPrice, destination.quoteCurrency, PRICE_DP),
      priceSub: `${cents(activeRung.priceUsdPerLb)} per lb`,
      valueLabel: 'Contract value',
      value: money(plan.totalValue, destination.quoteCurrency, 0),
      basis: `Priced against a KC of ${cents(input.kcUsdPerLb)} per lb.`,
      validity:
        `Holds until ${longDate(holdsUntil)}. The price is tied to that KC and moves with the C market — ` +
        'past that date, or on a material move, it has to be requoted. Subject to final contract.',
      rows: {
        title: `Shipment plan · ${plan.even ? plain(plan.perMonthBags, 0) : `~${plain(plan.perMonthBags, 1)}`} bags a month`,
        head: ['Month', 'Bags', 'Pounds', `Billing ${destination.quoteCurrency}`],
        body: plan.months.map((m) => [
          m.label, plain(m.bags, 0), plain(m.lbs, 0),
          money(m.billing, destination.quoteCurrency, 0),
        ]),
      },
    };
  }, [result, destination, activeRung, plan, clientName, incoterm, reference, input,
      fromMonth, safeTo, effectiveHold, holdsUntil]);

  /** Adopt a rung: the headline, the schedule and the quote sheet all follow. */
  const useRung = useCallback((margin: number) => {
    setMarginInput(String(Number((margin * 100).toFixed(4))));
  }, []);

  const warnings = (result?.warnings ?? []).filter((w) => isAdmin || !w.adminOnly);

  /**
   * Everything behind this quote that the desk should know about before
   * sending it: figures that have aged out, and the premium the shipment
   * month has no figure for at all. The second is not a matter of age — a
   * seasonal table does not rot, it is either set or it is not.
   */
  const alerts = useMemo(() => {
    const out = staleFigures(freshness, settings.staleAfterDays, today)
      .filter((f) => f.stale)
      .map((f) => ({
        key: f.label,
        text: `${f.label} — ${Number.isFinite(f.ageDays) ? `last set ${f.ageDays} days ago` : 'never set, still on the seeded figure'}`,
        where: f.where,
      }));
    if (premium.source === 'unset' && !premiumOverridden) {
      out.unshift({
        key: 'premium',
        text: `No quality premium set for ${monthName}, the first shipment month`,
        where: 'KC & premiums',
      });
    }
    return out;
  }, [freshness, settings.staleAfterDays, today, premium.source, premiumOverridden, monthName]);

  // What the C market does to this quote. Traders need it as much as admin.
  const kcMoves = useMemo(
    () => (result && activeRung ? sensitivity(input, reference, activeRung.margin) : []),
    [result, activeRung, input, reference],
  );

  const focusField = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLInputElement)) return;
    el.focus();
    el.select();
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  const shortcuts = useMemo<Shortcut[]>(
    () => [
      { key: 'k', label: 'Jump to the KC price', run: () => focusField('kc-price') },
      { key: 'b', label: 'Jump to bags', run: () => focusField('bags') },
      { key: 'c', label: 'Jump to the client name', run: () => focusField('client') },
      { key: 'd', label: 'Download the quote', run: () => setSheet(buildSheet()) },
      ...(isAdmin
        ? [{ key: 'a', label: 'Show or hide the arithmetic', run: () => setShowWorking((on) => !on) }]
        : []),
      { key: '?', label: 'This list', run: () => setShortcutsOpen(true) },
    ],
    [focusField, buildSheet, isAdmin],
  );

  // Off while the shortcut sheet is up, so its own Esc and ? are not fought over.
  useShortcuts(shortcuts, !shortcutsOpen);

  const roundUp = useMemo(
    () => (result && activeRung ? roundUpAdvice(input, reference, activeRung.totalValueUsd) : null),
    [result, activeRung, input, reference],
  );

  // Under the floor is not a footnote. It is the one thing on this screen that
  // has to stop someone, so it is derived once and shouted about everywhere.
  /**
   * Is this a quote for something other than the plain lot?
   *
   * The type the select opens on is what a quote is assumed to be. Anything
   * else changes the price without changing anything the eye lands on, so it
   * gets named in the headline — a decaf quoted as though it were washed is a
   * mistake nobody catches until the contract.
   */
  const defaultType = reference.processes[0];
  const flaggedType =
    processKey !== defaultType?.key
      ? reference.processes.find((p) => p.key === processKey) ?? null
      : null;

  const floorMargin = result?.band.minMargin ?? settings.minMargin;
  const belowFloor = Boolean(activeRung && activeRung.margin < floorMargin - 1e-9);
  const shortfallUsdPerLb =
    belowFloor && result && activeRung
      ? result.floor.priceUsdPerLb - activeRung.priceUsdPerLb
      : 0;

  // Both are cheap, but they only mean anything to an admin looking at the
  // breakdown, so they are not computed for a trader's render.
  const audit = useMemo(() => {
    if (!isAdmin || !result) return null;
    const rung =
      result.ladder.find((r) => Math.abs(r.margin - auditMargin) < 1e-9) ?? result.floor;
    return {
      check: reconcile(result),
      rung,
      steps: explainRung(rung, result, settings, reference.fx),
    };
  }, [isAdmin, result, auditMargin, settings, reference.fx]);

  return (
    <>
      {/* ── market bar ─────────────────────────────────────────────── */}
      <div className="qc-market" data-field-scope onKeyDown={advanceOnEnter}>
        <div className="qc-market-grid">
          <div>
            <span className="qc-market-label">KC price ¢/lb</span>
            <KcField value={kcCents} onChange={setKcCents} spot={kcSpot} />
          </div>
          <div>
            <span className="qc-market-label">Shipping from</span>
            <select
              id="from-month"
              aria-label="First shipment month"
              value={fromMonth}
              onChange={(e) => {
                setFromMonth(e.target.value);
                if (e.target.value > toMonth) setToMonth(e.target.value);
              }}
            >
              {months.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
            <p className="qc-market-hint">{span} month{span === 1 ? '' : 's'} of shipments</p>
          </div>
          <div>
            <span className="qc-market-label">Shipping to</span>
            <select
              aria-label="Last shipment month"
              value={safeTo}
              onChange={(e) => setToMonth(e.target.value)}
            >
              {months.filter((m) => m.key >= fromMonth).map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
            <p className="qc-market-hint">{monthLabel(fromMonth)} – {monthLabel(safeTo)}</p>
          </div>
          <div>
            <span className="qc-market-label">Contract held for</span>
            <select
              aria-label="Months the contract is held"
              value={effectiveHold}
              onChange={(e) => setHoldMonths(Number(e.target.value))}
            >
              {Array.from({ length: holdCap }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n} month{n === 1 ? '' : 's'}</option>
              ))}
            </select>
            <p className={`qc-market-hint ${result && result.billableMonths > 0 ? 'is-charged' : 'is-free'}`}>
              {incoterm !== 'DDP'
                ? `Not charged on ${incoterm} — the buyer carries the coffee.`
                : result && result.billableMonths > 0
                  ? `${result.billableMonths} month${result.billableMonths === 1 ? '' : 's'} billed — first ${settings.freeHoldMonths} are covered.`
                  : `No storage or finance — covered by the fixed cost up to ${settings.freeHoldMonths} months.`}
            </p>
          </div>
          {isAdmin && (
            <div>
              <span className="qc-market-label">
                Premium ¢/lb <span className="qc-adminchip">Admin</span>
              </span>
              <input
                type="number" step="any" inputMode="decimal"
                aria-label="Quality premium in US cents per pound"
                placeholder={premium.source === 'unset' ? 'not set' : undefined}
                value={premiumCents}
                onChange={(e) => setPremiumEdit(e.target.value)}
              />
              <p className={`qc-market-hint${premium.source === 'unset' && !premiumOverridden ? ' is-bad' : ''}`}>
                {premiumOverridden ? (
                  <>
                    Set by hand for this quote.{' '}
                    <button type="button" className="qc-linkish" onClick={() => setPremiumEdit(null)}>
                      Use {monthName} again
                    </button>
                  </>
                ) : premium.source === 'override' ? (
                  <>
                    {monthLabel(fromMonth)} exception{premium.note ? ` — ${premium.note}` : ''}
                  </>
                ) : premium.source === 'seasonal' ? (
                  <>{monthName} · seasonal differential over KC</>
                ) : (
                  <>No premium set for {monthName}</>
                )}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="qc-grid">
        {/* ── contract ─────────────────────────────────────────────── */}
        <div className="qc-rail">
          <section className="qc-panel">
            <div className="qc-panel-head"><h2 className="qc-panel-title">Contract</h2></div>
            <div className="qc-panel-body" data-field-scope onKeyDown={advanceOnEnter}>
              <div className="qc-fields">
                <div className="qc-field wide">
                  <label className="qc-label" htmlFor="client">Client</label>
                  <input
                    id="client" className="qc-input" value={clientName}
                    onChange={(e) => setClientName(e.target.value)} placeholder="Client name"
                  />
                </div>
                <div className="qc-field wide">
                  <label className="qc-label" htmlFor="destination">Destination</label>
                  <select
                    id="destination" className="qc-select" value={destinationKey}
                    onChange={(e) => setDestinationKey(e.target.value)}
                  >
                    {reference.destinations.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label} — {d.quoteCurrency}/{UNIT_LABEL[d.quoteUnit]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="qc-field wide">
                  <span className="qc-label">Incoterm</span>
                  <div className="qc-seg" role="group" aria-label="Incoterm">
                    {INCOTERMS.map((term) => (
                      <button
                        key={term} type="button"
                        aria-pressed={incoterm === term}
                        onClick={() => setIncoterm(term)}
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="qc-field">
                  <label className="qc-label" htmlFor="process">Coffee type</label>
                  <select
                    id="process" className="qc-select" value={processKey}
                    onChange={(e) => setProcessKey(e.target.value)}
                  >
                    {reference.processes.map((p) => (
                      <option key={p.key} value={p.key}>
                        {/* What the type adds is part of choosing it. */}
                        {p.premiumCents ? `${p.label} · +${plain(p.premiumCents, 0)}¢` : p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="qc-field">
                  <label className="qc-label" htmlFor="bags">Bags</label>
                  <NumberInput
                    id="bags" className="qc-input num" min={0} step={1} inputMode="numeric"
                    value={bags} onValueChange={setBags}
                  />
                  <p className="qc-hint">
                    {result ? `${plain(result.containers, 2)} containers · ${plain(result.totalLbs, 0)} lb` : ''}
                  </p>
                </div>
                <div className="qc-field wide">
                  <span className="qc-label">
                    Packaging {isAdmin && <span className="qc-adminchip">Admin can change</span>}
                  </span>
                  {isAdmin ? (
                    <select
                      className="qc-select" value={packagingKey} aria-label="Packaging"
                      onChange={(e) => setPackagingKey(e.target.value)}
                    >
                      {reference.packaging.map((p) => (
                        <option key={p.key} value={p.key}>{p.label}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="qc-static">
                      {reference.packaging.find((p) => p.key === traderPackaging)?.label}
                    </div>
                  )}
                </div>
                {isAdmin && (
                  <div className="qc-field wide">
                    <label className="qc-switch" htmlFor="waive">
                      <input
                        type="checkbox" id="waive" checked={waiveFixedCost}
                        onChange={(e) => setWaiveFixedCost(e.target.checked)}
                      />
                      <span className="qc-switch-track"><span className="qc-switch-thumb" /></span>
                      <span className="qc-switch-body">
                        <span className="qc-switch-title">
                          Waive fixed cost <span className="qc-adminchip">Admin</span>
                        </span>
                        <span className="qc-switch-sub">
                          Drops the 30¢/lb recovery for strategic volume deals
                        </span>
                      </span>
                    </label>
                  </div>
                )}
              </div>
              {isAdmin && (
                <div className="qc-fxline">
                  TRM {plain(1 / reference.fx.COP, 2)}<br />
                  EUR {plain(reference.fx.EUR, 4)} · GBP {plain(reference.fx.GBP, 4)}<br />
                  AUD {plain(reference.fx.AUD, 4)} · CAD {plain(reference.fx.CAD, 4)}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* ── results ──────────────────────────────────────────────── */}
        <div>
          {error && (
            <div className="qc-warn" style={{ marginBottom: 14 }}>
              <span>{error}</span>
            </div>
          )}

          {alerts.length > 0 && (
            <div className="qc-stale" role="status">
              <span className="qc-stale-mark" aria-hidden="true">!</span>
              <div>
                <strong>
                  {alerts.length === 1
                    ? 'One figure behind this quote needs attention'
                    : `${alerts.length} figures behind this quote need attention`}
                </strong>
                <ul className="qc-stale-list">
                  {/* A fresh install has every rate on its seed; naming all of
                      them turns the warning into a wall nobody reads. */}
                  {alerts.slice(0, 4).map((a) => (
                    <li key={a.key}>
                      {a.text}
                      {isAdmin && <span className="qc-stale-where"> · {a.where}</span>}
                    </li>
                  ))}
                  {alerts.length > 4 && <li>and {alerts.length - 4} more</li>}
                </ul>
              </div>
            </div>
          )}

          {result && destination && activeRung && (
            <>
              {result.band.belowPolicy && (
                <div className="qc-offpolicy" role="alert">
                  <span className="qc-offpolicy-mark" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <path d="M12 8v5M12 16.5v.5" />
                      <circle cx="12" cy="12" r="9" />
                    </svg>
                  </span>
                  <div>
                    <strong>Outside policy — {result.bags} bags</strong>
                    <span>
                      The smallest bracket starts at {settings.volumeBrackets[0]?.fromBags} bags. The price below is
                      what it would take at that bracket&apos;s floor, but this one does not go out without admin.
                    </span>
                  </div>
                </div>
              )}

              {roundUp && (
                <div className="qc-roundup">
                  <span className="qc-roundup-mark" aria-hidden="true">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                  </span>
                  <div>
                    <strong>{roundUp.toBags} bags would cost less than {result.bags}</strong>
                    <span>
                      The next bracket starts there, at{' '}
                      {money(roundUp.displayPrice, destination.quoteCurrency, PRICE_DP)}/
                      {UNIT_LABEL[destination.quoteUnit]} — {money(
                        totalInQuoteCurrency(roundUp.savingUsd, destination.quoteCurrency, reference.fx),
                        destination.quoteCurrency,
                        0,
                      )}{' '}
                      less for more coffee.
                    </span>
                  </div>
                  <button type="button" className="fc-btn fc-btn-ghost" onClick={() => setBags(roundUp.toBags)}>
                    Take {roundUp.toBags}
                  </button>
                </div>
              )}

              {belowFloor && (
                <div className="qc-floor-alarm" role="alert">
                  <span className="qc-floor-alarm-mark" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <path d="M12 9v5M12 17.5v.5" />
                      <path d="M10.3 3.9 1.8 18.4A2 2 0 0 0 3.5 21.4h17A2 2 0 0 0 22.2 18.4L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                    </svg>
                  </span>
                  <div className="qc-floor-alarm-body">
                    <span className="qc-floor-alarm-title">
                      Under the {marginLabel(floorMargin)} floor
                    </span>
                    <span className="qc-floor-alarm-detail">
                      This quote is {percent(floorMargin - activeRung.margin, 2)} short. That is{' '}
                      {cents(shortfallUsdPerLb)}/lb, or{' '}
                      {money(
                        totalInQuoteCurrency(shortfallUsdPerLb * result.totalLbs, destination.quoteCurrency, reference.fx),
                        destination.quoteCurrency,
                        0,
                      )}{' '}
                      off the contract. The floor is{' '}
                      <strong>
                        {money(result.floor.displayPrice, destination.quoteCurrency, PRICE_DP)}/{UNIT_LABEL[destination.quoteUnit]}
                      </strong>.
                    </span>
                  </div>
                  <button type="button" className="fc-btn fc-btn-navy" onClick={() => useRung(floorMargin)}>
                    Take it to the floor
                  </button>
                </div>
              )}

              <div className={`qc-headline${belowFloor ? ' is-below-floor' : ''}`}>
                <div className="qc-hero">
                  <div className="qc-hero-label">
                    <span>
                      Quote at {marginInput.trim() === '' ? `floor margin ${marginLabel(floorMargin)}` : marginLabel(activeRung.margin)}
                    </span>
                    {flaggedType && (
                      <span className="qc-typetag">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                          <path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
                          <circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" />
                        </svg>
                        {flaggedType.label}
                        {flaggedType.premiumCents ? ` +${plain(flaggedType.premiumCents, 0)}¢/lb` : ''}
                      </span>
                    )}
                  </div>
                  <div className="qc-hero-price">
                    <span className="qc-hero-big">
                      <PriceText value={activeRung.displayPrice} currency={destination.quoteCurrency} />
                    </span>
                    <span className="qc-hero-unit">
                      per {UNIT_LABEL[destination.quoteUnit]} · {destination.label} {incoterm}
                    </span>
                  </div>
                  <div className="qc-hero-sub">
                    <span className="fc-pill">{cents(activeRung.priceUsdPerLb)}/lb</span>
                    <span className="fc-pill">KC +{cents(activeRung.priceUsdPerLb - input.kcUsdPerLb)}</span>
                    <span className="fc-pill">
                      {money(totalInQuoteCurrency(activeRung.totalValueUsd, destination.quoteCurrency, reference.fx), destination.quoteCurrency, 0)} contract
                    </span>
                    {result.waivedFixedCost && <span className="qc-waived-flag">Fixed cost waived</span>}
                  </div>
                  <div className="qc-validity">
                    Holds until <strong>{longDate(holdsUntil)}</strong> · priced at KC{' '}
                    <strong>{plain(input.kcUsdPerLb * 100, 2)}&cent;</strong> — subject to change with the C market.
                  </div>
                </div>
                <div className="qc-sidestats">
                  <div className="qc-stat">
                    <div className="qc-stat-label">Volume</div>
                    <div className="qc-stat-value">{plain(result.bags, 0)} bags</div>
                    <div className="qc-stat-sub">
                      {plain(result.totalLbs, 0)} lb · {plain(result.containers, 2)} containers
                    </div>
                    <div className={`qc-band${result.band.belowPolicy ? ' is-bad' : ''}`}>
                      {result.band.label} · floor {marginLabel(result.band.minMargin)}
                    </div>
                  </div>
                  {isAdmin ? (
                    <div className="qc-stat">
                      <div className="qc-stat-label">Break-even <span className="qc-adminchip">Admin</span></div>
                      <div className="qc-stat-value">
                        <PriceText
                          value={toQuoteUnit(result.totalCostUsdPerLb, destination.quoteCurrency, destination.quoteUnit, reference.fx)}
                          currency={destination.quoteCurrency}
                        />
                      </div>
                      <div className="qc-stat-sub">{cents(result.totalCostUsdPerLb)}/lb break-even</div>
                    </div>
                  ) : (
                    <div className="qc-stat">
                      <div className="qc-stat-label">Differential over KC</div>
                      <div className="qc-stat-value">
                        {cents(result.differentialUsdPerLb + result.financeUsdPerLb)}
                      </div>
                      <div className="qc-stat-sub">Above the market price</div>
                    </div>
                  )}
                </div>
              </div>

              {/* solvers */}
              <div className="qc-solvers">
                <section className="qc-panel qc-solver">
                  <div className="qc-panel-body">
                    <div className="qc-solver-head">
                      <span className="qc-solver-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                      </span>
                      <h3>Margin → price</h3>
                    </div>
                    <p className="qc-solver-sub">Name the margin you want and see what to quote.</p>
                    <div className="qc-inputrow">
                      <input
                        className="qc-input num" type="number" step="any" inputMode="decimal"
                        aria-label="Target margin percent"
                        placeholder={String(floorMargin * 100)}
                        value={marginInput} onChange={(e) => setMarginInput(e.target.value)}
                      />
                      <span className="qc-suffix">%</span>
                    </div>
                    {marginInput.trim() === '' ? (
                      <div className="qc-answer is-empty">Enter a margin to see the price.</div>
                    ) : (
                      <div className="qc-answer">
                        <div className={`qc-answer-big${Number(marginInput) / 100 < floorMargin ? ' is-warn' : ''}`}>
                          <PriceText value={activeRung.displayPrice} currency={destination.quoteCurrency} />
                        </div>
                        <div className="qc-answer-meta">
                          {cents(activeRung.priceUsdPerLb)}/lb · KC +{cents(activeRung.priceUsdPerLb - input.kcUsdPerLb)} ·{' '}
                          {money(totalInQuoteCurrency(activeRung.totalValueUsd, destination.quoteCurrency, reference.fx), destination.quoteCurrency, 0)} contract
                        </div>
                        {Number(marginInput) / 100 < floorMargin && (
                          <div className="qc-verdict is-warn">Under the {marginLabel(floorMargin)} floor</div>
                        )}
                      </div>
                    )}
                  </div>
                </section>

                <section className="qc-panel qc-solver">
                  <div className="qc-panel-body">
                    <div className="qc-solver-head">
                      <span className="qc-solver-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
                      </span>
                      <h3>Price → margin</h3>
                    </div>
                    <p className="qc-solver-sub">Name the price the client wants and see what it leaves.</p>
                    <div className="qc-inputrow">
                      <input
                        className="qc-input num" type="number" step="any" inputMode="decimal"
                        aria-label="Target price" placeholder={plain(result.floor.displayPrice, PRICE_DP)}
                        value={priceInput} onChange={(e) => setPriceInput(e.target.value)}
                      />
                      <span className="qc-suffix">{unitLabel}</span>
                    </div>
                    {!solvedFromPrice ? (
                      <div className="qc-answer is-empty">Enter a target price to see the margin.</div>
                    ) : (
                      <div className="qc-answer">
                        <div className={`qc-answer-big ${solvedFromPrice.belowCost ? 'is-bad' : solvedFromPrice.belowFloor ? 'is-warn' : 'is-ok'}`}>
                          {percent(solvedFromPrice.margin, 2)}
                        </div>
                        <div className="qc-answer-meta">
                          {isAdmin
                            ? `${cents(solvedFromPrice.usdPerLb)}/lb · margin ${cents(solvedFromPrice.marginUsdPerLb)}/lb`
                            : `${cents(solvedFromPrice.usdPerLb)}/lb · KC +${cents(solvedFromPrice.usdPerLb - input.kcUsdPerLb)}`}
                        </div>
                        <div className={`qc-verdict ${solvedFromPrice.belowCost ? 'is-bad' : solvedFromPrice.belowFloor ? 'is-warn' : 'is-ok'}`}>
                          {solvedFromPrice.belowCost
                            ? 'Below break-even — this loses money'
                            : solvedFromPrice.belowFloor
                              ? `Under the ${marginLabel(floorMargin)} floor`
                              : 'Clears the floor'}
                        </div>
                        <div className="qc-actions">
                          <button
                            type="button" className="fc-btn fc-btn-ghost"
                            onClick={() => useRung(solvedFromPrice.margin)}
                          >
                            Price at this margin
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <section className="qc-panel qc-solver qc-solver-kc">
                  <div className="qc-panel-body">
                    <div className="qc-solver-head">
                      <span className="qc-solver-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20V4M6 10l6-6 6 6" /></svg>
                      </span>
                      <h3>Price target → KC needed</h3>
                    </div>
                    <p className="qc-solver-sub">
                      The client wants a price and you want a margin. Where does KC have to be?
                    </p>
                    <div className="qc-inputrow">
                      <input
                        className="qc-input num" type="number" step="any" inputMode="decimal"
                        aria-label="Client target price" placeholder={plain(result.floor.displayPrice, PRICE_DP)}
                        value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)}
                      />
                      <span className="qc-suffix">{unitLabel}</span>
                    </div>
                    <div className="qc-inputrow" style={{ marginTop: 9 }}>
                      <input
                        className="qc-input num" type="number" step="any" inputMode="decimal"
                        aria-label="Target margin percent"
                        value={targetMargin} onChange={(e) => setTargetMargin(e.target.value)}
                      />
                      <span className="qc-suffix">% margin</span>
                    </div>
                    {!solvedKc ? (
                      <div className="qc-answer is-empty">Enter a price and a margin to see the KC it needs.</div>
                    ) : solvedKc.needed <= 0 ? (
                      <div className="qc-answer">
                        <div className="qc-answer-big is-bad">Not reachable</div>
                        <div className="qc-answer-meta">
                          Even at a KC of zero this quote cannot hit {money(Number(targetPrice), destination.quoteCurrency, PRICE_DP)}/{UNIT_LABEL[destination.quoteUnit]} at {percent(solvedKc.margin, 1)}.
                        </div>
                      </div>
                    ) : (
                      <div className="qc-answer">
                        <div className={`qc-answer-big ${solvedKc.move < 0 ? 'is-warn' : 'is-ok'}`}>
                          {cents(solvedKc.needed)}
                        </div>
                        <div className="qc-answer-meta">
                          KC must {solvedKc.move < 0 ? 'fall' : 'rise'} {cents(Math.abs(solvedKc.move))} from{' '}
                          {cents(input.kcUsdPerLb)} to hold {percent(solvedKc.margin, 1)}.
                        </div>
                        <div className={`qc-verdict ${solvedKc.move < 0 ? 'is-warn' : 'is-ok'}`}>
                          {Math.abs(solvedKc.move) < 0.0001
                            ? 'The market is already there'
                            : solvedKc.move < 0
                              ? `The market has to come down ${cents(Math.abs(solvedKc.move))}`
                              : `You have ${cents(solvedKc.move)} of room before this stops working`}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </div>

              {warnings.length > 0 && (
                <div className="qc-warns">
                  {warnings.map((w) => (
                    <div className="qc-warn" key={w.text}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 9v4M12 17h.01" />
                        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                      </svg>
                      <span>{w.text}{w.adminOnly && <span className="qc-adminchip" style={{ marginLeft: 6 }}>Admin</span>}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* ladder */}
              <section className="qc-panel">
                <div className="qc-panel-head">
                  <h2 className="qc-panel-title">Price ladder</h2>
                  <span className="qc-panel-note">
                    {isAdmin
                      ? `Margin ${settings.marginMode === 'on_price' ? 'as a share of price' : 'as a markup on cost'}`
                      : `Quoted in ${unitLabel}`}
                  </span>
                </div>
                <div className="qc-ladder-cards">
                  {result.ladder.map((rung, i) => {
                    const isFloor = Math.abs(rung.margin - floorMargin) < 1e-9;
                    const isActive = Math.abs(rung.margin - activeRung.margin) < 1e-9;
                    const step = i === 0 ? null : rung.displayPrice - result.ladder[i - 1].displayPrice;
                    return (
                      <button
                        type="button"
                        className={`qc-rung${isActive ? ' is-active' : isFloor ? ' is-floor' : ''}`}
                        key={rung.margin}
                        onClick={() => useRung(rung.margin)}
                      >
                        <span className="qc-rung-margin">
                          {marginLabel(rung.margin)}
                          {isFloor && <span className="qc-floorbadge">Floor</span>}
                        </span>
                        <span className="qc-rung-price">
                          <PriceText value={rung.displayPrice} currency={destination.quoteCurrency} />
                        </span>
                        <span className="qc-rung-meta">
                          <span>{step === null ? 'base rung' : `step +${plain(step, PRICE_DP)}`}</span>
                          <span>KC +{cents(rung.priceUsdPerLb - input.kcUsdPerLb)}</span>
                          <span>{money(totalInQuoteCurrency(rung.totalValueUsd, destination.quoteCurrency, reference.fx), destination.quoteCurrency, 0)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="qc-ladder-table qc-table-wrap">
                  <table className="qc-table">
                    <thead>
                      <tr>
                        <th>Margin</th>
                        <th className="qc-num">Price {unitLabel}</th>
                        <th className="qc-num">Step up</th>
                        <th className="qc-num">¢/lb</th>
                        <th className="qc-num">Over KC</th>
                        {isAdmin && <th className="qc-num">Margin/lb</th>}
                        <th className="qc-num">Contract value</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {result.ladder.map((rung, i) => {
                        const isFloor = Math.abs(rung.margin - floorMargin) < 1e-9;
                        const isActive = Math.abs(rung.margin - activeRung.margin) < 1e-9;
                        const step = i === 0 ? null : rung.displayPrice - result.ladder[i - 1].displayPrice;
                        return (
                          <tr key={rung.margin} className={isActive ? 'qc-row-active' : isFloor ? 'qc-row-floor' : ''}>
                            <td>
                              <span className="qc-marginpct">{marginLabel(rung.margin)}</span>
                              {isFloor && <span className="qc-floorbadge">Floor</span>}
                            </td>
                            <td className="qc-price-cell">
                              <PriceText value={rung.displayPrice} currency={destination.quoteCurrency} />
                            </td>
                            <td className="qc-num">
                              {step === null
                                ? <span className="qc-step is-base">base</span>
                                : <span className="qc-step">+{plain(step, PRICE_DP)}</span>}
                            </td>
                            <td className="qc-num">{cents(rung.priceUsdPerLb)}</td>
                            <td className="qc-num">+{cents(rung.priceUsdPerLb - input.kcUsdPerLb)}</td>
                            {isAdmin && <td className="qc-num">{cents(rung.marginUsdPerLb)}</td>}
                            <td className="qc-num">
                              {money(totalInQuoteCurrency(rung.totalValueUsd, destination.quoteCurrency, reference.fx), destination.quoteCurrency, 0)}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button
                                type="button"
                                className={`fc-btn ${isActive ? 'fc-btn-navy' : 'fc-btn-ghost'}`}
                                style={{ padding: '5px 11px', fontSize: 10 }}
                                onClick={() => useRung(rung.margin)}
                              >
                                {isActive ? 'In use' : 'Use'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* what the C market does to this price */}
              <section className="qc-panel">
                <div className="qc-panel-head">
                  <h2 className="qc-panel-title">If the C moves</h2>
                  <span className="qc-panel-note">
                    At {marginLabel(activeRung.margin)}, from KC {plain(input.kcUsdPerLb * 100, 2)}&cent;
                  </span>
                </div>
                <div className="qc-table-wrap">
                  <table className="qc-table qc-sens">
                    <thead>
                      <tr>
                        <th>KC move</th>
                        <th className="qc-num">KC</th>
                        <th className="qc-num">Your price</th>
                        <th className="qc-num">Change</th>
                        <th className="qc-num">Contract</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kcMoves.map((row) => (
                        <tr key={row.moveCents} className={row.moveCents < 0 ? 'qc-sens-down' : 'qc-sens-up'}>
                          <td>
                            <span className={`qc-sens-move${row.moveCents < 0 ? ' is-down' : ' is-up'}`}>
                              {row.moveCents > 0 ? '+' : '\u2212'}{Math.abs(row.moveCents)}&cent;
                            </span>
                          </td>
                          <td className="qc-num">{plain(row.kcCents, 2)}&cent;</td>
                          <td className="qc-num">
                            <strong>{money(row.displayPrice, destination.quoteCurrency, PRICE_DP)}</strong>
                          </td>
                          <td className={`qc-num qc-sens-delta${row.deltaDisplay < 0 ? ' is-down' : ' is-up'}`}>
                            {row.deltaDisplay > 0 ? '+' : '\u2212'}
                            {money(Math.abs(row.deltaDisplay), destination.quoteCurrency, PRICE_DP)}
                          </td>
                          <td className="qc-num">
                            {money(
                              totalInQuoteCurrency(row.totalValueUsd, destination.quoteCurrency, reference.fx),
                              destination.quoteCurrency,
                              0,
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="qc-footnote">
                  The price moves more than the C does: margin and, on DDP, finance are both charged on a
                  cargo value that includes the coffee. Everything else in the quote is held still.
                </p>
              </section>

              {/* delivery schedule */}
              {plan && (
                <section className="qc-panel">
                  <div className="qc-panel-head">
                    <h2 className="qc-panel-title">Delivery schedule</h2>
                    <span className="qc-panel-note">
                      At {marginLabel(activeRung.margin)} · {monthLabel(fromMonth)} – {monthLabel(safeTo)}
                    </span>
                  </div>
                  <div className="qc-schedule-summary">
                    <span className="qc-sched-lead">
                      {plain(result.bags, 0)} bags over {plan.months.length} month{plan.months.length === 1 ? '' : 's'}
                    </span>
                    <span className="qc-sched-rate">
                      {plan.even ? plain(plan.perMonthBags, 0) : `~${plain(plan.perMonthBags, 1)}`} bags a month
                    </span>
                    <span className="qc-sched-rate">
                      {money(plan.months[0]?.billing ?? 0, destination.quoteCurrency, 0)} a month
                    </span>
                  </div>
                  <div className="qc-table-wrap">
                    <table className="qc-table qc-schedule-table">
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th className="qc-num">Bags</th>
                          <th className="qc-num">Pounds</th>
                          <th className="qc-num">Billing {destination.quoteCurrency}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.months.map((m) => (
                          <tr key={m.key}>
                            <td>{m.label}</td>
                            <td className="qc-num">{plain(m.bags, 0)}</td>
                            <td className="qc-num">{plain(m.lbs, 0)}</td>
                            <td className="qc-num">{money(m.billing, destination.quoteCurrency, 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="qc-total">
                        <tr>
                          <td>Total</td>
                          <td className="qc-num">{plain(result.bags, 0)}</td>
                          <td className="qc-num">{plain(result.totalLbs, 0)}</td>
                          <td className="qc-num">{money(plan.totalValue, destination.quoteCurrency, 0)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </section>
              )}

              {/* breakdown */}
              {isAdmin && (
                <section className="qc-panel">
                  <div className="qc-panel-head">
                    <h2 className="qc-panel-title">
                      Cost breakdown <span className="qc-adminchip">Admin only</span>
                    </h2>
                    <button
                      type="button"
                      className={`fc-btn fc-btn-ghost qc-working-toggle${showWorking ? ' is-on' : ''}`}
                      onClick={() => setShowWorking((on) => !on)}
                      aria-pressed={showWorking}
                    >
                      {showWorking ? 'Hide the arithmetic' : 'Check the arithmetic'}
                    </button>
                  </div>
                  {audit && (
                    <div className={`qc-reconcile${audit.check.matches ? '' : ' is-bad'}`}>
                      <span className="qc-reconcile-mark" aria-hidden="true">
                        {audit.check.matches ? '\u2713' : '\u2715'}
                      </span>
                      <span>
                        {audit.check.matches ? (
                          <>
                            The lines below add up. Green coffee {cents(audit.check.greenCoffeeUsdPerLb)} +
                            every included line {cents(audit.check.includedLinesUsdPerLb)} ={' '}
                            {cents(audit.check.rebuiltTotalUsdPerLb)}, which is the total the ladder was
                            priced from.
                          </>
                        ) : (
                          <>
                            The lines below do not add up to the total used for pricing. Adding them back
                            gives {cents(audit.check.rebuiltTotalUsdPerLb)} against a reported{' '}
                            {cents(audit.check.reportedTotalUsdPerLb)} — a gap of{' '}
                            {cents(audit.check.differenceUsdPerLb, 4)}/lb. Do not quote from this.
                          </>
                        )}
                      </span>
                    </div>
                  )}
                  <div className="qc-table-wrap">
                    <table className="qc-table">
                      <thead>
                        <tr>
                          <th>Line</th><th>Currency</th>
                          <th className="qc-num">Invoiced</th><th className="qc-num">Per lb (native)</th>
                          <th className="qc-num">USD/lb</th><th className="qc-num">¢/lb</th><th className="qc-num">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="qc-group-row"><td colSpan={7}>Green coffee</td></tr>
                        <tr>
                          <td>KC</td><td>Market</td>
                          <td className="qc-num">{cents(input.kcUsdPerLb)}</td><td className="qc-num">—</td>
                          <td className="qc-num">{plain(input.kcUsdPerLb, 4)}</td>
                          <td className="qc-num">{cents(input.kcUsdPerLb)}</td>
                          <td className="qc-num">{percent(input.kcUsdPerLb / result.totalCostUsdPerLb, 0)}</td>
                        </tr>
                        {showWorking && (
                          <tr className="qc-trace-row">
                            <td colSpan={7}>
                              {plain(input.kcUsdPerLb * 100, 2)}&cent;/lb entered at the top of the quote
                              &divide; 100 = {plain(input.kcUsdPerLb, 6)} USD/lb
                            </td>
                          </tr>
                        )}
                        <tr>
                          <td>Quality premium</td><td>Market</td>
                          <td className="qc-num">{cents(input.premiumUsdPerLb)}</td><td className="qc-num">—</td>
                          <td className="qc-num">{plain(input.premiumUsdPerLb, 4)}</td>
                          <td className="qc-num">{cents(input.premiumUsdPerLb)}</td>
                          <td className="qc-num">{percent(input.premiumUsdPerLb / result.totalCostUsdPerLb, 0)}</td>
                        </tr>
                        {showWorking && (
                          <tr className="qc-trace-row">
                            <td colSpan={7}>
                              {plain(input.premiumUsdPerLb * 100, 2)}&cent;/lb set for this month under
                              KC &amp; premiums &divide; 100 = {plain(input.premiumUsdPerLb, 6)} USD/lb
                            </td>
                          </tr>
                        )}
                        {result.typePremiumUsdPerLb !== 0 && (
                          <>
                            <tr>
                              <td>{result.typeLabel}</td><td>Coffee type</td>
                              <td className="qc-num">{cents(result.typePremiumUsdPerLb)}</td>
                              <td className="qc-num">—</td>
                              <td className="qc-num">{plain(result.typePremiumUsdPerLb, 4)}</td>
                              <td className="qc-num">{cents(result.typePremiumUsdPerLb)}</td>
                              <td className="qc-num">
                                {percent(result.typePremiumUsdPerLb / result.totalCostUsdPerLb, 1)}
                              </td>
                            </tr>
                            {showWorking && (
                              <tr className="qc-trace-row">
                                <td colSpan={7}>
                                  <span className="qc-trace-source">Coffee types</span>
                                  {plain(result.typePremiumUsdPerLb * 100, 2)}&cent;/lb for{' '}
                                  {result.typeLabel} &divide; 100 ={' '}
                                  {plain(result.typePremiumUsdPerLb, 6)} USD/lb
                                </td>
                              </tr>
                            )}
                          </>
                        )}
                        {result.lines.map((line, i) => {
                          const prev = result.lines[i - 1];
                          const newGroup = !prev || prev.group !== line.group;
                          const digits = Math.abs(line.nativeAmount) >= 1000 ? 0 : Math.abs(line.nativeAmount) >= 1 ? 2 : 4;
                          return (
                            <Fragment key={line.key}>
                              {newGroup && (
                                <tr className="qc-group-row">
                                  <td colSpan={7}>
                                    {GROUP_LABEL[line.group]}
                                    {line.group === 'hold' && result.billableMonths > 0 &&
                                      ` — ${result.billableMonths} month${result.billableMonths === 1 ? '' : 's'} billed`}
                                  </td>
                                </tr>
                              )}
                              <tr className={line.included ? '' : 'qc-line-excluded'}>
                                <td>{line.label}</td>
                                <td className={line.included ? '' : 'qc-reason'} style={{ whiteSpace: 'normal' }}>
                                  {line.included ? line.currency : line.excludedReason}
                                </td>
                                <td className="qc-num">{line.nativePerLb === null ? '—' : plain(line.nativeAmount, digits)}</td>
                                <td className="qc-num">{line.nativePerLb === null ? '—' : plain(line.nativePerLb, line.currency === 'COP' ? 2 : 4)}</td>
                                <td className="qc-num">{line.included ? plain(line.usdPerLb, 4) : '—'}</td>
                                <td className="qc-num">{line.included ? cents(line.usdPerLb, 3) : '—'}</td>
                                <td className="qc-num">{line.included ? percent(line.usdPerLb / result.totalCostUsdPerLb, 1) : '—'}</td>
                              </tr>
                              {showWorking && (
                                <tr className="qc-trace-row">
                                  <td colSpan={7}>
                                    <span className="qc-trace-source">{line.trace.source}</span>
                                    {line.included
                                      ? lineWorking(line)
                                      : `Left out — ${line.excludedReason ?? 'not applicable'}. Had it counted: ${lineWorking(line)}`}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                      <tfoot className="qc-total">
                        <tr>
                          <td>Total cost</td>
                          <td colSpan={3} style={{ fontWeight: 400, color: 'var(--fc-ink-500)', whiteSpace: 'normal' }}>
                            Green coffee {cents(result.greenCoffeeUsdPerLb)} + differential {cents(result.differentialUsdPerLb)}
                            {result.financeUsdPerLb > 0 && ` + finance ${cents(result.financeUsdPerLb)}`}
                          </td>
                          <td className="qc-num">{plain(result.totalCostUsdPerLb, 4)}</td>
                          <td className="qc-num">{cents(result.totalCostUsdPerLb)}</td>
                          <td className="qc-num">100%</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {showWorking && audit && (
                    <div className="qc-working">
                      <div className="qc-working-head">
                        <h3 className="qc-working-title">From cost to quoted price</h3>
                        <label className="qc-working-pick">
                          <span>At</span>
                          <select
                            className="qc-input"
                            value={auditMargin}
                            onChange={(e) => setAuditMargin(Number(e.target.value))}
                            aria-label="Margin to trace"
                          >
                            {result.ladder.map((r) => (
                              <option key={r.margin} value={r.margin}>{marginLabel(r.margin)}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <ol className="qc-derive-list">
                        {audit.steps.map((step, i) => (
                          <li key={step.label} className="qc-derive">
                            <span className="qc-derive-no">{i + 1}</span>
                            <span className="qc-derive-body">
                              <span className="qc-derive-label">{step.label}</span>
                              <span className="qc-derive-detail">{step.detail}</span>
                            </span>
                            <span className="qc-derive-value">{stepValue(step, result.quoteCurrency, result.quoteUnit)}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  <p className="qc-footnote">
                    {cents(result.copExposureUsdPerLb)}/lb of the differential is peso-denominated —{' '}
                    {percent(result.copExposureUsdPerLb / (result.differentialUsdPerLb || 1), 0)} of it. At a TRM of{' '}
                    {plain(1 / reference.fx.COP, 0)} that share moves with every point of FX.
                  </p>
                </section>
              )}

              <div className="qc-export">
                <div className="qc-export-copy">
                  <span className="qc-export-title">Send this quote</span>
                  <span className="qc-export-sub">
                    {result.band.belowPolicy && !isAdmin
                      ? `Under ${settings.volumeBrackets[0]?.fromBags} bags this quote cannot be sent without admin.`
                      : 'A one-page sheet with the terms and the price. No costs, no margin.'}{' '}
                    <button type="button" className="qc-keyhint" onClick={() => setShortcutsOpen(true)}>
                      Press <kbd>?</kbd> for shortcuts
                    </button>
                  </span>
                </div>
                <button
                  type="button"
                  className="fc-btn fc-btn-navy"
                  onClick={() => setSheet(buildSheet())}
                  disabled={result.band.belowPolicy && !isAdmin}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 3v12M7 11l5 5 5-5M4 21h16" />
                  </svg>
                  Download quote
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <QuoteSheetDialog data={sheet} onClose={() => setSheet(null)} />
      <ShortcutSheet open={shortcutsOpen} shortcuts={shortcuts} onClose={() => setShortcutsOpen(false)} />
    </>
  );
}

/**
 * One cost line's arithmetic, written the way it would be checked by hand:
 * the amount as it is stored in admin, the divisor, the months, the rate.
 */
function lineWorking(line: CostLineResult): string {
  const t = line.trace;

  if (t.basis === 'rate') {
    if (!t.rate) return 'A rate on the cargo value. Not charged on this quote.';
    return (
      `${percent(t.rate.monthlyRate, 2)} per month x ${t.rate.months} ` +
      `month${t.rate.months === 1 ? '' : 's'} x ${plain(t.rate.chargedOnUsdPerLb, 4)} USD/lb of cargo ` +
      `(the coffee plus every other included line) = ${plain(line.usdPerLb, 6)} USD/lb`
    );
  }

  const digits = Math.abs(line.nativeAmount) >= 1000 ? 0 : Math.abs(line.nativeAmount) >= 1 ? 2 : 4;
  const parts: string[] = [
    t.basis === 'per_unit'
      ? `${plain(line.nativeAmount, digits)} ${line.currency} / ${plain(t.lbsPerUnit, 1)} lb`
      : `${plain(line.nativeAmount, 4)} ${line.currency} per lb`,
  ];
  if (t.monthsApplied !== 1) parts.push(`x ${t.monthsApplied} month${t.monthsApplied === 1 ? '' : 's'} held`);
  if (line.currency !== 'USD') parts.push(`x ${plain(t.fxUsdPerUnit, 6)} USD per ${line.currency}`);
  return `${parts.join(' ')} = ${plain(line.included ? line.usdPerLb : 0, 6)} USD/lb`;
}

/** A derivation step in whichever unit that step happens to be in. */
function stepValue(step: PriceStep, currency: CurrencyCode, unit: QuoteUnit): string {
  if (step.kind === 'ratio') return percent(step.value, 2);
  if (step.kind === 'usdTotal') return money(step.value, 'USD', 0);
  if (step.kind === 'quotePrice') return `${money(step.value, currency, PRICE_DP)}/${UNIT_LABEL[unit]}`;
  return `${plain(step.value, 6)} USD/lb`;
}

const GROUP_LABEL: Record<string, string> = {
  fob: 'Origin & FOB',
  freight: 'Ocean freight',
  import: 'Destination',
  hold: 'Holding the contract',
};
