'use client';

import { useActionState, useEffect, useState } from 'react';
import SaveBar from './SaveBar';
import { savePremiumOverrides, saveSeasonalPremiums, type ActionResult } from '@/app/actions';
import { MONTH_OF_YEAR_NAMES } from '@/lib/pricing/premium';
import type { CalendarMonth } from '@/lib/pricing/schedule';
import { monthLabel } from '@/lib/pricing/schedule';
import { shortDate } from '@/lib/format';

export interface SeasonRow {
  month: number;
  premiumCents: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface OverrideRow {
  monthKey: string;
  premiumCents: number;
  note: string;
  updatedAt: string;
  updatedBy: string | null;
}

/**
 * The differential that follows the harvest: twelve months of the year, set
 * once, applying to every year after it.
 */
export function SeasonEditor({ rows, locked }: { rows: SeasonRow[]; locked: boolean }) {
  const [state, formAction] = useActionState(saveSeasonalPremiums, null as ActionResult | null);
  const baseline = () =>
    Object.fromEntries(rows.map((r) => [r.month, r.updatedBy === 'seed' ? '' : String(r.premiumCents)]));
  const [values, setValues] = useState<Record<string, string>>(baseline);

  const savedJson = JSON.stringify(rows.map((r) => [r.month, r.premiumCents, r.updatedBy]));
  useEffect(() => { setValues(baseline()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [savedJson]);

  const at = (r: SeasonRow) => (r.updatedBy === 'seed' ? '' : String(r.premiumCents));
  const dirty = rows.filter((r) => (values[r.month] ?? '') !== at(r)).length;

  return (
    <form action={formAction}>
      <div className="qc-panel-head">
        <h2 className="qc-panel-title">Quality premium by season</h2>
        <span className="qc-panel-note">US cents per pound, over KC</span>
      </div>
      <div className="qc-impact">
        <span>The differential tracks the harvest, not the futures board — set it once and it applies every year.</span>
        <span>A quote takes the premium of its first shipment month.</span>
      </div>
      <div className="qc-table-wrap">
        <table className="qc-table qc-cards">
          <thead>
            <tr><th>Month</th><th className="qc-num">¢/lb</th><th>Last set</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const changed = (values[r.month] ?? '') !== at(r);
              return (
                <tr key={r.month}>
                  <td><strong>{MONTH_OF_YEAR_NAMES[r.month - 1]}</strong></td>
                  <td className="qc-num">
                    <input
                      name={`season_${r.month}`}
                      className={`qc-input num${changed ? ' is-dirty' : ''}`}
                      type="number" step="any" inputMode="decimal"
                      value={values[r.month] ?? ''} disabled={locked}
                      placeholder="not set"
                      aria-label={`Quality premium for ${MONTH_OF_YEAR_NAMES[r.month - 1]}`}
                      onChange={(e) => setValues((v) => ({ ...v, [r.month]: e.target.value }))}
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
      <SaveBar dirtyCount={dirty} onReset={() => setValues(baseline())} state={state} label="Save season" locked={locked} />
    </form>
  );
}

/**
 * Dated exceptions.
 *
 * A season describes a normal year. A short crop or a run on one lot belongs
 * to a single month of a single year, and overriding the season for that month
 * is more honest than bending the season out of shape.
 */
export function OverrideEditor({
  rows,
  months,
  locked,
}: {
  rows: OverrideRow[];
  months: CalendarMonth[];
  locked: boolean;
}) {
  const [state, formAction] = useActionState(savePremiumOverrides, null as ActionResult | null);
  const [drops, setDrops] = useState<Record<string, boolean>>({});
  const [newMonth, setNewMonth] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newNote, setNewNote] = useState('');

  const savedJson = JSON.stringify(rows.map((r) => [r.monthKey, r.premiumCents, r.note]));
  useEffect(() => {
    setDrops({});
    setNewMonth('');
    setNewValue('');
    setNewNote('');
  }, [savedJson]);

  const taken = new Set(rows.map((r) => r.monthKey));
  const free = months.filter((m) => !taken.has(m.key));
  const dirty = Object.values(drops).filter(Boolean).length + (newMonth && newValue.trim() !== '' ? 1 : 0);

  return (
    <form action={formAction}>
      <div className="qc-panel-head">
        <h2 className="qc-panel-title">Exceptions</h2>
        <span className="qc-panel-note">{rows.length === 0 ? 'None set' : `${rows.length} dated month${rows.length === 1 ? '' : 's'}`}</span>
      </div>
      <div className="qc-impact">
        <span>A dated month beats its season. Use it for a short crop or a lot that is not going to repeat.</span>
      </div>

      {rows.length > 0 && (
        <div className="qc-table-wrap">
          <table className="qc-table qc-cards">
            <thead>
              <tr><th>Month</th><th className="qc-num">¢/lb</th><th>Why</th><th>Set</th><th>Remove</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.monthKey} className={drops[r.monthKey] ? 'qc-line-excluded' : ''}>
                  <td>
                    <input type="hidden" name="override_key" value={r.monthKey} />
                    <strong>{monthLabel(r.monthKey)}</strong>
                  </td>
                  <td className="qc-num">
                    <input
                      name={`override_value_${r.monthKey}`}
                      className="qc-input num"
                      type="number" step="any" inputMode="decimal"
                      defaultValue={r.premiumCents} disabled={locked || drops[r.monthKey]}
                      aria-label={`Premium for ${monthLabel(r.monthKey)}`}
                    />
                  </td>
                  <td>
                    <input
                      name={`override_note_${r.monthKey}`} className="qc-input"
                      defaultValue={r.note} disabled={locked || drops[r.monthKey]}
                      placeholder="Short crop, spot lot…"
                      aria-label={`Reason for ${monthLabel(r.monthKey)}`}
                    />
                  </td>
                  <td style={{ color: 'var(--fc-ink-500)' }}>{shortDate(r.updatedAt)}</td>
                  <td>
                    <label className="qc-check"><input
                      type="checkbox" name={`override_drop_${r.monthKey}`}
                      checked={drops[r.monthKey] ?? false} disabled={locked}
                      aria-label={`Remove the exception for ${monthLabel(r.monthKey)}`}
                      onChange={(e) => setDrops((d) => ({ ...d, [r.monthKey]: e.target.checked }))}
                    /></label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="qc-panel-body">
        <div className="qc-fields">
          <div className="qc-field">
            <label className="qc-label" htmlFor="override_new_month">Add a month</label>
            <select
              id="override_new_month" name="override_new_month" className="qc-select"
              value={newMonth} disabled={locked}
              onChange={(e) => setNewMonth(e.target.value)}
            >
              <option value="">Choose a month…</option>
              {free.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
          <div className="qc-field">
            <label className="qc-label" htmlFor="override_new_value">Premium ¢/lb</label>
            <input
              id="override_new_value" name="override_new_value" className="qc-input num"
              type="number" step="any" inputMode="decimal"
              value={newValue} disabled={locked || !newMonth}
              onChange={(e) => setNewValue(e.target.value)}
            />
          </div>
          <div className="qc-field wide">
            <label className="qc-label" htmlFor="override_new_note">Why</label>
            <input
              id="override_new_note" name="override_new_note" className="qc-input"
              value={newNote} disabled={locked || !newMonth}
              placeholder="Short crop, spot lot…"
              onChange={(e) => setNewNote(e.target.value)}
            />
          </div>
        </div>
      </div>

      <SaveBar dirtyCount={dirty} state={state} label="Save exceptions" locked={locked} />
    </form>
  );
}
