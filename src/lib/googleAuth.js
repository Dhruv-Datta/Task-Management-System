import 'server-only';

import { readSetting, writeSetting } from './appSettings.js';

/*
  THE GOOGLE CONNECTION: one account, one refresh token, kept server-side.

  This app has exactly one login and no users table (see src/lib/account.js), so
  it does not need per-user OAuth plumbing — it needs ONE stored Google grant,
  the way it stores one set of lists. That grant lives in `app_settings` under
  `google_calendar`, in a database whose RLS gives the public key nothing at all
  and which is only ever reached through the service-role key on the server.

      google_calendar → { refresh_token, email, scope, connected_at }

  WHAT NEVER LEAVES THIS FILE'S SIDE OF THE WIRE: the refresh token, the client
  secret, and the access token. /api/google/* returns whether you are connected
  and which account it is, and nothing else. There is deliberately no
  NEXT_PUBLIC_ variable in this feature: the browser cannot talk to Google here,
  because a browser holding a calendar-write token is a browser one XSS away
  from rewriting your week.

  THE SHAPE OF THE FLOW, and why it is the server-side ("authorization code")
  one rather than the popup:

    /api/google/connect   redirects you to Google, with a random `state` also
                          written to a short-lived httpOnly cookie.
    Google                asks you, once, for calendar access.
    /api/google/callback  checks the state cookie matches, swaps the code for a
                          REFRESH token, and stores it.

  From then on nobody is asked anything again: an access token is minted from
  the refresh token whenever one is needed, and it lives in memory for an hour.

  Access tokens are cached per process rather than stored. They expire in an
  hour, a cold start costs one extra round trip to Google, and a token in a
  table is a token that outlives the process that needed it.
*/

const OAUTH_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';
const OAUTH_REVOKE = 'https://oauth2.googleapis.com/revoke';

export const CONNECTION_KEY = 'google_calendar';

/*
  Two scopes, and no more than two.

    calendar.readonly  read the list of calendars and the events on them. This
                       is what draws your real day on the timeline.
    calendar.events    create, move and delete events. Only ever used on events
                       this app wrote (they carry a task id — see
                       lib/googleEvents), but Google has no narrower scope than
                       "events", so the restraint has to be ours.

  Notably NOT requested: any profile or email scope. The connected account's
  address is read off the primary calendar, whose id IS that address, so asking
  for a whole extra consent line to learn it would be rude.
*/
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

export const STATE_COOKIE_NAME = 'google_oauth_state';
export const STATE_COOKIE_MAX_AGE = 600; // ten minutes to finish a consent screen

// ─────────────────────────────────────────────────────────────────────────────
// The three ways this can be "not available", each with its own status
// ─────────────────────────────────────────────────────────────────────────────

/*
  Told apart on purpose, because the fix is different for each and the page says
  a different thing:

    not configured  the deployment has no Google client. Nothing to click; the
                    feature is simply absent. 503, like an unconfigured
                    Supabase (see lib/supabaseServer).
    not connected   configured, but nobody has granted access yet. The page
                    offers Connect. 409 — a state, not a fault.
    revoked         we HAD a grant and Google has stopped honouring it (access
                    removed from the Google account page, or the app's secret
                    rotated). The stored token is dropped so the page offers
                    Connect again rather than failing forever. 401.
*/
export class GoogleNotConfiguredError extends Error {
  constructor() {
    super('Google Calendar is not configured on this deployment (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).');
    this.name = 'GoogleNotConfiguredError';
    this.status = 503;
    this.code = 'not_configured';
  }
}

export class GoogleNotConnectedError extends Error {
  constructor() {
    super('Google Calendar is not connected yet.');
    this.name = 'GoogleNotConnectedError';
    this.status = 409;
    this.code = 'not_connected';
  }
}

export class GoogleAuthError extends Error {
  constructor(message = 'Google access has expired — connect the calendar again.') {
    super(message);
    this.name = 'GoogleAuthError';
    this.status = 401;
    this.code = 'reauth_required';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export function googleConfig() {
  return {
    clientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    // Optional. Left unset, the redirect is derived from the request's own
    // origin, which is what makes one client work for localhost and production
    // without a second set of variables. Set it when the app sits behind
    // something that rewrites the host.
    redirectUri: (process.env.GOOGLE_REDIRECT_URI || '').trim(),
  };
}

export function isGoogleConfigured() {
  const { clientId, clientSecret } = googleConfig();
  return Boolean(clientId && clientSecret);
}

export function assertGoogleConfigured() {
  if (!isGoogleConfigured()) throw new GoogleNotConfiguredError();
}

/**
 * Where Google sends you back to. It has to match a registered redirect URI in
 * the Google Cloud console EXACTLY — same scheme, host, port and path — so it
 * is derived in one place and used by both the consent redirect and the code
 * exchange, which Google also requires to agree with each other.
 */
export function redirectUriFor(request) {
  const configured = googleConfig().redirectUri;
  if (configured) return configured;
  return new URL('/api/google/callback', request.nextUrl?.origin || new URL(request.url).origin).toString();
}

// ─────────────────────────────────────────────────────────────────────────────
// The consent redirect
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `access_type=offline` with `prompt=consent` is what actually returns a
 * REFRESH token. Google issues one only on a fresh grant, so an account that
 * has approved this app before would otherwise come back with an access token
 * that expires in an hour and no way to mint another — a connection that works
 * beautifully until lunchtime.
 */
export function consentUrl({ redirectUri, state }) {
  const { clientId } = googleConfig();
  const url = new URL(OAUTH_AUTHORIZE);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  return url.toString();
}

export function randomState() {
  return crypto.randomUUID().replaceAll('-', '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Talking to the token endpoint
// ─────────────────────────────────────────────────────────────────────────────

async function tokenRequest(body) {
  const res = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    const error = new Error(`Google refused the token request: ${detail}`);
    error.status = res.status === 400 || res.status === 401 ? 401 : 502;
    error.oauthError = data.error || null;
    throw error;
  }
  return data;
}

export async function exchangeCode(code, redirectUri) {
  const { clientId, clientSecret } = googleConfig();
  return tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The stored grant
// ─────────────────────────────────────────────────────────────────────────────

export async function readConnection(supabase) {
  const stored = await readSetting(supabase, CONNECTION_KEY, null);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
  if (!stored.refresh_token) return null;
  return stored;
}

export async function writeConnection(supabase, connection) {
  return writeSetting(supabase, CONNECTION_KEY, connection);
}

export async function clearConnection(supabase) {
  tokenCache = null;
  return writeSetting(supabase, CONNECTION_KEY, null);
}

/** What the browser is allowed to know about the connection: not the token. */
export function publicConnection(connection) {
  if (!connection) return { connected: false, email: null, connectedAt: null };
  return {
    connected: true,
    email: connection.email || null,
    connectedAt: connection.connected_at || null,
  };
}

/**
 * Hand the grant back to Google on disconnect, so "Disconnect" here also
 * removes this app from the account's third-party access list. Best effort:
 * a revoke that fails must not stop us dropping our own copy, or a token Google
 * has already forgotten would be un-disconnectable.
 */
export async function revokeToken(refreshToken) {
  try {
    await fetch(OAUTH_REVOKE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
      cache: 'no-store',
    });
  } catch (err) {
    console.error('Failed to revoke the Google token', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Access tokens
// ─────────────────────────────────────────────────────────────────────────────

/*
  One in-process cache, keyed by the refresh token it came from — so
  reconnecting under a different account can never serve the old account's
  token, and the entry simply misses instead of having to be invalidated.

  A minute of headroom on the expiry, because the token has to survive the
  request it is about to be used for.
*/
let tokenCache = null;

const EXPIRY_HEADROOM_MS = 60_000;

export async function getAccessToken(supabase) {
  assertGoogleConfigured();

  const connection = await readConnection(supabase);
  if (!connection) throw new GoogleNotConnectedError();

  const refreshToken = connection.refresh_token;
  if (tokenCache?.refreshToken === refreshToken && tokenCache.expiresAt > Date.now() + EXPIRY_HEADROOM_MS) {
    return tokenCache.accessToken;
  }

  const { clientId, clientSecret } = googleConfig();
  let fresh;
  try {
    fresh = await tokenRequest({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    });
  } catch (err) {
    /*
      `invalid_grant` is Google saying the refresh token is dead: access removed
      from the account's permissions page, the password changed, six months
      unused, or the OAuth client rebuilt. Keeping it would mean every request
      from here on fails identically forever, with a page still claiming to be
      connected — so it is dropped, and the page goes back to offering Connect.
    */
    if (err.oauthError === 'invalid_grant') {
      await clearConnection(supabase);
      throw new GoogleAuthError();
    }
    throw err;
  }

  tokenCache = {
    refreshToken,
    accessToken: fresh.access_token,
    expiresAt: Date.now() + (Number(fresh.expires_in) || 3600) * 1000,
  };
  return tokenCache.accessToken;
}

/** Drop the cached access token: used when Google 401s one mid-flight. */
export function forgetAccessToken() {
  tokenCache = null;
}
