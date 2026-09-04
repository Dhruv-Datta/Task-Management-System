import { SignJWT, jwtVerify } from 'jose';

/*
  The app's own session cookie: a signed JWT, verified on every request.

  There is no user table and no Supabase Auth. The one account lives in the
  environment (AUTH_USERNAME + AUTH_PASSWORD_HASH, see src/lib/account.js), and
  a session is nothing more than "this cookie was signed by this deployment".
  Supabase holds tasks and settings; it has nothing to do with signing in.

  Deliberately dependency-light (no bcrypt, no database client) because this
  module is bundled into the edge proxy (src/proxy.js), which verifies the
  cookie on every single request.
*/

export const SESSION_COOKIE_NAME = 'session_token';

// Single source of truth for how long a session lives. Drives BOTH the JWT
// `exp` claim (createSession) and the cookie `maxAge` (setSessionCookie), so the
// token and the cookie carrying it can never drift out of sync.
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

// Attributes shared by every write of the session cookie. `secure` is only set
// in production so local http dev still receives the cookie. `sameSite: 'lax'`
// blocks cross-site POSTs (CSRF mitigation).
function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
}

/** Write the session cookie onto a NextResponse (login). */
export function setSessionCookie(response, token) {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    ...baseCookieOptions(),
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}

/** Clear the session cookie (logout, or a denied /api/auth/me probe). */
export function clearSessionCookie(response) {
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    ...baseCookieOptions(),
    maxAge: 0,
  });
  return response;
}

/*
  The signing key.

  It is AUTH_JWT_SECRET *bound to the current password hash*. That is what gives
  an env-only account a working "sign out everywhere": change the password and
  every cookie ever issued under the old one stops verifying on the next
  request, with nothing to revoke and no table to write to. Rotating
  AUTH_JWT_SECRET does the same thing without changing the password.

  HMAC-SHA256 accepts a key of any length, so this is a plain concatenation with
  a separator that cannot appear in a bcrypt hash.

  The password hash is read straight from the environment rather than through
  account.js on purpose: that module pulls in bcrypt, and this one is bundled
  into the edge proxy. The one thing copied from there is the un-escaping, so
  that supplying the hash escaped (as a .env file needs) or raw (as a Vercel
  variable needs) derives the same key, so switching between the two forms must
  not sign you out.
*/
function getSecret() {
  const secret = process.env.AUTH_JWT_SECRET
    || (process.env.NODE_ENV !== 'production' ? 'local-dev-only-insecure-secret' : '');
  if (!secret) throw new Error('AUTH_JWT_SECRET is not set');
  const hash = String(process.env.AUTH_PASSWORD_HASH || '').trim().replaceAll('\\$', '$');
  return new TextEncoder().encode(`${secret}|${hash}`);
}

/**
 * Issue the session cookie's token. The only claim is who you are; there is
 * one account, so there is nothing else a session could say.
 */
export async function createSession({ username }) {
  // Pin iat/exp to the same instant so the JWT expiry matches the cookie
  // maxAge (both derived from SESSION_TTL_SECONDS) to the second.
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + SESSION_TTL_SECONDS)
    .sign(getSecret());
}

export async function verifySession(token) {
  try {
    // Pin the algorithm so a token signed any other way is never accepted.
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] });
    return payload?.username ? payload : null;
  } catch {
    return null;
  }
}
