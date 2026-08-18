import QuoteBuilder from '@/components/QuoteBuilder';
import { getKcPrices, getPremiums, getReferenceData, getSetting } from '@/lib/db';
import { ensureSeeded } from '@/lib/db/seed';
import { compareMonthKeys, parseMonthKey, upcomingContractMonths } from '@/lib/kc';
import { DEFAULT_LBS_PER_CONTAINER } from '@/lib/pricing/units';
import type { ContractMonth } from '@/lib/kc';

export const dynamic = 'force-dynamic';

export default function QuotePage() {
  ensureSeeded();
  const reference = getReferenceData();
  const kcPrices = getKcPrices();
  const premiums = getPremiums();
  const lbsPerContainer = getSetting('lbsPerContainer', DEFAULT_LBS_PER_CONTAINER);

  // Offer every month that has a stored price, plus the upcoming contract months,
  // so a month entered by admin never disappears from the quote screen.
  const keys = new Set<string>(kcPrices.map((k) => k.monthKey));
  for (const m of upcomingContractMonths(new Date(), 8)) keys.add(m.key);
  const months: ContractMonth[] = [...keys]
    .sort(compareMonthKeys)
    .map(parseMonthKey)
    .filter((m): m is ContractMonth => m !== null);

  const kcByMonth = Object.fromEntries(kcPrices.map((k) => [k.monthKey, k.priceCents]));
  const premiumByMonth = Object.fromEntries(
    premiums.filter((p) => p.qualityKey === 'standard').map((p) => [p.monthKey, p.premiumCents]),
  );

  const noPrices = kcPrices.every((k) => k.priceCents === 0);

  return (
    <div className="space-y-5">
      {noPrices && (
        <div className="card p-4 text-sm" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
          No KC prices have been entered yet. Set them in{' '}
          <a href="/admin" className="font-semibold underline">
            Admin
          </a>{' '}
          — or type a projected KC below to explore prices.
        </div>
      )}
      <QuoteBuilder
        reference={reference}
        months={months}
        kcByMonth={kcByMonth}
        premiumByMonth={premiumByMonth}
        lbsPerContainer={lbsPerContainer}
      />
    </div>
  );
}
