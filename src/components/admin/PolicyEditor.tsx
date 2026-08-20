'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import SaveBar from './SaveBar';
import { saveEngineSettings, type ActionResult } from '@/app/actions';
import { deadZones } from '@/lib/pricing/engine';
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
    validDays: String(settings.validDays),
    staleAfterDays: String(settings.staleAfterDays),
  };
  const [form, setForm] = useState(initial);

  /**
   * The bracket table, edited as text so a half-typed row does not snap back.
   * Only the starting quantity is entered: each band runs to the bag before
   * the next one begins, which is what makes a gap or an overlap impossible.
   */
  const asRows = () =>
    (settings.volumeBrackets ?? []).map((b) => ({
      from: String(b.fromBags),
      margin: Number((b.minMargin * 100).toFixed(2)).toString(),
    }));
  const [brackets, setBrackets] = useState(asRows);

  const setBracket = (i: number, field: 'from' | 'margin', value: string) =>
    setBrackets((rows) => rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));

  const sorted = useMemo(
    () =>
      brackets
        .map((b) => ({ fromBags: Number(b.from), minMargin: Number(b.margin) / 100 }))
        .filter((b) => Number.isFinite(b.fromBags) && b.fromBags > 0 && Number.isFinite(b.minMargin))
        .sort((a, b) => a.fromBags - b.fromBags),
    [brackets],
  );

  const bandLabel = (i: number) => {
    const from = Number(brackets[i]?.from);
    if (!Number.isFinite(from) || from <= 0) return '—';
    const next = sorted.find((b) => b.fromBags > from);
    return next ? `${from}–${next.fromBags - 1} bags` : `${from}+ bags`;
  };

  // Recomputed as the margins are typed, so the run of sizes a step opens up
  // is on screen before it is saved rather than found by a client later.
  const dead = useMemo(
    () =>
      deadZones(
        sorted.map((b, i, all) => ({
          fromBags: b.fromBags,
          toBags: i === all.length - 1 ? null : all[i + 1].fromBags - 1,
          minMargin: b.minMargin,
        })),
      ),
    [sorted],
  );

  // Adopt the saved policy once it lands, so the bar stops reporting changes.
  const savedJson = JSON.stringify({ ...initial, brackets: settings.volumeBrackets });
  useEffect(() => {
    setForm(initial);
    setBrackets(asRows());
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [savedJson]);
  const bracketsChanged = JSON.stringify(brackets) !== JSON.stringify(asRows());
  const dirty =
    Object.keys(initial).filter(
      (k) => form[k as keyof typeof initial] !== initial[k as keyof typeof initial],
    ).length + (bracketsChanged ? 1 : 0);
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
            <p className="qc-hint">
              Only used when no volume brackets are set. With brackets, the floor follows the order
              size and the table below decides it.
            </p>
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
          <div className="qc-field">
            <label className="qc-label" htmlFor="validDays">Quote holds for, days</label>
            <input
              id="validDays" name="validDays"
              className={`qc-input num${changed('validDays') ? ' is-dirty' : ''}`}
              type="number" step={1} min={1} value={form.validDays} disabled={locked}
              onChange={(e) => set('validDays', e.target.value)}
            />
            <p className="qc-hint">One means the day it was quoted. Printed on the sheet the client gets.</p>
          </div>
          <div className="qc-field">
            <label className="qc-label" htmlFor="staleAfterDays">Warn on figures older than, days</label>
            <input
              id="staleAfterDays" name="staleAfterDays"
              className={`qc-input num${changed('staleAfterDays') ? ' is-dirty' : ''}`}
              type="number" step={1} min={1} value={form.staleAfterDays} disabled={locked}
              onChange={(e) => set('staleAfterDays', e.target.value)}
            />
            <p className="qc-hint">Applies to KC, quality premiums and exchange rates.</p>
          </div>
        </div>

        <div className="qc-brackets">
          <div className="qc-brackets-head">
            <h3 className="qc-brackets-title">Volume brackets</h3>
            <span className="qc-brackets-note">
              The floor an order is held to, by size. Each band runs to the bag before the next
              one starts; the last runs to any size.
            </span>
          </div>

          <div className="qc-table-wrap">
            <table className="qc-table qc-cards">
              <thead>
                <tr><th>From bags</th><th className="qc-num">Floor margin %</th><th>Band</th></tr>
              </thead>
              <tbody>
                {brackets.map((b, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        name="bracket_from" className="qc-input num"
                        type="number" step={1} min={1} value={b.from} disabled={locked}
                        aria-label={`Bracket ${i + 1} starts at`}
                        onChange={(e) => setBracket(i, 'from', e.target.value)}
                      />
                    </td>
                    <td className="qc-num">
                      <input
                        name="bracket_margin" className="qc-input num"
                        type="number" step="any" min={0} max={99} value={b.margin} disabled={locked}
                        aria-label={`Bracket ${i + 1} floor margin`}
                        onChange={(e) => setBracket(i, 'margin', e.target.value)}
                      />
                    </td>
                    <td style={{ color: 'var(--fc-ink-500)' }}>
                      {bandLabel(i)}
                      {!locked && brackets.length > 1 && (
                        <button
                          type="button" className="qc-linkish qc-bracket-drop"
                          onClick={() => setBrackets(brackets.filter((_, j) => j !== i))}
                        >
                          remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!locked && (
            <div className="qc-actions" style={{ marginTop: 10 }}>
              <button
                type="button" className="fc-btn fc-btn-ghost"
                onClick={() => setBrackets([...brackets, { from: '', margin: '' }])}
              >
                Add a bracket
              </button>
            </div>
          )}

          {dead.length > 0 && (
            <div className="qc-deadzone" role="status">
              <strong>These steps leave order sizes where asking for more costs less</strong>
              <ul>
                {dead.map((d) => (
                  <li key={d.from}>
                    {d.from === d.to ? `${d.from} bags` : `${d.from}–${d.to} bags`} — the client is
                    better off taking {d.nextBags}
                  </li>
                ))}
              </ul>
              <span>
                Narrow the steps to shrink these. The quote screen offers the round-up whenever it
                lands in one, so nothing is hidden either way.
              </span>
            </div>
          )}
        </div>
      </div>
      <SaveBar dirtyCount={dirty} onReset={() => setForm(initial)} state={state} label="Save policy" locked={locked} />
    </form>
  );
}
