import { redirect } from 'next/navigation';
import MultiShipmentBuilder from '@/components/MultiShipmentBuilder';
import { currentAdmin } from '@/lib/auth';
import { getPremiumOverrides, getReferenceData, getSeasonalPremiums } from '@/lib/store';
import { monthOptions } from '@/lib/pricing/schedule';

export const dynamic = 'force-dynamic';

export default async function MultiShipmentPage() {
  // Multi-shipment contracts expose per-shipment cost, so they are admin only.
  if (!(await currentAdmin())) redirect('/admin');

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
