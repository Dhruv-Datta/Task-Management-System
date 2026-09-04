import 'server-only';
import bcrypt from 'bcryptjs';

/*
  The one account, and the whole of it.

  Both halves live in the environment:

      AUTH_USERNAME       in the clear
      AUTH_PASSWORD_HASH  a bcrypt hash; the plaintext is never stored anywhere

  There is no users table, no Supabase Auth, and no seeding step. Changing the
  password is editing one line of .env.local (or one Vercel environment
  variable). Because the session cookie is signed with a key derived from
  this hash (src/lib/auth.js), doing so signs out every existing session by
  itself.

  Server-only: bcrypt should never reach the browser, and neither should the
  hash.
*/

export function configuredUsername() {
  return String(process.env.AUTH_USERNAME || '').trim();
}

/*
  The bcrypt hash, read defensively.

  A bcrypt hash is `$2b$12$<salt><digest>`, and those `$` signs are a hazard in
  a .env file: Next's loader runs dotenv-expand, which treats `$name` as a
  variable reference and, since no variable called `2b` exists, replaces it
  with nothing. Quoting does NOT help; expansion happens inside single and
  double quotes alike. So in .env.local every `$` must be backslash-escaped:

      AUTH_PASSWORD_HASH=\$2b\$12\$abc…

  dotenv un-escapes those on the way in, so this code receives the real hash.
  A value set OUTSIDE a .env file (a Vercel environment variable, an exported
  shell variable) goes through no such parsing and must be the raw hash.

  Both are accepted here: any surviving backslash-before-dollar is stripped, so
  pasting the escaped form into Vercel works too. `npm run hash` prints both
  forms, labelled.
*/
function configuredPasswordHash() {
  return String(process.env.AUTH_PASSWORD_HASH || '').trim().replaceAll('\\$', '$');
}

// `$2b$12$` + 53 chars of base64-ish salt and digest.
const BCRYPT_SHAPE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isAccountConfigured() {
  return Boolean(configuredUsername() && configuredPasswordHash());
}

export function assertAccountConfigured() {
  if (!configuredUsername()) {
    throw new Error('No login is configured: AUTH_USERNAME is not set (see .env.example).');
  }
  const hash = configuredPasswordHash();
  if (!hash) {
    // Overwhelmingly the cause: an unescaped hash in .env.local, which
    // dotenv-expand quietly turned into an empty string. Say so, because
    // "AUTH_PASSWORD_HASH is missing" sends you to look at a line that is
    // visibly right there in the file.
    throw new Error(
      'AUTH_PASSWORD_HASH is empty. If it looks set in .env.local, its $ signs are '
      + 'probably unescaped: write it as \\$2b\\$12\\$… or re-run `npm run hash`.'
    );
  }
  if (!BCRYPT_SHAPE.test(hash)) {
    throw new Error(
      `AUTH_PASSWORD_HASH is not a bcrypt hash (got ${hash.length} characters). Re-run \`npm run hash\`.`
    );
  }
}

/** Case-insensitive, so "Dhruv" and "dhruv" are the same person. */
export function matchesUsername(input) {
  const configured = configuredUsername();
  if (!configured) return false;
  return String(input || '').trim().toLowerCase() === configured.toLowerCase();
}

/** Constant-time-ish bcrypt comparison against the configured hash. */
export function verifyPassword(password) {
  const hash = configuredPasswordHash();
  if (!hash) return false;
  try {
    return bcrypt.compareSync(String(password ?? ''), hash);
  } catch {
    // A malformed hash (truncated on the way into the environment, say) is a
    // configuration error, not a wrong password, but it must still not sign
    // anyone in.
    return false;
  }
}
