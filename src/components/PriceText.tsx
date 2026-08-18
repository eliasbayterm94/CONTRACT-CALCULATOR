import type { CurrencyCode } from '@/lib/pricing/types';
import { priceParts } from '@/lib/format';

/**
 * A price with its decimals set smaller than the whole unit, so the cents read
 * as cents at a glance rather than competing with the dollars or euros.
 */
export default function PriceText({
  value,
  currency,
}: {
  value: number;
  currency: CurrencyCode;
}) {
  const { whole, cents } = priceParts(value, currency);
  return (
    <>
      <span className="qc-int">{whole}</span>
      {cents && <span className="qc-dec">{cents}</span>}
    </>
  );
}
