'use client';

import { useActionState, useEffect, useState } from 'react';
import SaveBar from './SaveBar';
import { saveCoffeeTypes, type ActionResult } from '@/app/actions';
import type { ProcessType } from '@/lib/pricing/types';
import { plain } from '@/lib/format';

/**
 * The coffee a quote can be built on.
 *
 * Two figures that are not the same kind of thing sit side by side here.
 * Milling is a processing cost, in pesos a bag, and it is what the mill
 * charges. The premium is what the type itself is worth — decaf and organic
 * are dearer coffee, not dearer milling — so it is in US cents a pound, the
 * same unit as the monthly differential it joins.
 */
export default function CoffeeTypeEditor({
  rows,
  locked,
}: {
  rows: ProcessType[];
  locked: boolean;
}) {
  const [state, formAction] = useActionState(saveCoffeeTypes, null as ActionResult | null);

  const baseline = () =>
    rows.map((r) => ({
      key: r.key,
      label: r.label,
      amount: String(r.amount),
      premium: String(r.premiumCents ?? 0),
      active: r.active,
    }));
  const [edits, setEdits] = useState(baseline);
  const [added, setAdded] = useState({ label: '', amount: '', premium: '' });

  const savedJson = JSON.stringify(baseline());
  useEffect(() => {
    setEdits(baseline());
    setAdded({ label: '', amount: '', premium: '' });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [savedJson]);

  const set = (i: number, field: 'label' | 'amount' | 'premium' | 'active', value: string | boolean) =>
    setEdits((all) => all.map((r, j) => (j === i ? { ...r, [field]: value } : r)));

  const dirty =
    edits.filter((r, i) => JSON.stringify(r) !== JSON.stringify(baseline()[i])).length +
    (added.label.trim() ? 1 : 0);

  return (
    <form action={formAction}>
      <div className="qc-panel-head">
        <h2 className="qc-panel-title">Coffee types</h2>
        <span className="qc-panel-note">Milling in pesos a bag · premium in US cents a pound</span>
      </div>
      <div className="qc-impact">
        <span>The premium is what the type is worth over a plain washed lot, added to the month&apos;s differential.</span>
        <span>Milling is the processing cost and is separate from it.</span>
      </div>

      <div className="qc-table-wrap">
        <table className="qc-table qc-cards">
          <thead>
            <tr>
              <th>Coffee type</th>
              <th className="qc-num">Milling COP/bag</th>
              <th className="qc-num">Premium ¢/lb</th>
              <th className="qc-num">Works out to</th>
              <th>Offered</th>
            </tr>
          </thead>
          <tbody>
            {edits.map((r, i) => (
              <tr key={r.key} className={r.active ? '' : 'qc-line-excluded'}>
                <td>
                  <input type="hidden" name="ct_key" value={r.key} />
                  <input
                    name={`ct_label_${r.key}`} className="qc-input"
                    value={r.label} disabled={locked}
                    aria-label={`Name of ${r.label}`}
                    onChange={(e) => set(i, 'label', e.target.value)}
                  />
                </td>
                <td className="qc-num">
                  <input
                    name={`ct_amount_${r.key}`} className="qc-input num"
                    type="number" step="any" min={0} value={r.amount} disabled={locked}
                    aria-label={`Milling for ${r.label}`}
                    onChange={(e) => set(i, 'amount', e.target.value)}
                  />
                </td>
                <td className="qc-num">
                  <input
                    name={`ct_premium_${r.key}`} className="qc-input num"
                    type="number" step="any" value={r.premium} disabled={locked}
                    aria-label={`Premium for ${r.label}`}
                    onChange={(e) => set(i, 'premium', e.target.value)}
                  />
                </td>
                <td className="qc-num qc-derived">
                  {Number(r.premium) === 0 ? '—' : `+${plain(Number(r.premium), 2)}¢/lb`}
                </td>
                <td>
                  <label className="qc-check"><input
                    type="checkbox" name={`ct_active_${r.key}`}
                    checked={r.active} disabled={locked}
                    aria-label={`Offer ${r.label}`}
                    onChange={(e) => set(i, 'active', e.target.checked)}
                  /></label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="qc-panel-body">
        <div className="qc-fields">
          <div className="qc-field wide">
            <label className="qc-label" htmlFor="ct_new_label">Add a coffee type</label>
            <input
              id="ct_new_label" name="ct_new_label" className="qc-input"
              value={added.label} disabled={locked}
              placeholder="Gesha, Rainforest, Women-produced…"
              onChange={(e) => setAdded((a) => ({ ...a, label: e.target.value }))}
            />
          </div>
          <div className="qc-field">
            <label className="qc-label" htmlFor="ct_new_amount">Milling COP/bag</label>
            <input
              id="ct_new_amount" name="ct_new_amount" className="qc-input num"
              type="number" step="any" min={0}
              value={added.amount} disabled={locked || !added.label.trim()}
              onChange={(e) => setAdded((a) => ({ ...a, amount: e.target.value }))}
            />
          </div>
          <div className="qc-field">
            <label className="qc-label" htmlFor="ct_new_premium">Premium ¢/lb</label>
            <input
              id="ct_new_premium" name="ct_new_premium" className="qc-input num"
              type="number" step="any"
              value={added.premium} disabled={locked || !added.label.trim()}
              onChange={(e) => setAdded((a) => ({ ...a, premium: e.target.value }))}
            />
          </div>
        </div>
      </div>

      <SaveBar dirtyCount={dirty} state={state} label="Save coffee types" locked={locked} />
    </form>
  );
}
