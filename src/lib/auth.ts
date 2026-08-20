import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { getSetting, setSetting } from './store';

const COOKIE = 'fc_admin';
const MAX_AGE_SECONDS = 60 * 60 * 12;

/* ------------------------------------------------------------- secrets -- */

/**
 * The key that signs the session cookie.
 *
 * Generated once and kept with the rest of the state so the app needs no
 * configuration to run. An explicit SESSION_SECRET wins where one is set — on a
 * multi-instance deployment every instance has to sign with the same key.
 */
async function sessionSecret(): Promise<string> {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv) return fromEnv;
  const stored = await getSetting<string | null>('sessionSecret', null);
  if (stored) return stored;
  const generated = crypto.randomBytes(32).toString('base64url');
  await setSetting('sessionSecret', generated);
  return generated;
}

/* ---------------------------------------------------------- admin code -- */

interface StoredCode {
  salt: string;
  hash: string;
}

const derive = (code: string, salt: string): string =>
  crypto.scryptSync(code.normalize('NFKC'), salt, 32).toString('hex');

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** True once someone has chosen a code — otherwise admin runs its setup screen. */
export async function isAdminCodeSet(): Promise<boolean> {
  if (process.env.ADMIN_PASSWORD) return true;
  return (await getSetting<StoredCode | null>('adminCode', null)) !== null;
}

/** Store a new code. Only the salt and the derived hash are kept, never the code. */
export async function setAdminCode(code: string): Promise<void> {
  const salt = crypto.randomBytes(16).toString('hex');
  await setSetting<StoredCode>('adminCode', { salt, hash: derive(code, salt) });
  await setSetting('adminLockout', { failures: 0, until: 0 });
}

export async function verifyAdminCode(candidate: string): Promise<boolean> {
  // An ADMIN_PASSWORD in the environment overrides the stored code, so a
  // deployment can always be recovered without reaching into the state.
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv) return safeEqual(candidate.normalize('NFKC'), fromEnv.normalize('NFKC'));

  const stored = await getSetting<StoredCode | null>('adminCode', null);
  if (!stored) return false;
  return safeEqual(derive(candidate, stored.salt), stored.hash);
}

/* --------------------------------------------------------- throttling -- */

interface Lockout {
  failures: number;
  until: number;
}

const NO_LOCKOUT: Lockout = { failures: 0, until: 0 };
const FREE_ATTEMPTS = 4;
const MAX_WAIT_SECONDS = 900;

/** Seconds still to wait, or 0 when an attempt is allowed. */
export async function lockoutRemaining(): Promise<number> {
  const { until } = await getSetting<Lockout>('adminLockout', NO_LOCKOUT);
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

/**
 * A short code is only safe if guessing is slow. Each failure past the first
 * few doubles the wait, up to fifteen minutes.
 */
export async function recordFailedAttempt(): Promise<number> {
  const current = await getSetting<Lockout>('adminLockout', NO_LOCKOUT);
  const failures = current.failures + 1;
  const over = failures - FREE_ATTEMPTS;
  const wait = over <= 0 ? 0 : Math.min(MAX_WAIT_SECONDS, 15 * 2 ** (over - 1));
  await setSetting<Lockout>('adminLockout', { failures, until: Date.now() + wait * 1000 });
  return wait;
}

export async function clearFailedAttempts(): Promise<void> {
  await setSetting<Lockout>('adminLockout', NO_LOCKOUT);
}

/* ----------------------------------------------------------- sessions -- */

async function sign(payload: string): Promise<string> {
  return crypto.createHmac('sha256', await sessionSecret()).update(payload).digest('base64url');
}

export async function issueToken(actor: string): Promise<string> {
  const expires = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = `${actor}.${expires}`;
  return `${Buffer.from(payload).toString('base64url')}.${await sign(payload)}`;
}

export async function readToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  let payload: string;
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!safeEqual(signature, await sign(payload))) return null;
  const separator = payload.lastIndexOf('.');
  const actor = payload.slice(0, separator);
  const expires = Number(payload.slice(separator + 1));
  if (!Number.isFinite(expires) || Date.now() > expires) return null;
  return actor;
}

/** The signed-in admin, or null. Never throws — a bad cookie means signed out. */
export async function currentAdmin(): Promise<string | null> {
  try {
    const store = await cookies();
    return await readToken(store.get(COOKIE)?.value);
  } catch {
    return null;
  }
}

export async function requireAdmin(): Promise<string> {
  const actor = await currentAdmin();
  if (!actor) throw new AuthError('Admin sign-in required');
  return actor;
}

export class AuthError extends Error {}

/**
 * Is the admin looking at the desk through a trader's eyes?
 *
 * A preview of what is hidden, not a change of who you are. The session and
 * every guard still see the real admin — only what the screen chooses to draw
 * follows this, which is why an admin previewing can never lock themselves
 * out of getting back.
 */
export const VIEW_COOKIE = 'fc_view';

export async function viewingAsTrader(): Promise<boolean> {
  try {
    return (await cookies()).get(VIEW_COOKIE)?.value === 'trader';
  } catch {
    return false;
  }
}

export const COOKIE_NAME = COOKIE;
export const COOKIE_MAX_AGE = MAX_AGE_SECONDS;
