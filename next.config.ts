import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    /**
     * How long the client may reuse a route it has already fetched.
     *
     * Every route here is server-rendered per request, and Next treats a
     * prefetched dynamic route as stale the moment it arrives — so each tab
     * switch paid for a fresh round trip even though the payload was already
     * in hand. Thirty seconds is well inside how long a quoting session stays
     * on one set of rates, and a save calls revalidatePath, which drops this
     * cache immediately. So an edit is never hidden by it.
     */
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
