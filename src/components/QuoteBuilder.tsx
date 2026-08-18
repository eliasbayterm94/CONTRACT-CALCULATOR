'use client';

import { useMemo, useState, useTransition } from 'react';
import { calculateQuote, solveForMargin, solveForPrice } from '@/lib/pricing/engine';
import type { Incoterm, QuoteInput, ReferenceData } from '@/lib/pricing/types';
import { INCOTERMS } from '@/lib/pricing/types';
import { centsToUsd, fromQuoteUnit, toQuoteUnit, usdPerCopToTrm } from '@/lib/pricing/units';
import { cents, money, percent, plain, unitPrice } from '@/lib/format';
import { saveQuote } from '@/app/actions';
import type { ContractMonth } from '@/lib/kc';

interface Props {
  reference: ReferenceData;
  months: ContractMonth[];
  kcByMonth: Record<string, number>;
  premiumByMonth: Record<string, number>;
  lbsPerContainer: number;
}

type QuantityMode = QuoteInput['quantityMode'];

export default function QuoteBuilder({
  reference,
  months,
  kcByMonth,
  premiumByMonth,
  lbsPerContainer,
}: Props) {
  const { settings } = reference;
  const firstMonth = months[0]?.key ?? '';

  const [clientName, setClientName] = useState('');
  const [notes, setNotes] = useState('');
  const [destinationKey, setDestinationKey] = useState(reference.destinations[0]?.key ?? '');
  const [incoterm, setIncoterm] = useState<Incoterm>('FOB');
  const [processKey, setProcessKey] = useState(reference.processes[0]?.key ?? '');
  const [packagingKey, setPackagingKey] = useState(reference.packaging[0]?.key ?? '');
  const [quantity, setQuantity] = useState(1);
  const [quantityMode, setQuantityMode] = useState<QuantityMode>('containers');
  const [monthKey, setMonthKey] = useState(firstMonth);

  // KC and premium default to the admin-entered figure for the month, but the
  // trader can type a projected value to see where the price lands.
  const [kcOverride, setKcOverride] = useState<string>('');
  const [premiumOverride, setPremiumOverride] = useState<string>('');

  const [grainPro, setGrainPro] = useState(true);
  const [bagMarks, setBagMarks] = useState(true);
  const [storageOn, setStorageOn] = useState(false);
  const [storageMonths, setStorageMonths] = useState(3);
  const [financeOn, setFinanceOn] = useState(false);
  const [financeMonths, setFinanceMonths] = useState(3);

  const [marginInput, setMarginInput] = useState('');
  const [priceInput, setPriceInput] = useState('');

  const [saving, startSaving] = useTransition();
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const storedKcCents = kcByMonth[monthKey] ?? 0;
  const storedPremiumCents = premiumByMonth[monthKey] ?? 0;
  const kcIsProjected = kcOverride.trim() !== '' && Number(kcOverride) !== storedKcCents;
  const premiumIsOverridden =
    premiumOverride.trim() !== '' && Number(premiumOverride) !== storedPremiumCents;

  const effectiveKcCents =
    kcOverride.trim() === '' ? storedKcCents : Number(kcOverride) || 0;
  const effectivePremiumCents =
    premiumOverride.trim() === '' ? storedPremiumCents : Number(premiumOverride) || 0;

  const input: QuoteInput = useMemo(() => {
    const disabled: string[] = [];
    if (!grainPro) disabled.push('grain_pro');
    if (!bagMarks) disabled.push('bag_marks');
    const enabled: string[] = [];
    if (storageOn) enabled.push('storage');
    if (financeOn) enabled.push('finance');
    return {
      destinationKey,
      incoterm,
      processKey,
      packagingKey,
      quantity,
      quantityMode,
      lbsPerContainer,
      kcMonth: monthKey,
      kcPriceUsdPerLb: centsToUsd(effectiveKcCents),
      premiumUsdPerLb: centsToUsd(effectivePremiumCents),
      disabledLines: disabled,
      enabledLines: enabled,
      storageMonths: storageOn ? storageMonths : 0,
      financeMonths: financeOn ? financeMonths : 0,
    };
  }, [
    destinationKey,
    incoterm,
    processKey,
    packagingKey,
    quantity,
    quantityMode,
    lbsPerContainer,
    monthKey,
    effectiveKcCents,
    effectivePremiumCents,
    grainPro,
    bagMarks,
    storageOn,
    storageMonths,
    financeOn,
    financeMonths,
  ]);

  const { result, error } = useMemo(() => {
    try {
      return { result: calculateQuote(input, reference), error: null as string | null };
    } catch (e) {
      return { result: null, error: (e as Error).message };
    }
  }, [input, reference]);

  const destination = reference.destinations.find((d) => d.key === destinationKey);

  const solvedFromMargin = useMemo(() => {
    if (!result || marginInput.trim() === '') return null;
    const m = Number(marginInput) / 100;
    if (!Number.isFinite(m)) return null;
    return solveForMargin(m, result, settings);
  }, [result, marginInput, settings]);

  const solvedFromPrice = useMemo(() => {
    if (!result || priceInput.trim() === '' || !destination) return null;
    const typed = Number(priceInput);
    if (!Number.isFinite(typed)) return null;
    // The trader types the price in the unit the client is quoted in.
    const usdPerLb = fromQuoteUnit(
      typed,
      destination.quoteCurrency,
      destination.quoteUnit,
      reference.fx,
    );
    return { usdPerLb, ...solveForPrice(usdPerLb, result, settings) };
  }, [result, priceInput, destination, reference.fx, settings]);

  function onSave(margin: number | null, priceUsdPerLb: number | null) {
    setSaveMessage(null);
    startSaving(async () => {
      const res = await saveQuote({
        input,
        clientName,
        notes,
        chosenMargin: margin,
        chosenPriceUsdPerLb: priceUsdPerLb,
      });
      setSaveMessage(res.message);
    });
  }

  const trm = usdPerCopToTrm(reference.fx.COP);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      {/* ------------------------------------------------------------ inputs */}
      <section className="card p-4 lg:col-span-4">
        <h2 className="mb-3 text-sm font-bold">Contract</h2>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="field-label" htmlFor="client">
              Client
            </label>
            <input
              id="client"
              className="control"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Client name"
            />
          </div>

          <div className="col-span-2">
            <label className="field-label" htmlFor="destination">
              Destination
            </label>
            <select
              id="destination"
              className="control"
              value={destinationKey}
              onChange={(e) => setDestinationKey(e.target.value)}
            >
              {reference.destinations.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label} — quoted in {d.quoteCurrency}/{d.quoteUnit}
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-2">
            <span className="field-label">Incoterm</span>
            <div className="flex gap-1.5">
              {INCOTERMS.map((term) => {
                const allowed = destination?.allowedIncoterms.includes(term) ?? true;
                const active = incoterm === term;
                return (
                  <button
                    key={term}
                    type="button"
                    onClick={() => setIncoterm(term)}
                    disabled={!allowed}
                    className="btn flex-1"
                    style={
                      active
                        ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }
                        : undefined
                    }
                  >
                    {term}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="process">
              Process
            </label>
            <select
              id="process"
              className="control"
              value={processKey}
              onChange={(e) => setProcessKey(e.target.value)}
            >
              {reference.processes.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="packaging">
              Packaging
            </label>
            <select
              id="packaging"
              className="control"
              value={packagingKey}
              onChange={(e) => setPackagingKey(e.target.value)}
            >
              {reference.packaging.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="quantity">
              Quantity
            </label>
            <input
              id="quantity"
              className="control tnum"
              type="number"
              min={0}
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="quantityMode">
              Measured in
            </label>
            <select
              id="quantityMode"
              className="control"
              value={quantityMode}
              onChange={(e) => setQuantityMode(e.target.value as QuantityMode)}
            >
              <option value="containers">Containers</option>
              <option value="bags">Bags</option>
              <option value="lbs">Pounds</option>
            </select>
          </div>
        </div>

        <h2 className="mb-3 mt-6 text-sm font-bold">Market</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="field-label" htmlFor="month">
              KC contract month
            </label>
            <select
              id="month"
              className="control"
              value={monthKey}
              onChange={(e) => {
                setMonthKey(e.target.value);
                setKcOverride('');
                setPremiumOverride('');
              }}
            >
              {months.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                  {kcByMonth[m.key] ? ` — ${kcByMonth[m.key].toFixed(2)}¢` : ' — no price'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="kc">
              KC price ¢/lb
            </label>
            <input
              id="kc"
              className="control tnum"
              type="number"
              step="any"
              value={kcOverride === '' ? storedKcCents || '' : kcOverride}
              onChange={(e) => setKcOverride(e.target.value)}
              placeholder="0.00"
            />
            <p className="mt-1 text-[0.6875rem]" style={{ color: kcIsProjected ? 'var(--warn)' : 'var(--text-muted)' }}>
              {kcIsProjected
                ? `Projected — desk price is ${storedKcCents.toFixed(2)}¢`
                : 'From the desk'}
            </p>
          </div>

          <div>
            <label className="field-label" htmlFor="premium">
              Premium ¢/lb
            </label>
            <input
              id="premium"
              className="control tnum"
              type="number"
              step="any"
              value={premiumOverride === '' ? storedPremiumCents || '' : premiumOverride}
              onChange={(e) => setPremiumOverride(e.target.value)}
              placeholder="0.00"
            />
            <p
              className="mt-1 text-[0.6875rem]"
              style={{ color: premiumIsOverridden ? 'var(--warn)' : 'var(--text-muted)' }}
            >
              {premiumIsOverridden
                ? `Overridden — admin has ${storedPremiumCents.toFixed(2)}¢`
                : 'From admin'}
            </p>
          </div>

          {(kcIsProjected || premiumIsOverridden) && (
            <div className="col-span-2">
              <button
                type="button"
                className="btn w-full"
                onClick={() => {
                  setKcOverride('');
                  setPremiumOverride('');
                }}
              >
                Reset to desk figures
              </button>
            </div>
          )}
        </div>

        <h2 className="mb-3 mt-6 text-sm font-bold">Options</h2>
        <div className="space-y-2.5 text-[0.8125rem]">
          <Toggle label="Grain Pro liner" checked={grainPro} onChange={setGrainPro} />
          <Toggle label="Bag marks" checked={bagMarks} onChange={setBagMarks} />
          <ToggleWithMonths
            label="Storage"
            checked={storageOn}
            onChange={setStorageOn}
            months={storageMonths}
            onMonths={setStorageMonths}
          />
          <ToggleWithMonths
            label={`Finance (${percent(settings.financeMonthlyRate, 2)}/mo)`}
            checked={financeOn}
            onChange={setFinanceOn}
            months={financeMonths}
            onMonths={setFinanceMonths}
          />
        </div>

        <div className="mt-6">
          <label className="field-label" htmlFor="notes">
            Notes
          </label>
          <textarea
            id="notes"
            className="control"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Shipment window, quality, anything worth recording"
          />
        </div>

        <p className="mt-4 text-[0.6875rem]" style={{ color: 'var(--text-muted)' }}>
          TRM {plain(trm, 2)} · EUR {plain(reference.fx.EUR, 4)} · GBP {plain(reference.fx.GBP, 4)} ·
          AUD {plain(reference.fx.AUD, 4)} · CAD {plain(reference.fx.CAD, 4)}
        </p>
      </section>

      {/* ----------------------------------------------------------- results */}
      <div className="space-y-5 lg:col-span-8">
        {error && (
          <div
            className="card p-4 text-sm"
            style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
          >
            {error}
          </div>
        )}

        {result && destination && (
          <>
            <section className="card p-4">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Stat label="Break-even" value={unitPrice(
                  toQuoteUnit(result.totalCostUsdPerLb, destination.quoteCurrency, destination.quoteUnit, reference.fx),
                  destination.quoteCurrency,
                  destination.quoteUnit,
                )} sub={`${cents(result.totalCostUsdPerLb)}/lb`} />
                <Stat
                  label={`Floor price @ ${percent(settings.minMargin, 0)}`}
                  value={unitPrice(result.floor.displayPrice, destination.quoteCurrency, destination.quoteUnit)}
                  sub={`${cents(result.floor.priceUsdPerLb)}/lb`}
                  accent
                />
                <Stat
                  label="Differential over KC"
                  value={cents(result.differentialUsdPerLb)}
                  sub={`${percent(result.copExposureUsdPerLb / (result.differentialUsdPerLb || 1), 0)} in pesos`}
                />
                <Stat
                  label="Volume"
                  value={`${plain(result.totalLbs, 0)} lb`}
                  sub={`${plain(result.containers, 2)} containers · ${plain(result.bags, 0)} bags`}
                />
              </div>
            </section>

            {result.warnings.length > 0 && (
              <section
                className="card p-3 text-[0.8125rem]"
                style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}
              >
                <ul className="list-inside list-disc space-y-1">
                  {result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* ------------------------------------------------ margin ladder */}
            <section className="card">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b p-4">
                <h2 className="text-sm font-bold">Price ladder</h2>
                <p className="text-[0.75rem]" style={{ color: 'var(--text-muted)' }}>
                  Margin {settings.marginMode === 'on_price' ? 'as a share of price' : 'as a markup on cost'},
                  charged on {settings.marginBase === 'full_landed_cost' ? 'full landed cost' : 'the differential only'}
                </p>
              </div>
              <div className="scroll-x">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Margin</th>
                      <th className="num">Price {destination.quoteCurrency}/{destination.quoteUnit}</th>
                      <th className="num">USD/lb</th>
                      <th className="num">¢/lb</th>
                      <th className="num">Over KC</th>
                      <th className="num">Margin/lb</th>
                      <th className="num">Contract value</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {result.ladder.map((rung) => {
                      const isFloor = Math.abs(rung.margin - settings.minMargin) < 1e-9;
                      return (
                        <tr
                          key={rung.margin}
                          style={isFloor ? { background: 'var(--accent-soft)' } : undefined}
                        >
                          <td className="font-semibold">
                            {percent(rung.margin, 0)}
                            {isFloor && (
                              <span
                                className="ml-1.5 rounded px-1 py-0.5 text-[0.625rem] font-bold uppercase"
                                style={{ background: 'var(--accent)', color: '#fff' }}
                              >
                                Floor
                              </span>
                            )}
                          </td>
                          <td className="num tnum font-semibold">
                            {money(rung.displayPrice, destination.quoteCurrency, destination.quoteUnit === 'lb' ? 4 : 3)}
                          </td>
                          <td className="num tnum">{plain(rung.priceUsdPerLb, 4)}</td>
                          <td className="num tnum">{cents(rung.priceUsdPerLb)}</td>
                          <td className="num tnum">
                            {result.greenCoffeeUsdPerLb > 0
                              ? `+${cents(rung.priceUsdPerLb - centsToUsd(effectiveKcCents))}`
                              : '—'}
                          </td>
                          <td className="num tnum">{cents(rung.marginUsdPerLb)}</td>
                          <td className="num tnum">{money(rung.totalValueUsd, 'USD', 0)}</td>
                          <td className="num">
                            <button
                              type="button"
                              className="btn px-2 py-1 text-[0.6875rem]"
                              disabled={saving}
                              onClick={() => onSave(rung.margin, rung.priceUsdPerLb)}
                            >
                              Save
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {saveMessage && (
                <p className="border-t p-3 text-[0.8125rem]" style={{ color: 'var(--accent)' }}>
                  {saveMessage}
                </p>
              )}
            </section>

            {/* ------------------------------------------------------ solvers */}
            <section className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="card p-4">
                <h2 className="mb-1 text-sm font-bold">Margin → price</h2>
                <p className="mb-3 text-[0.75rem]" style={{ color: 'var(--text-muted)' }}>
                  Name the margin you want and see what to quote.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    className="control tnum"
                    type="number"
                    step="any"
                    value={marginInput}
                    onChange={(e) => setMarginInput(e.target.value)}
                    placeholder={String(settings.minMargin * 100)}
                    aria-label="Target margin percent"
                  />
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    %
                  </span>
                </div>
                {solvedFromMargin && (
                  <div className="mt-3 space-y-1">
                    <p className="text-2xl font-bold tnum">
                      {unitPrice(
                        toQuoteUnit(
                          solvedFromMargin.priceUsdPerLb,
                          destination.quoteCurrency,
                          destination.quoteUnit,
                          reference.fx,
                        ),
                        destination.quoteCurrency,
                        destination.quoteUnit,
                      )}
                    </p>
                    <p className="text-[0.8125rem]" style={{ color: 'var(--text-muted)' }}>
                      {cents(solvedFromMargin.priceUsdPerLb)}/lb · margin{' '}
                      {cents(solvedFromMargin.marginUsdPerLb)}/lb ·{' '}
                      {money(solvedFromMargin.priceUsdPerLb * result.totalLbs, 'USD', 0)} total
                    </p>
                    {Number(marginInput) / 100 < settings.minMargin && (
                      <p className="text-[0.8125rem] font-semibold" style={{ color: 'var(--danger)' }}>
                        Below the {percent(settings.minMargin, 0)} floor.
                      </p>
                    )}
                    <button
                      type="button"
                      className="btn btn-primary mt-2"
                      disabled={saving}
                      onClick={() =>
                        onSave(Number(marginInput) / 100, solvedFromMargin.priceUsdPerLb)
                      }
                    >
                      Save this quote
                    </button>
                  </div>
                )}
              </div>

              <div className="card p-4">
                <h2 className="mb-1 text-sm font-bold">Price → margin</h2>
                <p className="mb-3 text-[0.75rem]" style={{ color: 'var(--text-muted)' }}>
                  Name the price the client wants and see what it leaves you.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    className="control tnum"
                    type="number"
                    step="any"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    placeholder={plain(result.floor.displayPrice, destination.quoteUnit === 'lb' ? 4 : 3)}
                    aria-label="Target price"
                  />
                  <span className="whitespace-nowrap text-sm" style={{ color: 'var(--text-muted)' }}>
                    {destination.quoteCurrency}/{destination.quoteUnit}
                  </span>
                </div>
                {solvedFromPrice && (
                  <div className="mt-3 space-y-1">
                    <p
                      className="text-2xl font-bold tnum"
                      style={{
                        color: solvedFromPrice.belowCost
                          ? 'var(--danger)'
                          : solvedFromPrice.belowFloor
                            ? 'var(--warn)'
                            : 'var(--accent)',
                      }}
                    >
                      {percent(solvedFromPrice.margin, 2)}
                    </p>
                    <p className="text-[0.8125rem]" style={{ color: 'var(--text-muted)' }}>
                      {cents(solvedFromPrice.usdPerLb)}/lb · margin{' '}
                      {cents(solvedFromPrice.marginUsdPerLb)}/lb ·{' '}
                      {money(solvedFromPrice.marginUsdPerLb * result.totalLbs, 'USD', 0)} on the contract
                    </p>
                    <p className="text-[0.8125rem] font-semibold">
                      {solvedFromPrice.belowCost ? (
                        <span style={{ color: 'var(--danger)' }}>Below break-even — this loses money.</span>
                      ) : solvedFromPrice.belowFloor ? (
                        <span style={{ color: 'var(--warn)' }}>
                          Under the {percent(settings.minMargin, 0)} floor.
                        </span>
                      ) : (
                        <span style={{ color: 'var(--accent)' }}>Clears the floor.</span>
                      )}
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary mt-2"
                      disabled={saving}
                      onClick={() => onSave(solvedFromPrice.margin, solvedFromPrice.usdPerLb)}
                    >
                      Save this quote
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* ---------------------------------------------------- breakdown */}
            <section className="card">
              <div className="border-b p-4">
                <h2 className="text-sm font-bold">Cost breakdown</h2>
              </div>
              <div className="scroll-x">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Basis</th>
                      <th className="num">Native</th>
                      <th className="num">Per lb (native)</th>
                      <th className="num">USD/lb</th>
                      <th className="num">¢/lb</th>
                      <th className="num">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ background: 'var(--surface-sunken)' }}>
                      <td className="font-semibold">KC {monthKey}</td>
                      <td style={{ color: 'var(--text-muted)' }}>Market</td>
                      <td className="num tnum">{effectiveKcCents.toFixed(2)}¢</td>
                      <td className="num">—</td>
                      <td className="num tnum">{plain(centsToUsd(effectiveKcCents), 4)}</td>
                      <td className="num tnum">{cents(centsToUsd(effectiveKcCents))}</td>
                      <td className="num tnum">
                        {percent(centsToUsd(effectiveKcCents) / (result.totalCostUsdPerLb || 1), 0)}
                      </td>
                    </tr>
                    <tr style={{ background: 'var(--surface-sunken)' }}>
                      <td className="font-semibold">Quality premium</td>
                      <td style={{ color: 'var(--text-muted)' }}>Market</td>
                      <td className="num tnum">{effectivePremiumCents.toFixed(2)}¢</td>
                      <td className="num">—</td>
                      <td className="num tnum">{plain(centsToUsd(effectivePremiumCents), 4)}</td>
                      <td className="num tnum">{cents(centsToUsd(effectivePremiumCents))}</td>
                      <td className="num tnum">
                        {percent(centsToUsd(effectivePremiumCents) / (result.totalCostUsdPerLb || 1), 0)}
                      </td>
                    </tr>
                    {result.lines.map((line) => (
                      <tr key={line.key} style={line.included ? undefined : { opacity: 0.45 }}>
                        <td>
                          {line.label}
                          {line.isMargin && (
                            <span className="ml-1.5 text-[0.625rem] uppercase" style={{ color: 'var(--accent)' }}>
                              margin
                            </span>
                          )}
                        </td>
                        <td style={{ color: 'var(--text-muted)' }}>
                          {line.included ? line.currency : line.excludedReason}
                        </td>
                        <td className="num tnum">
                          {line.nativePerLb === null ? '—' : plain(line.nativeAmount, nativeDigits(line.nativeAmount))}
                        </td>
                        <td className="num tnum">
                          {line.nativePerLb === null ? '—' : plain(line.nativePerLb, line.currency === 'COP' ? 2 : 4)}
                        </td>
                        <td className="num tnum">{line.included ? plain(line.usdPerLb, 4) : '—'}</td>
                        <td className="num tnum">{line.included ? cents(line.usdPerLb, 3) : '—'}</td>
                        <td className="num tnum">
                          {line.included
                            ? percent(line.usdPerLb / (result.totalCostUsdPerLb || 1), 1)
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border-strong)' }}>
                      <td className="font-bold">Total cost</td>
                      <td colSpan={3} style={{ color: 'var(--text-muted)' }}>
                        Green coffee {cents(result.greenCoffeeUsdPerLb)} + differential{' '}
                        {cents(result.differentialUsdPerLb)}
                        {result.financeUsdPerLb > 0 && ` + finance ${cents(result.financeUsdPerLb)}`}
                      </td>
                      <td className="num tnum font-bold">{plain(result.totalCostUsdPerLb, 4)}</td>
                      <td className="num tnum font-bold">{cents(result.totalCostUsdPerLb)}</td>
                      <td className="num tnum">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="border-t p-3 text-[0.75rem]" style={{ color: 'var(--text-muted)' }}>
                {cents(result.copExposureUsdPerLb)}/lb of the differential is peso-denominated. At a
                TRM of {plain(trm, 0)} that is {percent(result.copExposureUsdPerLb / (result.differentialUsdPerLb || 1), 0)}{' '}
                of the differential and moves with every point of FX.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

/** Whole pesos read fine for a million-peso invoice; a 3.19/lb line does not. */
function nativeDigits(amount: number): number {
  const magnitude = Math.abs(amount);
  if (magnitude >= 1000) return 0;
  if (magnitude >= 1) return 2;
  return 4;
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="field-label">{label}</p>
      <p
        className="text-xl font-bold tnum"
        style={accent ? { color: 'var(--accent)' } : undefined}
      >
        {value}
      </p>
      {sub && (
        <p className="text-[0.75rem] tnum" style={{ color: 'var(--text-muted)' }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--accent)]"
      />
      <span>{label}</span>
    </label>
  );
}

function ToggleWithMonths({
  label,
  checked,
  onChange,
  months,
  onMonths,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  months: number;
  onMonths: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex flex-1 cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        <span>{label}</span>
      </label>
      {checked && (
        <div className="flex items-center gap-1.5">
          <input
            className="control tnum w-16 px-2 py-1 text-right"
            type="number"
            min={0}
            step={1}
            value={months}
            onChange={(e) => onMonths(Number(e.target.value))}
            aria-label={`${label} months`}
          />
          <span className="text-[0.75rem]" style={{ color: 'var(--text-muted)' }}>
            mo
          </span>
        </div>
      )}
    </div>
  );
}
