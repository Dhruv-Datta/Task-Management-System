import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth';

/*
  POST /api/auth/logout: drop the cookie.

  There is nothing server-side to revoke: the account lives in the environment,
  so there is no session record anywhere to mark dead. To invalidate a cookie
  you no longer control (one left signed in on someone else's laptop) change
  AUTH_PASSWORD_HASH or AUTH_JWT_SECRET and redeploy. The signing key is derived
  from both (src/lib/auth.js), so either one kills every session at once.
*/

export async function POST() {
  return clearSessionCookie(NextResponse.json({ ok: true }));
}
