import QuoteBuilder from '@/components/QuoteBuilder';
import { currentAdmin, viewingAsTrader } from '@/lib/auth';
import {
  getFxRows,
  getKcPrices,
  getKcSpot,
  getPremiumOverrides,
  getReferenceData,
  getSeasonalPremiums,
} from '@/lib/store';
import { compareMonthKeys } from '@/lib/kc';
import { monthOptions } from '@/lib/pricing/schedule';

export const dynamic = 'force-dynamic';

export default async function QuotePage() {
  const [admin, previewing, reference, spot, allKc, season, overrides, fxRows] = await Promise.all([
    currentAdmin(),
    viewingAsTrader(),
    getReferenceData(),
    getKcSpot(),
    getKcPrices(),
    getSeasonalPremiums(),
    getPremiumOverrides(),
    getFxRows(),
  ]);

  // Open the KC field with the freshest figure the desk has: the last fetched
  // spot, else the nearest contract month someone entered by hand.
  const kcPrices = allKc
    .filter((k) => k.priceCents > 0)
    .sort((a, b) => compareMonthKeys(a.monthKey, b.monthKey));
  const defaultKcCents = spot?.priceCents ?? kcPrices[0]?.priceCents ?? 0;



  // A seeded row was never set by anyone — it is a placeholder, and the desk
  // should hear about it as loudly as a rate nobody has touched in a month.
  const setAt = (updatedAt: string | null, updatedBy: string | null) =>
    !updatedAt || updatedBy === 'seed' ? null : updatedAt;

  const freshness = [
    {
      label: 'KC futures',
      where: 'KC & premiums',
      updatedAt: spot?.asOf ?? setAt(kcPrices[0]?.updatedAt ?? null, kcPrices[0]?.updatedBy ?? null),
    },
    ...fxRows
      .filter((row) => row.currency !== 'USD')
      .map((row) => ({
        label: `${row.currency} rate`,
        where: 'Exchange rates',
        updatedAt: row.source === 'seed' ? null : row.fetchedAt,
      })),
  ];

  return (
    <QuoteBuilder
      reference={reference}
      freshness={freshness}
      months={monthOptions(new Date(), 24)}
      season={season}
      overrides={overrides}
      isAdmin={Boolean(admin) && !previewing}
      defaultKcCents={defaultKcCents}
      kcSpot={spot ? { priceCents: spot.priceCents, asOf: spot.asOf, source: spot.source } : null}
    />
  );
}
