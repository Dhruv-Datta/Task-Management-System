/*
  Turn a password into the bcrypt hash that goes in AUTH_PASSWORD_HASH.

      npm run hash -- 'your new password'

  The plaintext is never written anywhere; only the hash is, and a bcrypt hash
  cannot be turned back into the password.

  It prints TWO forms of the same hash, because they are consumed differently:

    .env.local  is parsed by dotenv, which expands `$name` as a variable
                reference. A bcrypt hash is full of `$`, so every one has to be
                backslash-escaped or the value silently becomes an empty string.
                Quoting does NOT help: expansion happens inside quotes too.
    Vercel      (and any other "paste the value into a box" setting) does no
                such parsing, so it takes the hash exactly as bcrypt produced it.

  Changing AUTH_PASSWORD_HASH also signs out every existing session: the session
  cookie is signed with a key derived from this hash (src/lib/auth.js), so old
  cookies stop verifying the moment the new value is live.

  The password is an argument, so it lands in your shell history. Prefix the
  command with a space if your shell honours HISTCONTROL=ignorespace, or pick a
  password you don't mind being there.
*/

import bcrypt from 'bcryptjs';

const password = process.argv[2];

if (!password) {
  console.error("Usage: npm run hash -- 'your new password'");
  process.exit(1);
}

// Cost 12: a few hundred milliseconds per attempt, which is the point: it is
// what makes guessing an expensive way to spend an afternoon.
const hash = bcrypt.hashSync(password, 12);
const escaped = hash.replaceAll('$', '\\$');

console.log('\n── for .env.local (escaped, copy the whole line) ──────────────\n');
console.log(`AUTH_PASSWORD_HASH=${escaped}`);
console.log('\n── for Vercel → Settings → Environment Variables (raw) ─────────\n');
console.log(hash);
console.log('\nThe two are the same hash. The backslashes exist only to survive');
console.log('.env parsing, and the app strips any that reach it, so pasting');
console.log('either form in either place still works.');

if (password.length < 12) {
  console.log(
    `\nNote: ${password.length} characters. The login is rate-limited to 5 tries`
    + '\nper 15 minutes, but length is the real defence on a public URL.'
  );
}
