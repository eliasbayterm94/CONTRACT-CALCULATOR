import { redirect } from 'next/navigation';
import MultiShipmentBuilder from '@/components/MultiShipmentBuilder';
import { currentAdmin } from '@/lib/auth';
import { getPremiums, getReferenceData } from '@/lib/store';
import { monthOptions } from '@/lib/pricing/schedule';

export const dynamic = 'force-dynamic';

export default async function MultiShipmentPage() {
  // Multi-shipment contracts expose per-shipment cost, so they are admin only.
  if (!(await currentAdmin())) redirect('/admin');

  const [reference, allPremiums] = await Promise.all([getReferenceData(), getPremiums()]);
  const premiums = allPremiums.filter((p) => p.qualityKey === 'standard' && p.premiumCents !== 0);
  return (
    <MultiShipmentBuilder
      reference={reference}
      months={monthOptions(new Date(), 24)}
      defaultPremiumCents={premiums[0]?.premiumCents ?? 0}
    />
  );
}
