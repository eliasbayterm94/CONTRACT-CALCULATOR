'use client';

import { useActionState, useMemo } from 'react';
import NumberInput from '../NumberInput';
import SaveBar from './SaveBar';
import { dirtyClass, useTracked } from './useTracked';
import { saveCostLines, type ActionResult } from '@/app/actions';
import { calculateQuote } from '@/lib/pricing/engine';
import { COST_GROUP_LABEL, CURRENCIES, type CostLine, type QuoteInput, type ReferenceData } from '@/lib/pricing/types';
import { cents, money, plain } from '@/lib/format';

/**
 * The cost stack, edited in place.
 *
 * Two things make this workable rather than a wall of numbers: every raw
 * invoice amount shows what it actually costs per pound right beside it, and a
 * reference quote at the top shows what the open edits would do to a real
 * price before any of them are saved.
 */
export default function CostLinesEditor({
  reference,
  referenceQuote,
  locked,
}: {
  reference: ReferenceData;
  referenceQuote: QuoteInput;
  locked: boolean;
}) {
  const [state, formAction] = useActionState(saveCostLines, null as ActionResult | null);
  const { rows, update, resetRow, resetAll, dirtyKeys, isDirty } = useTracked<CostLine>(reference.costLines);

  /** The same quote priced on the saved table and on the open edits. */
  const impact = useMemo(() => {
    try {
      const before = calculateQuote(referenceQuote, reference);
      const after = calculateQuote(referenceQuote, { ...reference, costLines: rows });
      return { before, after, delta: after.totalCostUsdPerLb - before.totalCostUsdPerLb };
    } catch {
      return null;
    }
  }, [referenceQuote, reference, rows]);

  /** What one line costs per pound, at the amounts currently in the boxes. */
  const perLb = (line: CostLine): { native: number | null; usd: number | null } => {
    if (line.basis === 'rate') return { native: null, usd: null };
    if (line.driver !== 'fixed') return { native: null, usd: null };
    const native = line.basis === 'per_lb' ? line.amount : line.lbsPerUnit > 0 ? line.amount / line.lbsPerUnit : 0;
    const rate = reference.fx[line.currency];
    return { native, usd: rate ? native * rate : null };
  };

  return (
    <form action={formAction}>
      {impact && (
        <div className="qc-impact">
          <span>Reference quote · Rotterdam DDP · washed · 250 bags</span>
          <span>
            break-even <span className="qc-impact-figure">{cents(impact.after.totalCostUsdPerLb)}</span>
          </span>
          <span>
            floor price{' '}
            <span className="qc-impact-figure">
              {money(impact.after.floor.displayPrice, impact.after.quoteCurrency, 2)}
            </span>
          </span>
          <span>
            {Math.abs(impact.delta) < 1e-9 ? (
              <span className="qc-impact-delta flat">no change from the saved table</span>
            ) : (
              <span className={`qc-impact-delta ${impact.delta > 0 ? 'up' : 'down'}`}>
                {impact.delta > 0 ? '+' : '−'}{cents(Math.abs(impact.delta))}/lb vs saved
              </span>
            )}
          </span>
        </div>
      )}

      <div className="qc-table-wrap">
        <table className="qc-table qc-cards">
          <thead>
            <tr>
              <th>Line</th>
              <th>Stage</th>
              <th className="qc-num">Invoiced amount</th>
              <th>Currency</th>
              <th className="qc-num">Covers (lb)</th>
              <th className="qc-num">Works out to</th>
              <th>Margin</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((line) => {
              const fromTable = line.driver !== 'fixed';
              const computed = perLb(line);
              return (
                <tr key={line.key}>
                  <td style={{ whiteSpace: 'normal' }}>
                    <input type="hidden" name="cl_key" value={line.key} />
                    <strong>{line.label}</strong>
                    {fromTable && (
                      <span className="qc-derived" style={{ display: 'block' }}>
                        set in the {line.driver} table
                      </span>
                    )}
                  </td>
                  <td style={{ color: 'var(--fc-ink-500)' }}>{COST_GROUP_LABEL[line.group]}</td>
                  <td className="qc-num">
                    <NumberInput
                      name={`cl_amount_${line.key}`}
                      className={dirtyClass('qc-input num', isDirty(line.key, 'amount'))}
                      step="any" inputMode="decimal"
                      value={line.amount}
                      disabled={locked || fromTable}
                      aria-label={`${line.label} amount`}
                      onValueChange={(v) => update(line.key, 'amount', v)}
                    />
                  </td>
                  <td>
                    <select
                      name={`cl_currency_${line.key}`}
                      className={dirtyClass('qc-select', isDirty(line.key, 'currency'))}
                      value={line.currency}
                      disabled={locked || fromTable}
                      aria-label={`${line.label} currency`}
                      onChange={(e) => update(line.key, 'currency', e.target.value as CostLine['currency'])}
                    >
                      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="qc-num">
                    <NumberInput
                      name={`cl_lbs_${line.key}`}
                      className={dirtyClass('qc-input num', isDirty(line.key, 'lbsPerUnit'))}
                      step="any" inputMode="decimal"
                      value={line.lbsPerUnit}
                      disabled={locked || fromTable || line.basis !== 'per_unit'}
                      aria-label={`${line.label} pounds per unit`}
                      onValueChange={(v) => update(line.key, 'lbsPerUnit', v)}
                    />
                  </td>
                  <td className="qc-num qc-derived">
                    {line.basis === 'rate' ? (
                      `${plain(line.amount * 100, 3)}% a month`
                    ) : computed.usd === null ? (
                      '—'
                    ) : (
                      <>
                        <strong>{cents(computed.usd)}</strong>/lb
                        {line.currency !== 'USD' && (
                          <span style={{ display: 'block' }}>
                            {plain(computed.native ?? 0, 2)} {line.currency}/lb
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    <label className="qc-check"><input
                      type="checkbox" name={`cl_margin_${line.key}`}
                      checked={line.isMargin} disabled={locked}
                      aria-label={`${line.label} counts as margin`}
                      onChange={(e) => update(line.key, 'isMargin', e.target.checked)}
                    /></label>
                  </td>
                  <td>
                    <label className="qc-check"><input
                      type="checkbox" name={`cl_active_${line.key}`}
                      checked={line.active} disabled={locked}
                      aria-label={`${line.label} active`}
                      onChange={(e) => update(line.key, 'active', e.target.checked)}
                    /></label>
                  </td>
                  <td>
                    <button
                      type="button" className="qc-rowreset"
                      disabled={locked || !dirtyKeys.has(line.key)}
                      onClick={() => resetRow(line.key)}
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

      <SaveBar
        dirtyCount={dirtyKeys.size}
        onReset={resetAll}
        state={state}
        label="Save cost lines"
        locked={locked}
      />
    </form>
  );
}
