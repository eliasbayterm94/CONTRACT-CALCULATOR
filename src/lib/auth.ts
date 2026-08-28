import { cookies } from 'next/headers';

/**
 * There is no sign-in.
 *
 * The desk is one person, and a code they entered twice a day protected a
 * screen only they opened. It is gone, and with it the session, the lockout
 * and the stored hash — dead machinery is worse than none.
 *
 * What that leaves is a public site. Whoever reaches the URL sees the costs
 * and can edit the rates, so the door is now the host's: Netlify's own
 * visitor password, or a private URL. This module keeps only the one thing
 * that is still a choice rather than a permission.
 */

/** The name a change is recorded under in the audit log. */
export const DESK_ACTOR = 'desk';

export const VIEW_COOKIE = 'fc_view';

/**
 * Is the desk looking at its own screens through a trader's eyes?
 *
 * A preview of what a client-facing quote hides, not a change of rights —
 * there are none left to change.
 */
export async function viewingAsTrader(): Promise<boolean> {
  try {
    return (await cookies()).get(VIEW_COOKIE)?.value === 'trader';
  } catch {
    return false;
  }
}

export const VIEW_MAX_AGE = 60 * 60 * 24 * 365;
