import { NextResponse } from 'next/server';
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { HOME_PATH } from '@/lib/routes';

/*
  Next.js proxy (what used to be called middleware). It runs on the edge for
  every API route and every gated page, and it is the HARD half of "protected
  routes": AuthGate on the client is only what makes the redirect pleasant.

  Four rules:

    /login        an already-signed-in visitor is sent on to the app rather than
                  shown a form they don't need.
    pages         no valid session ⇒ redirect to /login, with `next` carrying
                  where they were headed so they land there after signing in.
    /             signed in, this is not a page; it is the way in. Redirected
                  here at the edge so it is a real 307 rather than a rendered
                  page that redirects itself once JavaScript arrives.
    /api/*        no valid session ⇒ 401 before any handler runs. /api/auth/* is
                  exempt: those endpoints manage the session itself.

  Signature verification only, and that is the whole check anywhere in the app:
  the account lives in the environment and the cookie is signed with a key
  derived from the current password hash (src/lib/auth.js), so a cookie that
  verifies is one this deployment issued under the password configured right
  now. No database round-trip, here or in the routes.
*/

async function sessionFrom(request) {
  // Authorization header first (handy for scripts and curl), then the cookie.
  const authHeader = request.headers.get('Authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = bearer || request.cookies.get(SESSION_COOKIE_NAME)?.value || null;
  if (!token) return null;
  return verifySession(token);
}

export async function proxy(request) {
  const { pathname, search } = request.nextUrl;

  // ── API routes: require a valid session ─────────────────────────────────
  if (pathname.startsWith('/api/')) {
    // Auth endpoints manage their own session.
    if (pathname.startsWith('/api/auth/')) return NextResponse.next();

    const session = await sessionFrom(request);
    if (!session?.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.next();
  }

  const session = await sessionFrom(request);

  // ── The login page ──────────────────────────────────────────────────────
  if (pathname === '/login') {
    if (session?.username) {
      const url = request.nextUrl.clone();
      url.pathname = HOME_PATH;
      url.search = '';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // ── Gated pages ─────────────────────────────────────────────────────────
  if (!session?.username) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Remember where they were going, so signing in doesn't dump them at the
    // top of the app after a deep link.
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  // ── The root is the way in, not a destination ───────────────────────────
  if (pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = HOME_PATH;
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/:path*',
    '/login',
    '/',
    // Gated page routes. `:path*` also matches the bare route. Keep in sync with
    // NAV_AREAS in src/lib/navigation.js. An area missing from this list is a
    // page anyone can load without signing in.
    '/inbox/:path*',
    '/today/:path*',
    '/tasks/:path*',
  ],
};
