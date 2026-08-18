'use client';

import { useCallback, useMemo, useState } from 'react';
import NumberInput from './NumberInput';
import PriceText from './PriceText';
import QuoteSheetDialog from './QuoteSheetDialog';
import { calculateContract, marginAtPrice, priceAtMargin } from '@/lib/pricing/engine';
import { INCOTERMS, type Incoterm, type QuoteInput, type ReferenceData, type Shipment } from '@/lib/pricing/types';
import { PRICE_DP, UNIT_LABEL, ceilPrice, fromQuoteUnit, toQuoteUnit, totalInQuoteCurrency } from '@/lib/pricing/units';
import { monthLabel, monthSpan, type CalendarMonth } from '@/lib/pricing/schedule';
import { cents, money, percent, plain } from '@/lib/format';
import { draftReference, type QuoteSheetData } from '@/lib/quoteSheet';

const marginLabel = (m: number) => `${(m * 100).toFixed((m * 100) % 1 === 0 ? 0 : 1)}%`;

export default function MultiShipmentBuilder({
  reference,
  months,
  defaultPremiumCents,
}: {
  reference: ReferenceData;
  months: CalendarMonth[];
  defaultPremiumCents: number;
}) {
  const [clientName, setClientName] = useState('');
  const [destinationKey, setDestinationKey] = useState(reference.destinations[0]?.key ?? '');
  const [incoterm, setIncoterm] = useState<Incoterm>('DDP');
  const [processKey, setProcessKey] = useState(reference.processes[0]?.key ?? '');
  const [packagingKey, setPackagingKey] = useState(
    reference.packaging.find((p) => p.traderDefault)?.key ?? reference.packaging[0]?.key ?? '',
  );
  const [premiumCents, setPremiumCents] = useState(String(defaultPremiumCents || ''));
  const [fromMonth, setFromMonth] = useState(months[0]?.key ?? '');
  const [toMonth, setToMonth] = useState(months[11]?.key ?? months[months.length - 1]?.key ?? '');
  const [holdMonths, setHoldMonths] = useState(6);
  const [waiveFixedCost, setWaiveFixedCost] = useState(false);
  const [margin, setMargin] = useState('16');
  const [target, setTarget] = useState('');
  const [sheet, setSheet] = useState<QuoteSheetData | null>(null);

  const [shipments, setShipments] = useState<Shipment[]>([
    { id: 's1', label: monthLabel(months[0]?.key ?? ''), kcCents: 185.5, bags: 280 },
    { id: 's2', label: monthLabel(months[3]?.key ?? ''), kcCents: 190.25, bags: 280 },
    { id: 's3', label: monthLabel(months[6]?.key ?? ''), kcCents: 193.8, bags: 280 },
  ]);
  const nextId = () => `s${Date.now().toString(36)}`;

  const safeTo = toMonth >= fromMonth ? toMonth : fromMonth;
  const span = monthSpan(fromMonth, safeTo);
  const holdCap = Math.min(12, span);
  const effectiveHold = Math.min(holdMonths, holdCap);

  const base: Omit<QuoteInput, 'bags' | 'kcUsdPerLb'> = useMemo(
    () => ({
      destinationKey,
      incoterm,
      processKey,
      packagingKey,
      premiumUsdPerLb: (Number(premiumCents) || 0) / 100,
      holdMonths: effectiveHold,
      fromMonth,
      toMonth: safeTo,
      waiveFixedCost,
    }),
    [destinationKey, incoterm, processKey, packagingKey, premiumCents, effectiveHold, fromMonth, safeTo, waiveFixedCost],
  );

  const marginValue = (Number(margin) || 0) / 100;

  const { contract, error } = useMemo(() => {
    try {
      return { contract: calculateContract(shipments, base, marginValue, reference), error: null as string | null };
    } catch (e) {
      return { contract: null, error: (e as Error).message };
    }
  }, [shipments, base, marginValue, reference]);

  const destination = reference.destinations.find((d) => d.key === destinationKey);
  const unitLabel = destination ? `${destination.quoteCurrency}/${UNIT_LABEL[destination.quoteUnit]}` : '';
  const settings = reference.settings;

  const update = useCallback(
    (id: string, field: 'label' | 'kcCents' | 'bags', value: string | number) => {
      setShipments((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
    },
    [],
  );

  const solvedTarget = useMemo(() => {
    if (!contract || !destination || target.trim() === '') return null;
    const usdPerLb = fromQuoteUnit(Number(target), destination.quoteCurrency, destination.quoteUnit, reference.fx);
    if (!Number.isFinite(usdPerLb)) return null;
    const implied = marginAtPrice(
      usdPerLb, contract.weightedCostUsdPerLb, contract.weightedMarginBaseUsdPerLb, settings.marginMode,
    );
    return {
      usdPerLb,
      implied,
      belowCost: usdPerLb < contract.weightedCostUsdPerLb,
      belowFloor: implied < settings.minMargin,
      perShipment: contract.shipments.map((s) => ({
        label: s.label,
        price: ceilPrice(
          toQuoteUnit(
            priceAtMargin(implied, s.result.totalCostUsdPerLb, s.result.marginBaseUsdPerLb, settings.marginMode),
            destination.quoteCurrency, destination.quoteUnit, reference.fx,
          ),
        ),
      })),
    };
  }, [contract, destination, target, reference.fx, settings]);

  const buildSheet = useCallback((): QuoteSheetData | null => {
    if (!contract || !destination) return null;
    const unit = UNIT_LABEL[destination.quoteUnit];
    return {
      title: 'Multi-shipment quote',
      client: clientName || '—',
      reference: draftReference(Date.now()),
      terms: [
        ['Destination', destination.label],
        ['Incoterm', incoterm],
        ['Process', reference.processes.find((p) => p.key === processKey)?.label ?? ''],
        ['Packaging', reference.packaging.find((p) => p.key === packagingKey)?.label ?? ''],
        ['Quantity', `${plain(contract.totalBags, 0)} bags · ${plain(contract.totalLbs, 0)} lb`],
        ['Shipment window', `${monthLabel(fromMonth)} – ${monthLabel(safeTo)}`],
        ['Contract held', `${effectiveHold} month${effectiveHold === 1 ? '' : 's'}`],
      ],
      priceLabel: `Blended price per ${unit}`,
      price: money(contract.consolidatedDisplay, destination.quoteCurrency, PRICE_DP),
      priceSub: `${cents(contract.consolidatedUsdPerLb)} per lb`,
      valueLabel: 'Contract value',
      value: money(
        totalInQuoteCurrency(contract.totalValueUsd, destination.quoteCurrency, reference.fx),
        destination.quoteCurrency, 0,
      ),
      basis: `Priced against a weighted KC of ${cents(contract.weightedKcUsdPerLb)} per lb.`,
      rows: {
        title: 'Shipment plan',
        head: ['Shipment', 'Bags', `Price ${destination.quoteCurrency}/${unit}`, `Value ${destination.quoteCurrency}`],
        body: contract.shipments.map((s) => [
          s.label || '—',
          plain(s.bags, 0),
          money(s.displayPrice, destination.quoteCurrency, PRICE_DP),
          money(totalInQuoteCurrency(s.valueUsd, destination.quoteCurrency, reference.fx), destination.quoteCurrency, 0),
        ]),
      },
    };
  }, [contract, destination, clientName, incoterm, reference, processKey, packagingKey, fromMonth, safeTo, effectiveHold]);

  const inQuote = (usd: number) =>
    destination ? totalInQuoteCurrency(usd, destination.quoteCurrency, reference.fx) : usd;

  return (
    <>
      <div className="qc-market">
        <div className="qc-market-grid">
          <div>
            <span className="qc-market-label">Shipping from</span>
            <select
              aria-label="First shipment month" value={fromMonth}
              onChange={(e) => { setFromMonth(e.target.value); if (e.target.value > toMonth) setToMonth(e.target.value); }}
            >
              {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <p className="qc-market-hint">{span} month{span === 1 ? '' : 's'} of shipments</p>
          </div>
          <div>
            <span className="qc-market-label">Shipping to</span>
            <select aria-label="Last shipment month" value={safeTo} onChange={(e) => setToMonth(e.target.value)}>
              {months.filter((m) => m.key >= fromMonth).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <p className="qc-market-hint">{monthLabel(fromMonth)} – {monthLabel(safeTo)}</p>
          </div>
          <div>
            <span className="qc-market-label">Contract held for</span>
            <select
              aria-label="Months each shipment is held" value={effectiveHold}
              onChange={(e) => setHoldMonths(Number(e.target.value))}
            >
              {Array.from({ length: holdCap }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n} month{n === 1 ? '' : 's'}</option>
              ))}
            </select>
            <p className={`qc-market-hint ${incoterm === 'DDP' && effectiveHold > settings.freeHoldMonths ? 'is-charged' : 'is-free'}`}>
              {incoterm !== 'DDP'
                ? `Not charged on ${incoterm} — the buyer carries the coffee.`
                : effectiveHold > settings.freeHoldMonths
                  ? `${effectiveHold - settings.freeHoldMonths} month${effectiveHold - settings.freeHoldMonths === 1 ? '' : 's'} billed per shipment.`
                  : `No storage or finance — covered by the fixed cost up to ${settings.freeHoldMonths} months.`}
            </p>
          </div>
          <div>
            <span className="qc-market-label">Premium ¢/lb <span className="qc-adminchip">Admin</span></span>
            <input
              type="number" step="any" inputMode="decimal" aria-label="Quality premium"
              value={premiumCents} onChange={(e) => setPremiumCents(e.target.value)}
            />
            <p className="qc-market-hint">Applies to every shipment</p>
          </div>
        </div>
      </div>

      <section className="qc-panel">
        <div className="qc-panel-head">
          <h2 className="qc-panel-title">Shared terms</h2>
          <span className="qc-panel-note">Everything except KC and quantity is common to all shipments</span>
        </div>
        <div className="qc-panel-body">
          <div className="qc-fields">
            <div className="qc-field wide">
              <label className="qc-label" htmlFor="m-client">Client</label>
              <input id="m-client" className="qc-input" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client name" />
            </div>
            <div className="qc-field">
              <label className="qc-label" htmlFor="m-dest">Destination</label>
              <select id="m-dest" className="qc-select" value={destinationKey} onChange={(e) => setDestinationKey(e.target.value)}>
                {reference.destinations.map((d) => (
                  <option key={d.key} value={d.key}>{d.label} — {d.quoteCurrency}/{UNIT_LABEL[d.quoteUnit]}</option>
                ))}
              </select>
            </div>
            <div className="qc-field">
              <label className="qc-label" htmlFor="m-process">Process</label>
              <select id="m-process" className="qc-select" value={processKey} onChange={(e) => setProcessKey(e.target.value)}>
                {reference.processes.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <div className="qc-field">
              <label className="qc-label" htmlFor="m-pack">Packaging</label>
              <select id="m-pack" className="qc-select" value={packagingKey} onChange={(e) => setPackagingKey(e.target.value)}>
                {reference.packaging.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <div className="qc-field">
              <span className="qc-label">Incoterm</span>
              <div className="qc-seg" role="group" aria-label="Incoterm">
                {INCOTERMS.map((t) => (
                  <button key={t} type="button" aria-pressed={incoterm === t} onClick={() => setIncoterm(t)}>{t}</button>
                ))}
              </div>
            </div>
            <div className="qc-field wide">
              <label className="qc-switch" htmlFor="m-waive">
                <input type="checkbox" id="m-waive" checked={waiveFixedCost} onChange={(e) => setWaiveFixedCost(e.target.checked)} />
                <span className="qc-switch-track"><span className="qc-switch-thumb" /></span>
                <span className="qc-switch-body">
                  <span className="qc-switch-title">Waive fixed cost <span className="qc-adminchip">Admin</span></span>
                  <span className="qc-switch-sub">Drops the 30¢/lb recovery across every shipment</span>
                </span>
              </label>
            </div>
          </div>
        </div>
      </section>

      {error && <div className="qc-warn">{error}</div>}

      {contract && destination && (
        <>
          <section className="qc-panel qc-shipments">
            <div className="qc-panel-head">
              <h2 className="qc-panel-title">Shipments</h2>
              <button
                type="button" className="fc-btn fc-btn-ghost"
                onClick={() =>
                  setShipments((prev) => [
                    ...prev,
                    { id: nextId(), label: `Shipment ${prev.length + 1}`, kcCents: prev.at(-1)?.kcCents ?? 190, bags: prev.at(-1)?.bags ?? 280 },
                  ])
                }
              >
                + Add shipment
              </button>
            </div>
            <div className="qc-ship-table qc-table-wrap">
              <table className="qc-table">
                <thead>
                  <tr>
                    <th>Shipment</th>
                    <th className="qc-num">KC ¢/lb</th>
                    <th className="qc-num">Bags</th>
                    <th className="qc-num">Pounds</th>
                    <th className="qc-num">Cost ¢/lb</th>
                    <th className="qc-num">Price {unitLabel}</th>
                    <th className="qc-num">Value</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {contract.shipments.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <input
                          className="qc-input month" aria-label="Shipment name"
                          value={s.label} onChange={(e) => update(s.id, 'label', e.target.value)}
                        />
                      </td>
                      <td className="qc-num">
                        <NumberInput
                          className="qc-input num kc" step="any" inputMode="decimal" aria-label="KC price"
                          value={s.kcCents} onValueChange={(v) => update(s.id, 'kcCents', v)}
                        />
                      </td>
                      <td className="qc-num">
                        <NumberInput
                          className="qc-input num bags" step={1} min={0} inputMode="numeric" aria-label="Bags"
                          value={s.bags} onValueChange={(v) => update(s.id, 'bags', v)}
                        />
                      </td>
                      <td className="qc-num">{plain(s.result.totalLbs, 0)}</td>
                      <td className="qc-num">{cents(s.result.totalCostUsdPerLb)}</td>
                      <td className="qc-price-cell"><PriceText value={s.displayPrice} currency={destination.quoteCurrency} /></td>
                      <td className="qc-num">{money(inQuote(s.valueUsd), destination.quoteCurrency, 0)}</td>
                      <td>
                        <button
                          type="button" className="qc-rowdel" aria-label="Remove shipment"
                          disabled={contract.shipments.length <= 1}
                          onClick={() => setShipments((prev) => prev.filter((x) => x.id !== s.id))}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="qc-ship-cards">
              {contract.shipments.map((s) => (
                <div className="qc-ship-card" key={s.id}>
                  <div className="qc-ship-card-head">
                    <span className="qc-ship-card-title">Shipment</span>
                    <button
                      type="button" className="qc-rowdel" aria-label="Remove shipment"
                      disabled={contract.shipments.length <= 1}
                      onClick={() => setShipments((prev) => prev.filter((x) => x.id !== s.id))}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                      </svg>
                    </button>
                  </div>
                  <div className="full">
                    <span className="qc-label">Name</span>
                    <input className="qc-input" aria-label="Shipment name" value={s.label} onChange={(e) => update(s.id, 'label', e.target.value)} />
                  </div>
                  <div>
                    <span className="qc-label">KC ¢/lb</span>
                    <NumberInput className="qc-input num" step="any" inputMode="decimal" aria-label="KC price" value={s.kcCents} onValueChange={(v) => update(s.id, 'kcCents', v)} />
                  </div>
                  <div>
                    <span className="qc-label">Bags</span>
                    <NumberInput className="qc-input num" step={1} min={0} inputMode="numeric" aria-label="Bags" value={s.bags} onValueChange={(v) => update(s.id, 'bags', v)} />
                  </div>
                  <div className="full qc-rung-meta" style={{ margin: 0 }}>
                    <span>{plain(s.result.totalLbs, 0)} lb</span>
                    <span>cost {cents(s.result.totalCostUsdPerLb)}</span>
                    <span className="qc-ship-card-price"><PriceText value={s.displayPrice} currency={destination.quoteCurrency} /></span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="qc-consolidated">
            <div className="qc-cons-grid">
              <div>
                <div className="qc-hero-label">Consolidated price at {marginLabel(marginValue)}</div>
                <div className="qc-hero-price">
                  <span className="qc-hero-big"><PriceText value={contract.consolidatedDisplay} currency={destination.quoteCurrency} /></span>
                  <span className="qc-hero-unit">per {UNIT_LABEL[destination.quoteUnit]} · {destination.label} {incoterm}</span>
                </div>
                <div className="qc-hero-sub">
                  <span className="fc-pill">{cents(contract.consolidatedUsdPerLb)}/lb blended</span>
                  <span className="fc-pill">KC +{cents(contract.consolidatedUsdPerLb - contract.weightedKcUsdPerLb)} avg</span>
                  <span className="fc-pill">break-even {cents(contract.weightedCostUsdPerLb)}</span>
                  {contract.shipments[0]?.result.waivedFixedCost && <span className="qc-waived-flag">Fixed cost waived</span>}
                </div>
              </div>
              <dl className="qc-cons-side">
                <div className="qc-cons-item"><dt>Shipments</dt><dd>{contract.shipments.length}</dd></div>
                <div className="qc-cons-item"><dt>Total volume</dt><dd>{plain(contract.totalBags, 0)} bags</dd></div>
                <div className="qc-cons-item"><dt>Weighted KC</dt><dd>{cents(contract.weightedKcUsdPerLb)}</dd></div>
                <div className="qc-cons-item"><dt>Contract value</dt><dd>{money(inQuote(contract.totalValueUsd), destination.quoteCurrency, 0)}</dd></div>
              </dl>
            </div>
          </div>

          {contract.warnings.length > 0 && (
            <div className="qc-warns">
              {contract.warnings.map((w) => (
                <div className="qc-warn" key={w.text}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 9v4M12 17h.01" />
                    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                  </svg>
                  <span>{w.text}</span>
                </div>
              ))}
            </div>
          )}

          <div className="qc-solvers">
            <section className="qc-panel qc-solver">
              <div className="qc-panel-body">
                <div className="qc-solver-head">
                  <span className="qc-solver-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                  </span>
                  <h3>Margin → prices</h3>
                </div>
                <p className="qc-solver-sub">Sets the margin on every shipment. The table and the blended price follow.</p>
                <div className="qc-inputrow">
                  <input className="qc-input num" type="number" step="any" inputMode="decimal" aria-label="Target margin percent" value={margin} onChange={(e) => setMargin(e.target.value)} />
                  <span className="qc-suffix">%</span>
                </div>
                <div className="qc-answer">
                  <div className={`qc-answer-big${marginValue < settings.minMargin ? ' is-warn' : ''}`}>
                    <PriceText value={contract.consolidatedDisplay} currency={destination.quoteCurrency} />
                  </div>
                  <div className="qc-answer-meta">
                    Blended across {contract.shipments.length} shipments · per-shipment{' '}
                    {money(Math.min(...contract.shipments.map((s) => s.displayPrice)), destination.quoteCurrency, PRICE_DP)} to{' '}
                    {money(Math.max(...contract.shipments.map((s) => s.displayPrice)), destination.quoteCurrency, PRICE_DP)}
                    <br />
                    {money(inQuote(contract.totalValueUsd), destination.quoteCurrency, 0)} contract value
                  </div>
                  {marginValue < settings.minMargin && (
                    <div className="qc-verdict is-warn">Under the {marginLabel(settings.minMargin)} floor</div>
                  )}
                </div>
              </div>
            </section>

            <section className="qc-panel qc-solver">
              <div className="qc-panel-body">
                <div className="qc-solver-head">
                  <span className="qc-solver-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
                  </span>
                  <h3>Consolidated price → margin</h3>
                </div>
                <p className="qc-solver-sub">Name one blended price for the whole contract and see the margin it leaves.</p>
                <div className="qc-inputrow">
                  <input
                    className="qc-input num" type="number" step="any" inputMode="decimal" aria-label="Target consolidated price"
                    placeholder={plain(contract.consolidatedDisplay, PRICE_DP)}
                    value={target} onChange={(e) => setTarget(e.target.value)}
                  />
                  <span className="qc-suffix">{unitLabel}</span>
                </div>
                {!solvedTarget ? (
                  <div className="qc-answer is-empty">Enter a blended price to see the margin.</div>
                ) : (
                  <div className="qc-answer">
                    <div className={`qc-answer-big ${solvedTarget.belowCost ? 'is-bad' : solvedTarget.belowFloor ? 'is-warn' : 'is-ok'}`}>
                      {percent(solvedTarget.implied, 2)}
                    </div>
                    <div className="qc-answer-meta">
                      {solvedTarget.perShipment.map((s) => `${s.label}: ${money(s.price, destination.quoteCurrency, PRICE_DP)}`).join(' · ')}
                    </div>
                    <div className={`qc-verdict ${solvedTarget.belowCost ? 'is-bad' : solvedTarget.belowFloor ? 'is-warn' : 'is-ok'}`}>
                      {solvedTarget.belowCost
                        ? 'Below blended break-even — this loses money'
                        : solvedTarget.belowFloor
                          ? `Under the ${marginLabel(settings.minMargin)} floor`
                          : 'Clears the floor'}
                    </div>
                    <div className="qc-actions">
                      <button
                        type="button" className="fc-btn fc-btn-ghost"
                        onClick={() => setMargin((solvedTarget.implied * 100).toFixed(2))}
                      >
                        Apply to all shipments
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          <section className="qc-panel">
            <div className="qc-panel-head">
              <h2 className="qc-panel-title">Per-shipment breakdown <span className="qc-adminchip">Admin only</span></h2>
            </div>
            <div className="qc-table-wrap">
              <table className="qc-table">
                <thead>
                  <tr>
                    <th>Shipment</th><th className="qc-num">KC</th><th className="qc-num">Premium</th>
                    <th className="qc-num">Differential</th><th className="qc-num">Cost</th>
                    <th className="qc-num">Price</th><th className="qc-num">Margin/lb</th><th className="qc-num">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {contract.shipments.map((s) => (
                    <tr key={s.id}>
                      <td>{s.label}</td>
                      <td className="qc-num">{cents(s.kcCents / 100)}</td>
                      <td className="qc-num">{cents(base.premiumUsdPerLb)}</td>
                      <td className="qc-num">{cents(s.result.differentialUsdPerLb + s.result.financeUsdPerLb)}</td>
                      <td className="qc-num">{cents(s.result.totalCostUsdPerLb)}</td>
                      <td className="qc-num">{cents(s.priceUsdPerLb)}</td>
                      <td className="qc-num">{cents(s.priceUsdPerLb - s.result.totalCostUsdPerLb)}</td>
                      <td className="qc-num">{money(inQuote(s.valueUsd), destination.quoteCurrency, 0)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="qc-total">
                  <tr>
                    <td>Blended</td>
                    <td className="qc-num">{cents(contract.weightedKcUsdPerLb)}</td>
                    <td className="qc-num">{cents(base.premiumUsdPerLb)}</td>
                    <td className="qc-num">—</td>
                    <td className="qc-num">{cents(contract.weightedCostUsdPerLb)}</td>
                    <td className="qc-num">{cents(contract.consolidatedUsdPerLb)}</td>
                    <td className="qc-num">{cents(contract.consolidatedUsdPerLb - contract.weightedCostUsdPerLb)}</td>
                    <td className="qc-num">{money(inQuote(contract.totalValueUsd), destination.quoteCurrency, 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <div className="qc-export">
            <div className="qc-export-copy">
              <span className="qc-export-title">Send this quote</span>
              <span className="qc-export-sub">A one-page sheet with the terms and the price. No costs, no margin.</span>
            </div>
            <button type="button" className="fc-btn fc-btn-navy" onClick={() => setSheet(buildSheet())}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3v12M7 11l5 5 5-5M4 21h16" />
              </svg>
              Download quote
            </button>
          </div>
        </>
      )}

      <QuoteSheetDialog data={sheet} onClose={() => setSheet(null)} />
    </>
  );
}
