import { NextResponse } from 'next/server';
import { getDb, getSession } from '@/lib/db';
import { HOME_PATH, ROUTES } from '@/lib/routes';
import {
  GOOGLE_SCOPES, STATE_COOKIE_NAME, exchangeCode, isGoogleConfigured, readConnection,
  redirectUriFor, writeConnection,
} from '@/lib/googleAuth';

/*
  /api/google/callback: the way back.

  Google returns you here with a one-time `code`, which is swapped — server to
  server, using the client secret — for a REFRESH token. That token is the whole
  connection, and it is the only part of any of this the browser never sees.

  Every failure ends the same way: back on /today with `?google=<reason>`, so
  the page can say what went wrong in a sentence. A blank page carrying an
  OAuth error code is the worst possible end to a flow whose entire purpose was
  to be pressed once and forgotten.
*/

function back(request, status) {
  const url = new URL(HOME_PATH, request.nextUrl.origin);
  url.searchParams.set('google', status);
  return url;
}

function clearState(response) {
  response.cookies.set(STATE_COOKIE_NAME, '', { path: '/', maxAge: 0 });
  return response;
}

export async function GET(request) {
  // A browser is following this, so an expired session is a trip to the sign-in
  // page rather than a JSON error rendered as a page. The code in the URL is
  // one-time and about to expire anyway: signing in and pressing Connect again
  // is the only route back from here, so that is where this leads.
  if (!(await getSession())) {
    const login = new URL(ROUTES.login, request.nextUrl.origin);
    login.searchParams.set('next', HOME_PATH);
    return clearState(NextResponse.redirect(login));
  }

  const { supabase } = await getDb();
  const params = request.nextUrl.searchParams;

  // You pressed Cancel on the consent screen, or Google refused outright.
  if (params.get('error')) {
    return clearState(NextResponse.redirect(back(request, 'denied')));
  }

  if (!isGoogleConfigured()) {
    return clearState(NextResponse.redirect(back(request, 'unconfigured')));
  }

  /*
    The state check. Both halves have to be present AND equal: a callback with
    no cookie is one that did not start here (or started more than ten minutes
    ago), and a mismatch is someone else's authorization being walked into this
    account.
  */
  const expected = request.cookies.get(STATE_COOKIE_NAME)?.value;
  const state = params.get('state');
  if (!expected || !state || expected !== state) {
    return clearState(NextResponse.redirect(back(request, 'state')));
  }

  const code = params.get('code');
  if (!code) return clearState(NextResponse.redirect(back(request, 'error')));

  try {
    const token = await exchangeCode(code, redirectUriFor(request));

    /*
      A grant with no refresh token is a connection that dies at lunchtime.
      `prompt=consent` is asked for precisely so this cannot happen, but if
      Google ever does hand back only an access token, the previously stored
      refresh token is kept rather than overwritten with nothing — re-connecting
      an already-connected calendar must never be able to break it.
    */
    const existing = await readConnection(supabase);
    const refreshToken = token.refresh_token || existing?.refresh_token;
    if (!refreshToken) {
      return clearState(NextResponse.redirect(back(request, 'no_refresh_token')));
    }

    /*
      Which account this is. Read from the primary calendar rather than by
      asking for a profile scope: a primary calendar's id IS the account's email
      address, so the answer is already inside the access we have just been
      given, and the consent screen stays two lines long.
    */
    let email = existing?.email || null;
    try {
      const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', {
        headers: { Authorization: `Bearer ${token.access_token}` },
        cache: 'no-store',
      });
      if (res.ok) email = (await res.json())?.id || email;
    } catch (err) {
      // Cosmetic. The connection works without knowing what it is called.
      console.error('Connected, but could not read the Google account name', err);
    }

    await writeConnection(supabase, {
      refresh_token: refreshToken,
      email,
      scope: token.scope || GOOGLE_SCOPES.join(' '),
      connected_at: new Date().toISOString(),
    });

    return clearState(NextResponse.redirect(back(request, 'connected')));
  } catch (err) {
    console.error('Google Calendar connection failed', err);
    return clearState(NextResponse.redirect(back(request, 'error')));
  }
}
