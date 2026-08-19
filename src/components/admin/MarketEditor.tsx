'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import SaveBar from './SaveBar';
import { refreshRates, saveFxOverrides, saveKcPrices, type ActionResult } from '@/app/actions';
import type { CurrencyCode } from '@/lib/pricing/types';
import { usdPerCopToTrm } from '@/lib/pricing/units';
import { plain, shortDate } from '@/lib/format';

interface MonthRow {
  key: string;
  label: string;
  value: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** KC prices and quality premiums, one month per row. */
export function MonthTableEditor({
  title, note, rows, prefix, action, label, locked,
}: {
  title: string;
  note: string;
  rows: MonthRow[];
  prefix: 'kc';
  action: typeof saveKcPrices;
  label: string;
  locked: boolean;
}) {
  const [state, formAction] = useActionState(action, null as ActionResult | null);
  const baseline = () => Object.fromEntries(rows.map((r) => [r.key, r.value ? String(r.value) : '']));
  const [values, setValues] = useState<Record<string, string>>(baseline);
  const dirty = rows.filter((r) => (values[r.key] ?? '') !== (r.value ? String(r.value) : '')).length;

  // Once the server has the new figures, the boxes are no longer "unsaved".
  const savedJson = JSON.stringify(rows.map((r) => [r.key, r.value]));
  useEffect(() => { setValues(baseline()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [savedJson]);

  return (
    <form action={formAction}>
      <div className="qc-panel-head">
        <h2 className="qc-panel-title">{title}</h2>
        <span className="qc-panel-note">{note}</span>
      </div>
      <div className="qc-table-wrap">
        <table className="qc-table qc-cards">
          <thead>
            <tr><th>Month</th><th className="qc-num">¢/lb</th><th>Last set</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const changed = (values[r.key] ?? '') !== (r.value ? String(r.value) : '');
              return (
                <tr key={r.key}>
                  <td><strong>{r.label}</strong></td>
                  <td className="qc-num">
                    <input
                      name={`${prefix}_${r.key}`}
                      className={`qc-input num${changed ? ' is-dirty' : ''}`}
                      type="number" step="any" inputMode="decimal"
                      value={values[r.key] ?? ''} disabled={locked}
                      aria-label={`${title} for ${r.label}`}
                      onChange={(e) => setValues((v) => ({ ...v, [r.key]: e.target.value }))}
                    />
                  </td>
                  <td style={{ color: 'var(--fc-ink-500)' }}>
                    {!r.updatedAt || r.updatedBy === 'seed' ? '—' : `${shortDate(r.updatedAt)} · ${r.updatedBy}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <SaveBar
        dirtyCount={dirty}
        onReset={() => setValues(Object.fromEntries(rows.map((r) => [r.key, r.value ? String(r.value) : ''])))}
        state={state} label={label} locked={locked}
      />
    </form>
  );
}

export interface FxRow {
  currency: CurrencyCode;
  usdPerUnit: number;
  source: string;
  isOverride: boolean;
  fetchedAt: string;
}

/** Exchange rates, with the option to pin a booked forward instead of spot. */
export function FxEditor({ rows, locked }: { rows: FxRow[]; locked: boolean }) {
  const [state, formAction] = useActionState(saveFxOverrides, null as ActionResult | null);
  const [fetching, startFetch] = useTransition();
  const [fetchNote, setFetchNote] = useState<{ ok: boolean; text: string } | null>(null);
  const editable = rows.filter((r) => r.currency !== 'USD');
  const shown = (r: FxRow) => (r.currency === 'COP' ? usdPerCopToTrm(r.usdPerUnit) : r.usdPerUnit);
  const baseValues = () =>
    Object.fromEntries(editable.map((r) => [r.currency, shown(r).toFixed(r.currency === 'COP' ? 2 : 4)]));
  const basePins = () => Object.fromEntries(editable.map((r) => [r.currency, r.isOverride]));
  const [values, setValues] = useState<Record<string, string>>(baseValues);
  const [pins, setPins] = useState<Record<string, boolean>>(basePins);

  const savedJson = JSON.stringify(editable.map((r) => [r.currency, r.usdPerUnit, r.isOverride]));
  useEffect(() => {
    setValues(baseValues());
    setPins(basePins());
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [savedJson]);
  const dirty =
    editable.filter((r) => values[r.currency] !== shown(r).toFixed(r.currency === 'COP' ? 2 : 4)).length +
    editable.filter((r) => pins[r.currency] !== r.isOverride).length;

  return (
    <form action={formAction}>
      <div className="qc-panel-head">
        <h2 className="qc-panel-title">Exchange rates</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {fetchNote && (
            <span
              className="qc-panel-note" role="status"
              style={{ color: fetchNote.ok ? 'var(--fc-success)' : 'var(--fc-danger)' }}
            >
              {fetchNote.text}
            </span>
          )}
          <button
            type="button" className="fc-btn fc-btn-ghost" disabled={fetching || locked}
            onClick={() => startFetch(async () => {
              const res = await refreshRates();
              setFetchNote({ ok: res.ok, text: res.message });
            })}
          >
            {fetching ? 'Fetching…' : 'Fetch live rates'}
          </button>
        </div>
      </div>
      <div className="qc-impact">
        <span>TRM from Banco de la República, the rest from the ECB.</span>
        <span>
          A pinned rate is yours and survives every fetch — use it to quote against a booked forward.
          Untick the pin to hand the row back to the feed.
        </span>
      </div>
      <div className="qc-table-wrap">
        <table className="qc-table qc-cards">
          <thead>
            <tr>
              <th>Currency</th><th className="qc-num">Rate</th><th className="qc-num">USD per unit</th>
              <th>Source</th><th>Fetched</th><th>Pinned</th>
            </tr>
          </thead>
          <tbody>
            {editable.map((r) => {
              const changed = values[r.currency] !== shown(r).toFixed(r.currency === 'COP' ? 2 : 4);
              return (
                <tr key={r.currency}>
                  <td>
                    <input type="hidden" name="fx_key" value={r.currency} />
                    <strong>{r.currency}</strong>
                    {r.currency === 'COP' && (
                      <span className="qc-derived" style={{ display: 'block' }}>TRM, pesos per dollar</span>
                    )}
                  </td>
                  <td className="qc-num">
                    <input
                      name={`fx_value_${r.currency}`}
                      className={`qc-input num${changed ? ' is-dirty' : ''}`}
                      type="number" step="any" min={0} inputMode="decimal"
                      value={values[r.currency] ?? ''} disabled={locked}
                      aria-label={`${r.currency} rate`}
                      onChange={(e) => {
                        setValues((v) => ({ ...v, [r.currency]: e.target.value }));
                        // Typing a rate is what pinning means. Leaving the box
                        // and the pin out of step is how a typed rate used to
                        // get thrown away on save.
                        setPins((p) => ({ ...p, [r.currency]: true }));
                      }}
                    />
                  </td>
                  <td className="qc-num qc-derived">{r.usdPerUnit.toPrecision(6)}</td>
                  <td style={{ color: 'var(--fc-ink-500)', whiteSpace: 'normal' }}>{r.source}</td>
                  <td style={{ color: 'var(--fc-ink-500)' }}>{shortDate(r.fetchedAt)}</td>
                  <td>
                    <label className="qc-check"><input
                      type="checkbox" name={`fx_pin_${r.currency}`}
                      checked={pins[r.currency] ?? false} disabled={locked}
                      aria-label={`Pin ${r.currency}`}
                      onChange={(e) => setPins((p) => ({ ...p, [r.currency]: e.target.checked }))}
                    /></label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <SaveBar dirtyCount={dirty} state={state} label="Save FX" locked={locked} />
    </form>
  );
}

export { plain };
