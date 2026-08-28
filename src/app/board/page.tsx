import PriceBoard from '@/components/PriceBoard';
import {
  getKcPrices,
  getKcSpot,
  getPremiumOverrides,
  getReferenceData,
  getSeasonalPremiums,
} from '@/lib/store';
import { compareMonthKeys } from '@/lib/kc';
import { monthOptions } from '@/lib/pricing/schedule';

export const dynamic = 'force-dynamic';

export default async function BoardPage() {
  const [reference, spot, allKc, season, overrides] = await Promise.all([
    getReferenceData(),
    getKcSpot(),
    getKcPrices(),
    getSeasonalPremiums(),
    getPremiumOverrides(),
  ]);

  const kcPrices = allKc
    .filter((k) => k.priceCents > 0)
    .sort((a, b) => compareMonthKeys(a.monthKey, b.monthKey));

  return (
    <PriceBoard
      reference={reference}
      months={monthOptions(new Date(), 18)}
      season={season}
      overrides={overrides}
      defaultKcCents={spot?.priceCents ?? kcPrices[0]?.priceCents ?? 0}
      kcSpot={spot ? { priceCents: spot.priceCents, asOf: spot.asOf, source: spot.source } : null}
    />
  );
}
