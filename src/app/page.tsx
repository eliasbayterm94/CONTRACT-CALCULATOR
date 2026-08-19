import QuoteBuilder from '@/components/QuoteBuilder';
import { currentAdmin } from '@/lib/auth';
import { getKcPrices, getKcSpot, getPremiums, getReferenceData } from '@/lib/store';
import { compareMonthKeys } from '@/lib/kc';
import { monthOptions } from '@/lib/pricing/schedule';

export const dynamic = 'force-dynamic';

export default async function QuotePage() {
  const [admin, reference, spot, allKc, allPremiums] = await Promise.all([
    currentAdmin(),
    getReferenceData(),
    getKcSpot(),
    getKcPrices(),
    getPremiums(),
  ]);

  // Open the KC field with the freshest figure the desk has: the last fetched
  // spot, else the nearest contract month someone entered by hand.
  const kcPrices = allKc
    .filter((k) => k.priceCents > 0)
    .sort((a, b) => compareMonthKeys(a.monthKey, b.monthKey));
  const defaultKcCents = spot?.priceCents ?? kcPrices[0]?.priceCents ?? 0;

  const premiums = allPremiums.filter((p) => p.qualityKey === 'standard' && p.premiumCents !== 0);
  const defaultPremiumCents = premiums[0]?.premiumCents ?? 0;

  return (
    <QuoteBuilder
      reference={reference}
      months={monthOptions(new Date(), 24)}
      isAdmin={Boolean(admin)}
      defaultKcCents={defaultKcCents}
      defaultPremiumCents={defaultPremiumCents}
      kcSpot={spot ? { priceCents: spot.priceCents, asOf: spot.asOf, source: spot.source } : null}
    />
  );
}
