import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth';
import { getSession } from '@/lib/db';

/*
  GET /api/auth/me: "am I still signed in, and as whom?"

  A cookie signed under an older password (or an older AUTH_JWT_SECRET) no
  longer verifies, so it fails here exactly as an expired one does.
*/

export async function GET() {
  const session = await getSession();

  if (!session) {
    // Clear the cookie on the way out: whatever it held is no longer usable, and
    // leaving it in place just means re-checking a dead token on every request.
    return clearSessionCookie(NextResponse.json({ authenticated: false }, { status: 401 }));
  }

  return NextResponse.json({
    authenticated: true,
    user: { username: session.username },
  });
}
