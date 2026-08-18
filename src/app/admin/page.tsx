import ActionForm from '@/components/admin/ActionForm';
import RefreshRatesButton from '@/components/admin/RefreshRatesButton';
import SignOutButton from '@/components/admin/SignOutButton';
import {
  saveCostLines,
  saveDestinations,
  saveEngineSettings,
  saveFxOverrides,
  saveKcPrices,
  savePackagingAndProcess,
  savePremiums,
  signIn,
} from '@/app/actions';
import { currentAdmin } from '@/lib/auth';
import {
  getAuditLog,
  getCostLines,
  getDestinations,
  getEngineSettings,
  getFxRows,
  getKcPrices,
  getPackaging,
  getPremiums,
  getProcesses,
  getSetting,
} from '@/lib/db';
import { ensureSeeded } from '@/lib/db/seed';
import { compareMonthKeys, monthKeyLabel, parseMonthKey, upcomingContractMonths } from '@/lib/kc';
import { CURRENCIES } from '@/lib/pricing/types';
import { DEFAULT_LBS_PER_CONTAINER, usdPerCopToTrm } from '@/lib/pricing/units';
import { shortDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  ensureSeeded();
  const admin = await currentAdmin();
  const locked = !admin;

  const costLines = getCostLines(true);
  const destinations = getDestinations(true);
  const packaging = getPackaging(true);
  const processes = getProcesses(true);
  const fxRows = getFxRows();
  const settings = getEngineSettings();
  const lbsPerContainer = getSetting('lbsPerContainer', DEFAULT_LBS_PER_CONTAINER);
  const kcPrices = getKcPrices();
  const premiums = getPremiums();
  const audit = getAuditLog(25);

  const monthKeys = new Set(kcPrices.map((k) => k.monthKey));
  for (const m of upcomingContractMonths(new Date(), 8)) monthKeys.add(m.key);
  const months = [...monthKeys].sort(compareMonthKeys).filter((k) => parseMonthKey(k));
  const kcByMonth = Object.fromEntries(kcPrices.map((k) => [k.monthKey, k]));
  const premByMonth = Object.fromEntries(
    premiums.filter((p) => p.qualityKey === 'standard').map((p) => [p.monthKey, p]),
  );

  return (
    <div className="space-y-5">
      <section className="card p-4">
        {admin ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              Signed in as <strong>{admin}</strong>. Changes here affect every quote from now on and
              are written to the audit log.
            </p>
            <SignOutButton />
          </div>
        ) : (
          <ActionForm
            action={signIn}
            submitLabel="Sign in"
            footerClassName="flex items-center gap-3 pt-3"
          >
            <h2 className="mb-1 text-sm font-bold">Admin sign-in</h2>
            <p className="mb-3 text-[0.8125rem]" style={{ color: 'var(--text-muted)' }}>
              Everyone can build quotes. Editing rates, premiums and the cost tables needs the admin
              password.
            </p>
            <div className="grid max-w-md grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="name">
                  Your name
                </label>
                <input id="name" name="name" className="control" placeholder="elias" />
              </div>
              <div>
                <label className="field-label" htmlFor="password">
                  Password
                </label>
                <input id="password" name="password" type="password" className="control" required />
              </div>
            </div>
          </ActionForm>
        )}
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="card">
          <ActionForm action={saveKcPrices} submitLabel="Save KC prices" disabled={locked}>
            <div className="border-b p-4">
              <h2 className="text-sm font-bold">KC futures by contract month</h2>
              <p className="mt-1 text-[0.75rem]" style={{ color: 'var(--text-muted)' }}>
                US cents per pound, entered by hand each morning.
              </p>
            </div>
            <div className="scroll-x">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="num">¢/lb</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((key) => (
                    <tr key={key}>
                      <td className="font-semibold">{monthKeyLabel(key)}</td>
                      <td className="num">
                        <input
                          name={`kc_${key}`}
                          className="control tnum text-right"
                          type="number"
                          step="any"
                          min={0}
                          defaultValue={kcByMonth[key]?.priceCents || ''}
                          disabled={locked}
                          aria-label={`KC price for ${key}`}
                        />
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>
                        {!kcByMonth[key] || kcByMonth[key].updatedBy === 'seed'
                          ? '—'
                          : `${shortDate(kcByMonth[key].updatedAt)} · ${kcByMonth[key].updatedBy}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ActionForm>
        </section>

        <section className="card">
          <ActionForm action={savePremiums} submitLabel="Save premiums" disabled={locked}>
            <div className="border-b p-4">
              <h2 className="text-sm font-bold">Quality premium by month</h2>
              <p className="mt-1 text-[0.75rem]" style={{ color: 'var(--text-muted)' }}>
                US cents per pound over KC. This is the green coffee differential — the cost tables
                below cover conversion and logistics only.
              </p>
            </div>
            <div className="scroll-x">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="num">¢/lb</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((key) => (
                    <tr key={key}>
                      <td className="font-semibold">{monthKeyLabel(key)}</td>
                      <td className="num">
                        <input
                          name={`prem_${key}`}
                          className="control tnum text-right"
                          type="number"
                          step="any"
                          defaultValue={premByMonth[key]?.premiumCents || ''}
                          disabled={locked}
                          aria-label={`Premium for ${key}`}
                        />
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>
                        {!premByMonth[key] || premByMonth[key].updatedBy === 'seed'
                          ? '—'
                          : `${shortDate(premByMonth[key].updatedAt)} · ${premByMonth[key].updatedBy}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ActionForm>
        </section>
      </div>

      <section className="card">
        <ActionForm action={saveFxOverrides} submitLabel="Save FX" disabled={locked}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div>
              <h2 className="text-sm font-bold">Exchange rates</h2>
              <p className="mt-1 max-w-2xl text-[0.75rem]" style={{ color: 'var(--text-muted)' }}>
                TRM from Banco de la República, the rest from the ECB. Pin a rate to quote against a
                booked forward instead of spot — pinned rates are never overwritten by a fetch.
              </p>
            </div>
            <RefreshRatesButton disabled={locked} />
          </div>
          <div className="scroll-x">
            <table className="grid">
              <thead>
                <tr>
                  <th>Currency</th>
                  <th className="num">Rate</th>
                  <th className="num">USD per unit</th>
                  <th>Source</th>
                  <th>Fetched</th>
                  <th>Pin</th>
                  <th>Release</th>
                </tr>
              </thead>
              <tbody>
                {fxRows
                  .filter((r) => r.currency !== 'USD')
                  .map((row) => {
                    const displayed =
                      row.currency === 'COP' ? usdPerCopToTrm(row.usdPerUnit) : row.usdPerUnit;
                    return (
                      <tr key={row.currency}>
                        <td className="font-semibold">
                          <input type="hidden" name="fx_key" value={row.currency} />
                          {row.currency}
                          {row.currency === 'COP' && (
                            <span
                              className="ml-1.5 text-[0.6875rem]"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              TRM, pesos per dollar
                            </span>
                          )}
                        </td>
                        <td className="num">
                          <input
                            name={`fx_value_${row.currency}`}
                            className="control tnum text-right"
                            type="number"
                            step="any"
                            min={0}
                            defaultValue={displayed.toFixed(row.currency === 'COP' ? 2 : 4)}
                            disabled={locked}
                            aria-label={`${row.currency} rate`}
                          />
                        </td>
                        <td className="num tnum">{row.usdPerUnit.toPrecision(6)}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{row.source}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{shortDate(row.fetchedAt)}</td>
                        <td>
                          <input
                            type="checkbox"
                            name={`fx_pin_${row.currency}`}
                            defaultChecked={row.isOverride}
                            disabled={locked}
                            className="h-4 w-4 accent-[var(--accent)]"
                            aria-label={`Pin ${row.currency}`}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            name={`fx_clear_${row.currency}`}
                            disabled={locked || !row.isOverride}
                            className="h-4 w-4 accent-[var(--accent)]"
                            aria-label={`Release ${row.currency}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </ActionForm>
      </section>

      <section className="card">
        <ActionForm
          action={saveEngineSettings}
          submitLabel="Save pricing settings"
          disabled={locked}
        >
          <div className="border-b p-4">
            <h2 className="text-sm font-bold">Pricing policy</h2>
            <p className="mt-1 text-[0.75rem]" style={{ color: 'var(--text-muted)' }}>
              How margin is defined, the floor every quote is held to, and the ladder shown to
              traders.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
            <div className="col-span-2">
              <label className="field-label" htmlFor="marginMode">
                Margin means
              </label>
              <select
                id="marginMode"
                name="marginMode"
                className="control"
                defaultValue={settings.marginMode}
                disabled={locked}
              >
                <option value="on_price">A share of the selling price (gross margin)</option>
                <option value="on_cost">A markup on cost</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="field-label" htmlFor="marginBase">
                Charged on
              </label>
              <select
                id="marginBase"
                name="marginBase"
                className="control"
                defaultValue={settings.marginBase}
                disabled={locked}
              >
                <option value="full_landed_cost">Full landed cost, coffee included</option>
                <option value="differential_only">The differential only, not the coffee</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="minMargin">
                Floor margin %
              </label>
              <input
                id="minMargin"
                name="minMargin"
                className="control tnum"
                type="number"
                step="any"
                defaultValue={(settings.minMargin * 100).toFixed(2)}
                disabled={locked}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="ladderFrom">
                Ladder from %
              </label>
              <input
                id="ladderFrom"
                name="ladderFrom"
                className="control tnum"
                type="number"
                step="any"
                defaultValue={(settings.ladderFrom * 100).toFixed(2)}
                disabled={locked}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="ladderTo">
                Ladder to %
              </label>
              <input
                id="ladderTo"
                name="ladderTo"
                className="control tnum"
                type="number"
                step="any"
                defaultValue={(settings.ladderTo * 100).toFixed(2)}
                disabled={locked}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="ladderStep">
                Ladder step %
              </label>
              <input
                id="ladderStep"
                name="ladderStep"
                className="control tnum"
                type="number"
                step="any"
                defaultValue={(settings.ladderStep * 100).toFixed(2)}
                disabled={locked}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="financeMonthlyRate">
                Finance % per month
              </label>
              <input
                id="financeMonthlyRate"
                name="financeMonthlyRate"
                className="control tnum"
                type="number"
                step="any"
                defaultValue={(settings.financeMonthlyRate * 100).toFixed(3)}
                disabled={locked}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="lbsPerContainer">
                Pounds per container
              </label>
              <input
                id="lbsPerContainer"
                name="lbsPerContainer"
                className="control tnum"
                type="number"
                step="any"
                defaultValue={lbsPerContainer}
                disabled={locked}
              />
            </div>
          </div>
        </ActionForm>
      </section>

      <section className="card">
        <ActionForm action={saveCostLines} submitLabel="Save cost lines" disabled={locked}>
          <div className="border-b p-4">
            <h2 className="text-sm font-bold">Cost lines</h2>
            <p className="mt-1 max-w-3xl text-[0.75rem]" style={{ color: 'var(--text-muted)' }}>
              Amounts stay in the currency and unit they are invoiced in — a bag, a container, a
              truck. Lines marked <em>from table</em> read their amount from the packaging, process
              or destination tables below. Flagging a line as margin keeps it out of the base that
              margin is charged on.
            </p>
          </div>
          <div className="scroll-x">
            <table className="grid">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Tier</th>
                  <th className="num">Amount</th>
                  <th>Currency</th>
                  <th className="num">Lbs per unit</th>
                  <th>Margin</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {costLines.map((line) => {
                  const fromTable = line.driver !== 'fixed';
                  return (
                    <tr key={line.key}>
                      <td className="font-semibold">
                        <input type="hidden" name="cl_key" value={line.key} />
                        {line.label}
                        {fromTable && (
                          <span
                            className="ml-1.5 text-[0.6875rem] font-normal"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            from {line.driver} table
                          </span>
                        )}
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{line.group}</td>
                      <td className="num">
                        <input
                          name={`cl_amount_${line.key}`}
                          className="control tnum text-right"
                          type="number"
                          step="any"
                          defaultValue={line.amount}
                          disabled={locked || fromTable}
                          aria-label={`${line.label} amount`}
                        />
                      </td>
                      <td>
                        <select
                          name={`cl_currency_${line.key}`}
                          className="control"
                          defaultValue={line.currency}
                          disabled={locked || fromTable}
                          aria-label={`${line.label} currency`}
                        >
                          {CURRENCIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="num">
                        <input
                          name={`cl_lbs_${line.key}`}
                          className="control tnum text-right"
                          type="number"
                          step="any"
                          defaultValue={line.lbsPerUnit}
                          disabled={locked || fromTable || line.basis !== 'per_unit'}
                          aria-label={`${line.label} pounds per unit`}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          name={`cl_margin_${line.key}`}
                          defaultChecked={line.isMargin}
                          disabled={locked}
                          className="h-4 w-4 accent-[var(--accent)]"
                          aria-label={`${line.label} counts as margin`}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          name={`cl_active_${line.key}`}
                          defaultChecked={line.active}
                          disabled={locked}
                          className="h-4 w-4 accent-[var(--accent)]"
                          aria-label={`${line.label} active`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ActionForm>
      </section>

      <section className="card">
        <ActionForm action={saveDestinations} submitLabel="Save destinations" disabled={locked}>
          <div className="border-b p-4">
            <h2 className="text-sm font-bold">Destinations</h2>
            <p className="mt-1 text-[0.75rem]" style={{ color: 'var(--text-muted)' }}>
              Ocean freight, import and unloading are per container. Storage is per packaging unit
              per month.
            </p>
          </div>
          <div className="scroll-x">
            <table className="grid">
              <thead>
                <tr>
                  <th>Destination</th>
                  <th>Quoted in</th>
                  <th>Per</th>
                  <th className="num">Ocean freight</th>
                  <th className="num">Import</th>
                  <th className="num">Unloading</th>
                  <th className="num">Storage</th>
                  <th>Storage ccy</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {destinations.map((d) => (
                  <tr key={d.key}>
                    <td className="font-semibold">
                      <input type="hidden" name="d_key" value={d.key} />
                      {d.label}
                    </td>
                    <td>
                      <select
                        name={`d_cur_${d.key}`}
                        className="control"
                        defaultValue={d.quoteCurrency}
                        disabled={locked}
                        aria-label={`${d.label} quote currency`}
                      >
                        {CURRENCIES.filter((c) => c !== 'COP').map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        name={`d_unit_${d.key}`}
                        className="control"
                        defaultValue={d.quoteUnit}
                        disabled={locked}
                        aria-label={`${d.label} quote unit`}
                      >
                        <option value="lb">lb</option>
                        <option value="kg">kg</option>
                        <option value="mt">MT</option>
                      </select>
                    </td>
                    <td className="num">
                      <input
                        name={`d_sea_${d.key}`}
                        className="control tnum text-right"
                        type="number"
                        step="any"
                        min={0}
                        defaultValue={d.seafreightAmount}
                        disabled={locked}
                        aria-label={`${d.label} ocean freight`}
                      />
                    </td>
                    <td className="num">
                      <input
                        name={`d_imp_${d.key}`}
                        className="control tnum text-right"
                        type="number"
                        step="any"
                        min={0}
                        defaultValue={d.importAmount}
                        disabled={locked}
                        aria-label={`${d.label} import cost`}
                      />
                    </td>
                    <td className="num">
                      <input
                        name={`d_unl_${d.key}`}
                        className="control tnum text-right"
                        type="number"
                        step="any"
                        min={0}
                        defaultValue={d.unloadingAmount}
                        disabled={locked}
                        aria-label={`${d.label} unloading`}
                      />
                    </td>
                    <td className="num">
                      <input
                        name={`d_stor_${d.key}`}
                        className="control tnum text-right"
                        type="number"
                        step="any"
                        min={0}
                        defaultValue={d.storageAmount}
                        disabled={locked}
                        aria-label={`${d.label} storage`}
                      />
                    </td>
                    <td>
                      <select
                        name={`d_storcur_${d.key}`}
                        className="control"
                        defaultValue={d.storageCurrency}
                        disabled={locked}
                        aria-label={`${d.label} storage currency`}
                      >
                        {CURRENCIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        name={`d_active_${d.key}`}
                        defaultChecked={d.active}
                        disabled={locked}
                        className="h-4 w-4 accent-[var(--accent)]"
                        aria-label={`${d.label} active`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ActionForm>
      </section>

      <section className="card">
        <ActionForm
          action={savePackagingAndProcess}
          submitLabel="Save packaging and processes"
          disabled={locked}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2">
            <div className="lg:border-r">
              <div className="border-b p-4">
                <h2 className="text-sm font-bold">Packaging</h2>
              </div>
              <div className="scroll-x">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th className="num">Cost per unit</th>
                      <th className="num">Lbs per unit</th>
                      <th>Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {packaging.map((p) => (
                      <tr key={p.key}>
                        <td className="font-semibold">
                          <input type="hidden" name="p_key" value={p.key} />
                          {p.label}
                        </td>
                        <td className="num">
                          <input
                            name={`p_amount_${p.key}`}
                            className="control tnum text-right"
                            type="number"
                            step="any"
                            defaultValue={p.amount}
                            disabled={locked}
                            aria-label={`${p.label} amount`}
                          />
                        </td>
                        <td className="num">
                          <input
                            name={`p_lbs_${p.key}`}
                            className="control tnum text-right"
                            type="number"
                            step="any"
                            defaultValue={p.lbsPerUnit}
                            disabled={locked}
                            aria-label={`${p.label} pounds`}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            name={`p_active_${p.key}`}
                            defaultChecked={p.active}
                            disabled={locked}
                            className="h-4 w-4 accent-[var(--accent)]"
                            aria-label={`${p.label} active`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="border-t lg:border-t-0">
              <div className="border-b p-4">
                <h2 className="text-sm font-bold">Milling / process</h2>
              </div>
              <div className="scroll-x">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Process</th>
                      <th className="num">Cost per unit</th>
                      <th className="num">Lbs per unit</th>
                      <th>Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processes.map((p) => (
                      <tr key={p.key}>
                        <td className="font-semibold">
                          <input type="hidden" name="pr_key" value={p.key} />
                          {p.label}
                        </td>
                        <td className="num">
                          <input
                            name={`pr_amount_${p.key}`}
                            className="control tnum text-right"
                            type="number"
                            step="any"
                            defaultValue={p.amount}
                            disabled={locked}
                            aria-label={`${p.label} amount`}
                          />
                        </td>
                        <td className="num">
                          <input
                            name={`pr_lbs_${p.key}`}
                            className="control tnum text-right"
                            type="number"
                            step="any"
                            defaultValue={p.lbsPerUnit}
                            disabled={locked}
                            aria-label={`${p.label} pounds`}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            name={`pr_active_${p.key}`}
                            defaultChecked={p.active}
                            disabled={locked}
                            className="h-4 w-4 accent-[var(--accent)]"
                            aria-label={`${p.label} active`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </ActionForm>
      </section>

      <section className="card">
        <div className="border-b p-4">
          <h2 className="text-sm font-bold">Recent changes</h2>
        </div>
        <div className="scroll-x">
          <table className="grid">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Action</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {audit.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                    Nothing recorded yet.
                  </td>
                </tr>
              )}
              {audit.map((row) => (
                <tr key={row.id}>
                  <td style={{ color: 'var(--text-muted)' }}>{shortDate(row.at)}</td>
                  <td>{row.actor}</td>
                  <td>{row.entity}</td>
                  <td>{row.action}</td>
                  <td
                    className="max-w-md truncate text-[0.75rem]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {row.detail ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
