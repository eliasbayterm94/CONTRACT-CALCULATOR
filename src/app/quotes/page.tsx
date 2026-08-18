import { getDb } from '@/lib/db';
import { ensureSeeded } from '@/lib/db/seed';
import { monthKeyLabel } from '@/lib/kc';
import type { QuoteInput, QuoteResult, ReferenceData } from '@/lib/pricing/types';
import { usdPerCopToTrm } from '@/lib/pricing/units';
import { cents, money, percent, plain, shortDate, unitPrice } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface QuoteRow {
  id: number;
  reference: string;
  client_name: string | null;
  notes: string | null;
  input_json: string;
  result_json: string;
  snapshot_json: string;
  chosen_margin: number | null;
  chosen_price_usd_per_lb: number | null;
  created_at: string;
  created_by: string | null;
}

export default function QuotesPage() {
  ensureSeeded();
  const rows = getDb()
    .prepare('SELECT * FROM quotes ORDER BY id DESC LIMIT 100')
    .all() as QuoteRow[];

  return (
    <div className="space-y-5">
      <section className="card p-4">
        <h1 className="text-sm font-bold">Saved quotes</h1>
        <p className="mt-1 text-[0.8125rem]" style={{ color: 'var(--text-muted)' }}>
          Each quote stores the KC price, the premium, every exchange rate and the whole cost table
          as they stood when it was priced, so the number can always be explained later.
        </p>
      </section>

      {rows.length === 0 ? (
        <section className="card p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No quotes saved yet. Build one on the{' '}
          <a href="/" className="font-semibold underline">
            quote screen
          </a>{' '}
          and press Save.
        </section>
      ) : (
        <section className="card">
          <div className="scroll-x">
            <table className="grid">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Client</th>
                  <th>Shipment</th>
                  <th>Destination</th>
                  <th>Terms</th>
                  <th className="num">Volume</th>
                  <th className="num">KC</th>
                  <th className="num">Cost</th>
                  <th className="num">Margin</th>
                  <th className="num">Price</th>
                  <th className="num">Value</th>
                  <th className="num">TRM</th>
                  <th>Saved</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const input = JSON.parse(row.input_json) as QuoteInput;
                  const result = JSON.parse(row.result_json) as QuoteResult;
                  const snapshot = JSON.parse(row.snapshot_json) as ReferenceData;
                  const destination = snapshot.destinations.find(
                    (d) => d.key === input.destinationKey,
                  );
                  const price = row.chosen_price_usd_per_lb;
                  return (
                    <tr key={row.id}>
                      <td className="font-semibold">{row.reference}</td>
                      <td>{row.client_name || '—'}</td>
                      <td>{monthKeyLabel(input.kcMonth)}</td>
                      <td>{destination?.label ?? input.destinationKey}</td>
                      <td>
                        {input.incoterm} · {input.processKey} · {input.packagingKey}
                      </td>
                      <td className="num tnum">{plain(result.totalLbs, 0)} lb</td>
                      <td className="num tnum">{cents(input.kcPriceUsdPerLb)}</td>
                      <td className="num tnum">{cents(result.totalCostUsdPerLb)}</td>
                      <td className="num tnum">
                        {row.chosen_margin === null ? '—' : percent(row.chosen_margin, 1)}
                      </td>
                      <td className="num tnum font-semibold">
                        {price === null || !destination
                          ? '—'
                          : unitPrice(
                              destination.quoteUnit === 'lb'
                                ? price
                                : (price * 2.2046226218487757) /
                                  snapshot.fx[destination.quoteCurrency],
                              destination.quoteCurrency,
                              destination.quoteUnit,
                            )}
                      </td>
                      <td className="num tnum">
                        {price === null ? '—' : money(price * result.totalLbs, 'USD', 0)}
                      </td>
                      <td className="num tnum">{plain(usdPerCopToTrm(snapshot.fx.COP), 0)}</td>
                      <td style={{ color: 'var(--text-muted)' }}>
                        {shortDate(row.created_at)}
                        {row.created_by ? ` · ${row.created_by}` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
