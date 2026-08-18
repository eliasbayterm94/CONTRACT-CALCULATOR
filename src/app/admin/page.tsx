import CostLinesEditor from '@/components/admin/CostLinesEditor';
import DestinationsEditor from '@/components/admin/DestinationsEditor';
import PackagingProcessEditor from '@/components/admin/PackagingProcessEditor';
import PolicyEditor from '@/components/admin/PolicyEditor';
import { FxEditor, MonthTableEditor } from '@/components/admin/MarketEditor';
import { ChangeCodeForm, CreateCodeForm, SignInForm, SignOutButton } from '@/components/admin/SignInForm';
import { saveKcPrices, savePremiums } from '@/app/actions';
import { currentAdmin, isAdminCodeSet } from '@/lib/auth';
import {
  getAuditLog,
  getCostLines,
  getDestinations,
  getFxRows,
  getKcPrices,
  getKcSpot,
  getPackaging,
  getPremiums,
  getProcesses,
  getReferenceData,
} from '@/lib/db';
import { ensureSeeded } from '@/lib/db/seed';
import { compareMonthKeys, monthKeyLabel, parseMonthKey, upcomingContractMonths } from '@/lib/kc';
import { DEFAULT_LBS_PER_CONTAINER } from '@/lib/pricing/units';
import { monthOptions } from '@/lib/pricing/schedule';
import type { QuoteInput } from '@/lib/pricing/types';
import { shortDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

const SECTIONS = [
  ['market', 'KC & premiums'],
  ['fx', 'Exchange rates'],
  ['policy', 'Pricing policy'],
  ['costs', 'Cost lines'],
  ['destinations', 'Destinations'],
  ['packaging', 'Packaging & process'],
  ['audit', 'Recent changes'],
] as const;

export default async function AdminPage() {
  ensureSeeded();
  const admin = await currentAdmin();
  const locked = !admin;
  const codeSet = isAdminCodeSet();
  const codeManagedByEnv = Boolean(process.env.ADMIN_PASSWORD);

  const reference = getReferenceData();
  const allLines = getCostLines(true);
  const allDestinations = getDestinations(true);
  const allPackaging = getPackaging(true);
  const allProcesses = getProcesses(true);
  const fxRows = getFxRows();
  const kcPrices = getKcPrices();
  const premiums = getPremiums().filter((p) => p.qualityKey === 'standard');
  const spot = getKcSpot();
  const audit = getAuditLog(25);

  const monthKeys = new Set(kcPrices.map((k) => k.monthKey));
  for (const m of upcomingContractMonths(new Date(), 8)) monthKeys.add(m.key);
  const months = [...monthKeys].sort(compareMonthKeys).filter((k) => parseMonthKey(k));
  const kcByMonth = Object.fromEntries(kcPrices.map((k) => [k.monthKey, k]));
  const premByMonth = Object.fromEntries(premiums.map((p) => [p.monthKey, p]));

  // The quote the cost editor prices against, so an edit's effect is visible
  // before it is saved. Deliberately a typical contract, not an extreme one.
  const window = monthOptions(new Date(), 6);
  const referenceQuote: QuoteInput = {
    destinationKey: reference.destinations.find((d) => d.key === 'rotterdam')?.key ?? reference.destinations[0]?.key ?? '',
    incoterm: 'DDP',
    processKey: reference.processes[0]?.key ?? '',
    packagingKey: reference.packaging.find((p) => p.traderDefault)?.key ?? reference.packaging[0]?.key ?? '',
    bags: 250,
    kcUsdPerLb: (spot?.priceCents ?? kcPrices.find((k) => k.priceCents > 0)?.priceCents ?? 185.5) / 100,
    premiumUsdPerLb: (premiums.find((p) => p.premiumCents !== 0)?.premiumCents ?? 35) / 100,
    holdMonths: 2,
    fromMonth: window[0]?.key ?? '',
    toMonth: window[4]?.key ?? window[window.length - 1]?.key ?? '',
    waiveFixedCost: false,
  };

  const lbsPerBag = reference.packaging.find((p) => p.traderDefault)?.lbsPerUnit ?? 154.322;

  return (
    <>
      <div className="qc-admin-intro">
        <h1>Rates &amp; costs</h1>
        <p>
          Everything a quote is built from. Amounts stay in the currency and unit they are invoiced
          in — a bag, a container, a truck — and each row shows what that works out to per pound.
          Changes take effect on the next quote and are written to the audit log.
        </p>
      </div>

      <section className="qc-panel">
        {admin ? (
          <div className="qc-panel-body qc-signed-in">
            <span style={{ fontSize: 13 }}>
              Signed in as <strong>{admin}</strong>. The session lasts 12 hours.
            </span>
            <div className="qc-signed-in-actions">
              <ChangeCodeForm managedByEnv={codeManagedByEnv} />
              <SignOutButton />
            </div>
          </div>
        ) : codeSet ? (
          <SignInForm />
        ) : (
          <CreateCodeForm />
        )}
      </section>

      <nav className="qc-admin-nav">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`}>{label}</a>
        ))}
      </nav>

      <div className="qc-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <div>
          <div className="qc-solvers" style={{ marginBottom: 14 }}>
            <section className="qc-panel" id="market" style={{ margin: 0 }}>
              <MonthTableEditor
                title="KC futures by month"
                note={spot ? `Spot ${spot.priceCents.toFixed(2)}¢ · ${spot.source}` : 'US cents per pound'}
                prefix="kc"
                action={saveKcPrices}
                label="Save KC prices"
                locked={locked}
                rows={months.map((key) => ({
                  key,
                  label: monthKeyLabel(key),
                  value: kcByMonth[key]?.priceCents ?? 0,
                  updatedAt: kcByMonth[key]?.updatedAt ?? null,
                  updatedBy: kcByMonth[key]?.updatedBy ?? null,
                }))}
              />
            </section>

            <section className="qc-panel" style={{ margin: 0 }}>
              <MonthTableEditor
                title="Quality premium by month"
                note="The green coffee differential over KC"
                prefix="prem"
                action={savePremiums}
                label="Save premiums"
                locked={locked}
                rows={months.map((key) => ({
                  key,
                  label: monthKeyLabel(key),
                  value: premByMonth[key]?.premiumCents ?? 0,
                  updatedAt: premByMonth[key]?.updatedAt ?? null,
                  updatedBy: premByMonth[key]?.updatedBy ?? null,
                }))}
              />
            </section>
          </div>

          <section className="qc-panel" id="fx">
            <FxEditor rows={fxRows} locked={locked} />
          </section>

          <section className="qc-panel" id="policy">
            <PolicyEditor settings={reference.settings} locked={locked} />
          </section>

          <section className="qc-panel" id="costs">
            <div className="qc-panel-head">
              <h2 className="qc-panel-title">Cost lines</h2>
              <span className="qc-panel-note">
                Lines set elsewhere read their amount from the packaging, process or destination table
              </span>
            </div>
            <CostLinesEditor
              reference={{ ...reference, costLines: allLines }}
              referenceQuote={referenceQuote}
              locked={locked}
            />
          </section>

          <section className="qc-panel" id="destinations">
            <div className="qc-panel-head">
              <h2 className="qc-panel-title">Destinations</h2>
            </div>
            <DestinationsEditor
              destinations={allDestinations}
              fx={reference.fx}
              lbsPerContainer={DEFAULT_LBS_PER_CONTAINER}
              lbsPerBag={lbsPerBag}
              locked={locked}
            />
          </section>

          <section className="qc-panel" id="packaging">
            <div className="qc-panel-head">
              <h2 className="qc-panel-title">Packaging &amp; process</h2>
            </div>
            <PackagingProcessEditor
              packaging={allPackaging}
              processes={allProcesses}
              fx={reference.fx}
              locked={locked}
            />
          </section>

          <section className="qc-panel" id="audit">
            <div className="qc-panel-head">
              <h2 className="qc-panel-title">Recent changes</h2>
            </div>
            <div className="qc-table-wrap">
              <table className="qc-table">
                <thead>
                  <tr><th>When</th><th>Who</th><th>What</th><th>Action</th><th>Detail</th></tr>
                </thead>
                <tbody>
                  {audit.length === 0 && (
                    <tr><td colSpan={5} style={{ color: 'var(--fc-ink-300)' }}>Nothing recorded yet.</td></tr>
                  )}
                  {audit.map((row) => (
                    <tr key={row.id}>
                      <td style={{ color: 'var(--fc-ink-500)' }}>{shortDate(row.at)}</td>
                      <td>{row.actor}</td>
                      <td>{row.entity}</td>
                      <td>{row.action}</td>
                      <td className="qc-derived" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {row.detail ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
