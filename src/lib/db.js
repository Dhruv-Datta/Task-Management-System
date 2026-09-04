import { cookies } from 'next/headers';
import { supabase, assertSupabaseConfigured } from './supabaseServer.js';
import { SESSION_COOKIE_NAME, verifySession } from './auth.js';

/*
  Request-scoped data access.

  `getSession()` resolves the signed session cookie into an identity. That is
  the entire check: the account lives in the environment, and the cookie is
  signed with a key derived from the current password hash (src/lib/auth.js), so
  a token that verifies is a token issued by this deployment under the password
  that is configured right now. Change the password, or rotate
  AUTH_JWT_SECRET, and every existing cookie stops verifying on its next
  request. No database round-trip, on any route.

  `getDb()` is fail-closed: a request without a valid session gets no database
  access at all (it throws), so no route can accidentally read data without
  having proved who it is.
*/

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await verifySession(token);
  if (!session?.username) return null;

  return { username: session.username };
}

/**
 * The Supabase client, for a request that has proved who it is. Throws when it
 * has not, and when Supabase itself is unconfigured. Both are conditions the
 * caller should surface rather than paper over with an empty result.
 */
export async function getDb() {
  const session = await getSession();
  if (!session) {
    // The proxy 401s these before a handler runs, so this is the belt to its
    // braces, tagged with its status so it can never surface as a 500.
    const err = new Error('Not authenticated.');
    err.status = 401;
    throw err;
  }
  assertSupabaseConfigured();
  return { session, supabase };
}
