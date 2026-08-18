import crypto from 'node:crypto';
import { cookies } from 'next/headers';

const COOKIE = 'fc_admin';
const MAX_AGE_SECONDS = 60 * 60 * 12;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    // A missing secret must not silently fall back to a guessable default, or
    // anyone could forge an admin cookie.
    throw new Error('SESSION_SECRET is not set — admin sign-in is disabled.');
  }
  return value;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Constant-time string compare that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function verifyPassword(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return safeEqual(candidate, expected);
}

export function issueToken(actor: string): string {
  const expires = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = `${actor}.${expires}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

export function readToken(token: string | undefined): string | null {
  if (!token) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  let payload: string;
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!safeEqual(signature, sign(payload))) return null;
  const separator = payload.lastIndexOf('.');
  const actor = payload.slice(0, separator);
  const expires = Number(payload.slice(separator + 1));
  if (!Number.isFinite(expires) || Date.now() > expires) return null;
  return actor;
}

/** The signed-in admin, or null. Never throws — an unset secret means signed out. */
export async function currentAdmin(): Promise<string | null> {
  try {
    const store = await cookies();
    return readToken(store.get(COOKIE)?.value);
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

export const COOKIE_NAME = COOKIE;
export const COOKIE_MAX_AGE = MAX_AGE_SECONDS;
