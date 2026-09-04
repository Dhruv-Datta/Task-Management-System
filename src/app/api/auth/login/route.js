import { NextResponse } from 'next/server';
import { createSession, setSessionCookie } from '@/lib/auth';
import {
  assertAccountConfigured, configuredUsername, matchesUsername, verifyPassword,
} from '@/lib/account';
import {
  clientIp,
  isLoginBlocked,
  recordLoginFailure,
  clearLoginFailures,
} from '@/lib/loginRateLimit';

/*
  POST /api/auth/login: the only way in.

  The account is AUTH_USERNAME + AUTH_PASSWORD_HASH from the environment; there
  is nothing to look up. Brute-force guard first, bcrypt compare second, session
  cookie third, and one indistinguishable "Invalid credentials" for both a
  wrong username and a wrong password, so the endpoint never confirms which half
  was right.

  That rate limiter is doing real work here: a short password behind a public
  URL is only as safe as the number of guesses someone gets.
*/

export async function POST(request) {
  let username;
  let password;
  try {
    ({ username, password } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  if (!username || !password) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  try {
    assertAccountConfigured();

    // Repeated failures for this ip/username are refused before any password
    // check runs. A successful login clears the counter.
    const ip = clientIp(request);
    if (isLoginBlocked(ip, username)) {
      return NextResponse.json(
        { error: 'Too many failed attempts. Try again in a few minutes.' },
        { status: 429 }
      );
    }

    // Both halves are checked, and the password is checked even when the
    // username is wrong: skipping bcrypt on a bad username would make a bad
    // username measurably faster to reject than a bad password.
    const okUser = matchesUsername(username);
    const okPassword = verifyPassword(password);
    if (!okUser || !okPassword) {
      recordLoginFailure(ip, username);
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    clearLoginFailures(ip, username);

    // The stored spelling wins, so the app greets you as "dhruv" however you
    // typed it.
    const name = configuredUsername();
    const token = await createSession({ username: name });
    return setSessionCookie(NextResponse.json({ ok: true, username: name }), token);
  } catch (error) {
    /*
      Anything thrown here is a SERVER fault: an unset environment variable, a
      malformed hash. A wrong username or password returns 401 above without
      throwing, so reporting these as "Invalid credentials" would send you
      hunting for a password problem that doesn't exist.
    */
    return NextResponse.json(
      { error: error?.message || 'Sign-in is unavailable right now.' },
      { status: 500 }
    );
  }
}
