import MultiShipmentBuilder from '@/components/MultiShipmentBuilder';
import { getPremiumOverrides, getReferenceData, getSeasonalPremiums } from '@/lib/store';
import { monthOptions } from '@/lib/pricing/schedule';

export const dynamic = 'force-dynamic';

export default async function MultiShipmentPage() {
  const [reference, season, overrides] = await Promise.all([
    getReferenceData(),
    getSeasonalPremiums(),
    getPremiumOverrides(),
  ]);
  return (
    <MultiShipmentBuilder
      reference={reference}
      months={monthOptions(new Date(), 24)}
      season={season}
      overrides={overrides}
    />
  );
}
