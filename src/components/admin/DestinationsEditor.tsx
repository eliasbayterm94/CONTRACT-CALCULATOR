'use client';

import { useActionState } from 'react';
import NumberInput from '../NumberInput';
import SaveBar from './SaveBar';
import { dirtyClass, useTracked } from './useTracked';
import { saveDestinations, type ActionResult } from '@/app/actions';
import { CURRENCIES, type Destination, type FxTable, type QuoteUnit } from '@/lib/pricing/types';
import { UNIT_LABEL } from '@/lib/pricing/units';
import { cents } from '@/lib/format';

const UNITS: QuoteUnit[] = ['lb', 'kg', 'mt'];

/**
 * Freight and destination charges. Amounts stay per container, the way they are
 * invoiced, with the per-pound figure alongside so the effect on a quote is
 * visible without doing the division in your head.
 */
export default function DestinationsEditor({
  destinations,
  fx,
  lbsPerContainer,
  lbsPerBag,
  locked,
}: {
  destinations: Destination[];
  fx: FxTable;
  lbsPerContainer: number;
  lbsPerBag: number;
  locked: boolean;
}) {
  const [state, formAction] = useActionState(saveDestinations, null as ActionResult | null);
  const { rows, update, resetRow, resetAll, dirtyKeys, isDirty } = useTracked<Destination>(destinations);

  const perLbContainer = (amount: number, currency: Destination['seafreightCurrency']) =>
    lbsPerContainer > 0 ? (amount / lbsPerContainer) * (fx[currency] ?? 0) : 0;

  return (
    <form action={formAction}>
      <div className="qc-impact">
        <span>Freight, import and unloading are per container of {lbsPerContainer.toLocaleString('en-US')} lb.</span>
        <span>Storage is per packaging unit per month.</span>
      </div>
      <div className="qc-table-wrap">
        <table className="qc-table">
          <thead>
            <tr>
              <th>Destination</th>
              <th>Quoted in</th>
              <th>Per</th>
              <th className="qc-num">Ocean freight</th>
              <th className="qc-num">Import</th>
              <th className="qc-num">Unloading</th>
              <th className="qc-num">Per lb (CIF→DDP)</th>
              <th className="qc-num">Storage /bag /mo</th>
              <th>Ccy</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const freight = perLbContainer(d.seafreightAmount, d.seafreightCurrency);
              const landed = freight
                + perLbContainer(d.importAmount, d.importCurrency)
                + perLbContainer(d.unloadingAmount, d.unloadingCurrency);
              const storagePerLb = lbsPerBag > 0 ? (d.storageAmount / lbsPerBag) * (fx[d.storageCurrency] ?? 0) : 0;
              return (
                <tr key={d.key}>
                  <td>
                    <input type="hidden" name="d_key" value={d.key} />
                    <strong>{d.label}</strong>
                  </td>
                  <td>
                    <select
                      name={`d_cur_${d.key}`}
                      className={dirtyClass('qc-select', isDirty(d.key, 'quoteCurrency'))}
                      value={d.quoteCurrency} disabled={locked}
                      aria-label={`${d.label} quote currency`}
                      onChange={(e) => update(d.key, 'quoteCurrency', e.target.value as Destination['quoteCurrency'])}
                    >
                      {CURRENCIES.filter((c) => c !== 'COP').map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td>
                    <select
                      name={`d_unit_${d.key}`}
                      className={dirtyClass('qc-select', isDirty(d.key, 'quoteUnit'))}
                      value={d.quoteUnit} disabled={locked}
                      aria-label={`${d.label} quote unit`}
                      onChange={(e) => update(d.key, 'quoteUnit', e.target.value as QuoteUnit)}
                    >
                      {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
                    </select>
                  </td>
                  {([
                    ['d_sea_', 'seafreightAmount', d.seafreightAmount, 'ocean freight'],
                    ['d_imp_', 'importAmount', d.importAmount, 'import cost'],
                    ['d_unl_', 'unloadingAmount', d.unloadingAmount, 'unloading'],
                  ] as const).map(([prefix, field, value, what]) => (
                    <td className="qc-num" key={prefix}>
                      <NumberInput
                        name={`${prefix}${d.key}`}
                        className={dirtyClass('qc-input num', isDirty(d.key, field))}
                        step="any" min={0} inputMode="decimal"
                        value={value} disabled={locked}
                        aria-label={`${d.label} ${what}`}
                        onValueChange={(v) => update(d.key, field, v)}
                      />
                    </td>
                  ))}
                  <td className="qc-num qc-derived"><strong>{cents(landed)}</strong>/lb</td>
                  <td className="qc-num">
                    <NumberInput
                      name={`d_stor_${d.key}`}
                      className={dirtyClass('qc-input num', isDirty(d.key, 'storageAmount'))}
                      step="any" min={0} inputMode="decimal"
                      value={d.storageAmount} disabled={locked}
                      aria-label={`${d.label} storage`}
                      onValueChange={(v) => update(d.key, 'storageAmount', v)}
                    />
                    <span className="qc-derived">{cents(storagePerLb)}/lb/mo</span>
                  </td>
                  <td>
                    <select
                      name={`d_storcur_${d.key}`}
                      className={dirtyClass('qc-select', isDirty(d.key, 'storageCurrency'))}
                      value={d.storageCurrency} disabled={locked}
                      aria-label={`${d.label} storage currency`}
                      onChange={(e) => update(d.key, 'storageCurrency', e.target.value as Destination['storageCurrency'])}
                    >
                      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox" name={`d_active_${d.key}`}
                      checked={d.active} disabled={locked}
                      aria-label={`${d.label} active`}
                      onChange={(e) => update(d.key, 'active', e.target.checked)}
                    />
                  </td>
                  <td>
                    <button
                      type="button" className="qc-rowreset"
                      disabled={locked || !dirtyKeys.has(d.key)}
                      onClick={() => resetRow(d.key)}
                    >
                      Undo
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <SaveBar dirtyCount={dirtyKeys.size} onReset={resetAll} state={state} label="Save destinations" locked={locked} />
    </form>
  );
}
