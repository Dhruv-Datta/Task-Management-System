import { NextResponse } from 'next/server';
import { getSession } from '@/lib/db';
import { HOME_PATH, ROUTES } from '@/lib/routes';
import {
  STATE_COOKIE_MAX_AGE, STATE_COOKIE_NAME, consentUrl, isGoogleConfigured, randomState,
  redirectUriFor,
} from '@/lib/googleAuth';

/*
  /api/google/connect: the way in.

  A REDIRECT rather than an endpoint that returns a URL, because this is a
  browser navigation and not a fetch — the page sends you here, Google asks you
  once, and /api/google/callback catches you on the way back.

  The `state` is the CSRF guard on that round trip, and it is checked on the
  other side against a cookie only this deployment can have written. Without it,
  anyone could hand you a link to our callback carrying a code from THEIR Google
  account, and your app would quietly end up connected to a stranger's calendar.

  It is httpOnly, ten minutes long, and lax like the session cookie — which is
  exactly what is needed here, since the callback arrives as a top-level GET
  navigation from accounts.google.com and lax cookies ride along with those.

  Everything here is behind the proxy's session check (src/proxy.js), so only a
  signed-in visitor can start the flow at all.
*/

export async function GET(request) {
  /*
    Session-gated like every other route, and answered as a NAVIGATION rather
    than as JSON: this URL is followed by a browser, so an unauthenticated visit
    belongs at the sign-in page and not at a 401 body rendered as text. The
    proxy has generally said yes long before this; the belt to its braces is
    what makes a stray link to this URL useless to anyone who is not signed in.
  */
  if (!(await getSession())) {
    const login = new URL(ROUTES.login, request.nextUrl.origin);
    login.searchParams.set('next', HOME_PATH);
    return NextResponse.redirect(login);
  }

  const back = new URL(HOME_PATH, request.nextUrl.origin);

  if (!isGoogleConfigured()) {
    back.searchParams.set('google', 'unconfigured');
    return NextResponse.redirect(back);
  }

  const state = randomState();
  const response = NextResponse.redirect(consentUrl({
    redirectUri: redirectUriFor(request),
    state,
  }));

  response.cookies.set(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_COOKIE_MAX_AGE,
  });

  return response;
}
