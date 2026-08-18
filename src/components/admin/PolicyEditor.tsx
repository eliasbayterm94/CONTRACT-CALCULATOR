'use client';

import { useActionState, useEffect, useState } from 'react';
import SaveBar from './SaveBar';
import { saveEngineSettings, type ActionResult } from '@/app/actions';
import type { EngineSettings } from '@/lib/pricing/types';

/** How margin is defined, the floor, the rungs, and how long carry is free. */
export default function PolicyEditor({
  settings,
  locked,
}: {
  settings: EngineSettings;
  locked: boolean;
}) {
  const [state, formAction] = useActionState(saveEngineSettings, null as ActionResult | null);
  const initial = {
    marginMode: settings.marginMode,
    marginBase: settings.marginBase,
    minMargin: (settings.minMargin * 100).toFixed(2),
    ladder: settings.ladder.map((m) => Number((m * 100).toFixed(2))).join(', '),
    financeMonthlyRate: (settings.financeMonthlyRate * 100).toFixed(3),
    freeHoldMonths: String(settings.freeHoldMonths),
  };
  const [form, setForm] = useState(initial);

  // Adopt the saved policy once it lands, so the bar stops reporting changes.
  const savedJson = JSON.stringify(initial);
  useEffect(() => { setForm(initial); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [savedJson]);
  const dirty = Object.keys(initial).filter(
    (k) => form[k as keyof typeof initial] !== initial[k as keyof typeof initial],
  ).length;
  const set = (k: keyof typeof initial, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const changed = (k: keyof typeof initial) => form[k] !== initial[k];

  return (
    <form action={formAction}>
      <div className="qc-panel-head">
        <h2 className="qc-panel-title">Pricing policy</h2>
        <span className="qc-panel-note">Applies to every quote from the moment it is saved</span>
      </div>
      <div className="qc-panel-body">
        <div className="qc-fields">
          <div className="qc-field wide">
            <label className="qc-label" htmlFor="marginMode">Margin means</label>
            <select
              id="marginMode" name="marginMode"
              className={`qc-select${changed('marginMode') ? ' is-dirty' : ''}`}
              value={form.marginMode} disabled={locked}
              onChange={(e) => set('marginMode', e.target.value)}
            >
              <option value="on_price">A share of the selling price (gross margin)</option>
              <option value="on_cost">A markup on cost</option>
            </select>
          </div>
          <div className="qc-field wide">
            <label className="qc-label" htmlFor="marginBase">Charged on</label>
            <select
              id="marginBase" name="marginBase"
              className={`qc-select${changed('marginBase') ? ' is-dirty' : ''}`}
              value={form.marginBase} disabled={locked}
              onChange={(e) => set('marginBase', e.target.value)}
            >
              <option value="full_landed_cost">Full landed cost, coffee included</option>
              <option value="differential_only">The differential only, not the coffee</option>
            </select>
          </div>
          <div className="qc-field">
            <label className="qc-label" htmlFor="minMargin">Floor margin %</label>
            <input
              id="minMargin" name="minMargin"
              className={`qc-input num${changed('minMargin') ? ' is-dirty' : ''}`}
              type="number" step="any" value={form.minMargin} disabled={locked}
              onChange={(e) => set('minMargin', e.target.value)}
            />
            <p className="qc-hint">No quote is offered below this.</p>
          </div>
          <div className="qc-field">
            <label className="qc-label" htmlFor="freeHoldMonths">Free carry months</label>
            <input
              id="freeHoldMonths" name="freeHoldMonths"
              className={`qc-input num${changed('freeHoldMonths') ? ' is-dirty' : ''}`}
              type="number" step={1} min={0} value={form.freeHoldMonths} disabled={locked}
              onChange={(e) => set('freeHoldMonths', e.target.value)}
            />
            <p className="qc-hint">Months the fixed cost already covers before storage and finance bill.</p>
          </div>
          <div className="qc-field wide">
            <label className="qc-label" htmlFor="ladder">Ladder rungs %</label>
            <input
              id="ladder" name="ladder"
              className={`qc-input${changed('ladder') ? ' is-dirty' : ''}`}
              value={form.ladder} disabled={locked}
              onChange={(e) => set('ladder', e.target.value)}
            />
            <p className="qc-hint">Comma separated. The floor is always shown, whether or not it is listed here.</p>
          </div>
          <div className="qc-field">
            <label className="qc-label" htmlFor="financeMonthlyRate">Finance % per month</label>
            <input
              id="financeMonthlyRate" name="financeMonthlyRate"
              className={`qc-input num${changed('financeMonthlyRate') ? ' is-dirty' : ''}`}
              type="number" step="any" value={form.financeMonthlyRate} disabled={locked}
              onChange={(e) => set('financeMonthlyRate', e.target.value)}
            />
            <p className="qc-hint">Charged on the full cargo value, DDP only.</p>
          </div>
        </div>
      </div>
      <SaveBar dirtyCount={dirty} onReset={() => setForm(initial)} state={state} label="Save policy" locked={locked} />
    </form>
  );
}
