import Link from 'next/link';
import { getDb } from '@/lib/db';
import { ensureSeeded } from '@/lib/db/seed';
import { currentAdmin } from '@/lib/auth';
import { monthLabel } from '@/lib/pricing/schedule';
import type { ContractResult, QuoteInput, QuoteResult, ReferenceData, Shipment } from '@/lib/pricing/types';
import { PRICE_DP, UNIT_LABEL, totalInQuoteCurrency, usdPerCopToTrm } from '@/lib/pricing/units';
import { cents, money, percent, plain, shortDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface QuoteRow {
  id: number;
  reference: string;
  client_name: string | null;
  input_json: string;
  result_json: string;
  snapshot_json: string;
  shipments_json: string | null;
  from_month: string | null;
  to_month: string | null;
  hold_months: number | null;
  waived_fixed_cost: number;
  chosen_margin: number | null;
  chosen_price_usd_per_lb: number | null;
  created_at: string;
  created_by: string | null;
}

export default async function QuotesPage() {
  ensureSeeded();
  const isAdmin = Boolean(await currentAdmin());
  const rows = getDb().prepare('SELECT * FROM quotes ORDER BY id DESC LIMIT 100').all() as QuoteRow[];

  return (
    <>
      <div className="qc-admin-intro">
        <h1>Quote history</h1>
        <p>
          Each quote stores the KC price, the premium, every exchange rate and the whole cost table
          as they stood when it was priced, so the number can always be explained later.
        </p>
      </div>

      <section className="qc-panel">
        {rows.length === 0 ? (
          <p className="qc-empty">
            No quotes saved yet. Build one on the <Link href="/">quote screen</Link> and press Save.
          </p>
        ) : (
          <div className="qc-table-wrap">
            <table className="qc-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Client</th>
                  <th>Shipment window</th>
                  <th>Destination</th>
                  <th>Terms</th>
                  <th className="qc-num">Volume</th>
                  <th className="qc-num">KC</th>
                  {isAdmin && <th className="qc-num">Cost</th>}
                  {isAdmin && <th className="qc-num">Margin</th>}
                  <th className="qc-num">Price</th>
                  <th className="qc-num">Value</th>
                  {isAdmin && <th className="qc-num">TRM</th>}
                  <th>Saved</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const input = JSON.parse(row.input_json) as QuoteInput;
                  const snapshot = JSON.parse(row.snapshot_json) as ReferenceData;
                  const shipments = row.shipments_json
                    ? (JSON.parse(row.shipments_json) as Shipment[])
                    : null;
                  const parsed = JSON.parse(row.result_json) as QuoteResult | ContractResult;
                  const isContract = shipments !== null;
                  const destination = snapshot.destinations.find((d) => d.key === input.destinationKey);
                  const totalLbs = 'totalLbs' in parsed ? parsed.totalLbs : 0;
                  const cost = isContract
                    ? (parsed as ContractResult).weightedCostUsdPerLb
                    : (parsed as QuoteResult).totalCostUsdPerLb;
                  const value = isContract
                    ? (parsed as ContractResult).totalValueUsd
                    : (row.chosen_price_usd_per_lb ?? 0) * totalLbs;
                  const displayPrice = destination && row.chosen_price_usd_per_lb !== null
                    ? (row.chosen_price_usd_per_lb *
                        (destination.quoteUnit === 'lb' ? 1 : destination.quoteUnit === 'kg' ? 2.2046226218487757 : 2204.6226218487757)) /
                      snapshot.fx[destination.quoteCurrency]
                    : null;
                  return (
                    <tr key={row.id}>
                      <td>
                        <span className="qc-ref">{row.reference}</span>
                        {isContract && <span className="qc-tagline multi" style={{ marginLeft: 6 }}>{shipments.length} shipments</span>}
                        {row.waived_fixed_cost === 1 && <span className="qc-tagline waived" style={{ marginLeft: 6 }}>Waived</span>}
                      </td>
                      <td>{row.client_name || '—'}</td>
                      <td>
                        {row.from_month && row.to_month
                          ? `${monthLabel(row.from_month)} – ${monthLabel(row.to_month)}`
                          : '—'}
                      </td>
                      <td>{destination?.label ?? input.destinationKey}</td>
                      <td>
                        {input.incoterm} · {input.processKey} · {row.hold_months ?? '—'} mo
                      </td>
                      <td className="qc-num">{plain(totalLbs, 0)} lb</td>
                      <td className="qc-num">{cents(input.kcUsdPerLb)}</td>
                      {isAdmin && <td className="qc-num">{cents(cost)}</td>}
                      {isAdmin && (
                        <td className="qc-num">
                          {row.chosen_margin === null ? '—' : percent(row.chosen_margin, 1)}
                        </td>
                      )}
                      <td className="qc-num qc-price-cell">
                        {displayPrice === null || !destination
                          ? '—'
                          : `${money(displayPrice, destination.quoteCurrency, PRICE_DP)}/${UNIT_LABEL[destination.quoteUnit]}`}
                      </td>
                      <td className="qc-num">
                        {destination
                          ? money(totalInQuoteCurrency(value, destination.quoteCurrency, snapshot.fx), destination.quoteCurrency, 0)
                          : money(value, 'USD', 0)}
                      </td>
                      {isAdmin && <td className="qc-num">{plain(usdPerCopToTrm(snapshot.fx.COP), 0)}</td>}
                      <td style={{ color: 'var(--fc-ink-500)' }}>
                        {shortDate(row.created_at)}
                        {row.created_by ? ` · ${row.created_by}` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
