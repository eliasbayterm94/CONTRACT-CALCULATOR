'use client';

import { useActionState, useEffect, useState } from 'react';
import NumberInput from '../NumberInput';
import SaveBar from './SaveBar';
import { dirtyClass, useTracked } from './useTracked';
import { savePackagingAndProcess, type ActionResult } from '@/app/actions';
import type { FxTable, PackagingType, ProcessType } from '@/lib/pricing/types';
import { cents } from '@/lib/format';

/**
 * Packaging and milling. Both are invoiced per unit, so each row shows what
 * that works out to per pound — the figure that actually moves a quote.
 */
export default function PackagingProcessEditor({
  packaging,
  processes,
  fx,
  locked,
}: {
  packaging: PackagingType[];
  processes: ProcessType[];
  fx: FxTable;
  locked: boolean;
}) {
  const [state, formAction] = useActionState(savePackagingAndProcess, null as ActionResult | null);
  const pack = useTracked<PackagingType>(packaging);
  const proc = useTracked<ProcessType>(processes);
  const [traderPackaging, setTraderPackaging] = useState(
    packaging.find((p) => p.traderDefault)?.key ?? packaging[0]?.key ?? '',
  );
  const savedTrader = packaging.find((p) => p.traderDefault)?.key ?? '';
  const traderChanged = traderPackaging !== savedTrader;
  useEffect(() => { setTraderPackaging(savedTrader); }, [savedTrader]);
  const perLb = (amount: number, lbs: number, currency: PackagingType['currency']) =>
    lbs > 0 ? (amount / lbs) * (fx[currency] ?? 0) : 0;

  return (
    <form action={formAction}>
      <div className="qc-impact">
        <span>Traders may only quote the packaging marked below. Admin can use any active type.</span>
      </div>
      <div className="qc-table-wrap">
        <table className="qc-table qc-cards">
          <thead>
            <tr>
              <th>Packaging</th>
              <th className="qc-num">Cost per unit</th>
              <th className="qc-num">Pounds per unit</th>
              <th className="qc-num">Works out to</th>
              <th>Trader default</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pack.rows.map((p) => (
              <tr key={p.key}>
                <td>
                  <input type="hidden" name="p_key" value={p.key} />
                  <strong>{p.label}</strong>
                </td>
                <td className="qc-num">
                  <NumberInput
                    name={`p_amount_${p.key}`}
                    className={dirtyClass('qc-input num', pack.isDirty(p.key, 'amount'))}
                    step="any" inputMode="decimal" value={p.amount} disabled={locked}
                    aria-label={`${p.label} amount`}
                    onValueChange={(v) => pack.update(p.key, 'amount', v)}
                  />
                </td>
                <td className="qc-num">
                  <NumberInput
                    name={`p_lbs_${p.key}`}
                    className={dirtyClass('qc-input num', pack.isDirty(p.key, 'lbsPerUnit'))}
                    step="any" inputMode="decimal" value={p.lbsPerUnit} disabled={locked}
                    aria-label={`${p.label} pounds`}
                    onValueChange={(v) => pack.update(p.key, 'lbsPerUnit', v)}
                  />
                </td>
                <td className="qc-num qc-derived">
                  <strong>{cents(perLb(p.amount, p.lbsPerUnit, p.currency))}</strong>/lb
                </td>
                <td>
                  <label className="qc-check"><input
                    type="radio" name="trader_packaging" value={p.key}
                    checked={traderPackaging === p.key} disabled={locked}
                    aria-label={`${p.label} is the trader default`}
                    onChange={() => setTraderPackaging(p.key)}
                  /></label>
                </td>
                <td>
                  <label className="qc-check"><input
                    type="checkbox" name={`p_active_${p.key}`}
                    checked={p.active} disabled={locked}
                    aria-label={`${p.label} active`}
                    onChange={(e) => pack.update(p.key, 'active', e.target.checked)}
                  /></label>
                </td>
                <td>
                  <button
                    type="button" className="qc-rowreset"
                    disabled={locked || !pack.dirtyKeys.has(p.key)}
                    onClick={() => pack.resetRow(p.key)}
                  >
                    Undo
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="qc-table-wrap" style={{ borderTop: '1px solid var(--fc-ink-100)' }}>
        <table className="qc-table qc-cards">
          <thead>
            <tr>
              <th>Milling / process</th>
              <th className="qc-num">Cost per unit</th>
              <th className="qc-num">Pounds per unit</th>
              <th className="qc-num">Works out to</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {proc.rows.map((p) => (
              <tr key={p.key}>
                <td>
                  <input type="hidden" name="pr_key" value={p.key} />
                  <strong>{p.label}</strong>
                </td>
                <td className="qc-num">
                  <NumberInput
                    name={`pr_amount_${p.key}`}
                    className={dirtyClass('qc-input num', proc.isDirty(p.key, 'amount'))}
                    step="any" inputMode="decimal" value={p.amount} disabled={locked}
                    aria-label={`${p.label} amount`}
                    onValueChange={(v) => proc.update(p.key, 'amount', v)}
                  />
                </td>
                <td className="qc-num">
                  <NumberInput
                    name={`pr_lbs_${p.key}`}
                    className={dirtyClass('qc-input num', proc.isDirty(p.key, 'lbsPerUnit'))}
                    step="any" inputMode="decimal" value={p.lbsPerUnit} disabled={locked}
                    aria-label={`${p.label} pounds`}
                    onValueChange={(v) => proc.update(p.key, 'lbsPerUnit', v)}
                  />
                </td>
                <td className="qc-num qc-derived">
                  <strong>{cents(perLb(p.amount, p.lbsPerUnit, p.currency))}</strong>/lb
                </td>
                <td>
                  <label className="qc-check"><input
                    type="checkbox" name={`pr_active_${p.key}`}
                    checked={p.active} disabled={locked}
                    aria-label={`${p.label} active`}
                    onChange={(e) => proc.update(p.key, 'active', e.target.checked)}
                  /></label>
                </td>
                <td>
                  <button
                    type="button" className="qc-rowreset"
                    disabled={locked || !proc.dirtyKeys.has(p.key)}
                    onClick={() => proc.resetRow(p.key)}
                  >
                    Undo
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SaveBar
        dirtyCount={pack.dirtyKeys.size + proc.dirtyKeys.size + (traderChanged ? 1 : 0)}
        onReset={() => { pack.resetAll(); proc.resetAll(); setTraderPackaging(packaging.find((p) => p.traderDefault)?.key ?? ''); }}
        state={state}
        label="Save packaging and processes"
        locked={locked}
      />
    </form>
  );
}
