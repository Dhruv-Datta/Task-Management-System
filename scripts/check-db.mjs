/*
  A five-second answer to "is this wired up?".

      npm run db:check

  Checks the environment, connects to Supabase with the service-role key, and
  confirms the two tables exist. Reads only: it writes nothing and creates
  nothing.

  It loads .env.local through Next's own loader rather than node's
  `--env-file`, and that distinction matters: Next runs dotenv-expand, node does
  not. An unescaped bcrypt hash reads fine to node and arrives EMPTY in the app,
  which is precisely the failure this script exists to catch, so it has to see
  the environment the app will actually get, not a friendlier version of it.
*/

// @next/env is CommonJS, so it comes in through the default export.
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

let failed = false;

const report = (ok, label) => {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failed = true;
};

// ── The login: entirely environment, no database involved ──────────────────
report(Boolean(process.env.AUTH_USERNAME), `AUTH_USERNAME${process.env.AUTH_USERNAME ? ` = "${process.env.AUTH_USERNAME}"` : ' is MISSING'}`);

// The app un-escapes on read (src/lib/account.js); mirror that here so a
// correctly-escaped .env value isn't reported as broken.
const hash = (process.env.AUTH_PASSWORD_HASH || '').trim().replaceAll('\\$', '$');
if (!hash) {
  report(false,
    'AUTH_PASSWORD_HASH is EMPTY. If the line looks present in .env.local, its $ signs'
    + '\n  are unescaped and dotenv ate them; it must read \\$2b\\$12\\$… (npm run hash prints it).');
} else if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) {
  report(false, `AUTH_PASSWORD_HASH is not a bcrypt hash (got ${hash.length} chars). Re-run: npm run hash -- 'your password'`);
} else {
  report(true, 'AUTH_PASSWORD_HASH is a well-formed bcrypt hash');
}

report(Boolean(process.env.AUTH_JWT_SECRET), `AUTH_JWT_SECRET${process.env.AUTH_JWT_SECRET ? ' is set' : ' is MISSING (required in production)'}`);

// ── Supabase: where the tasks live ─────────────────────────────────────────
report(Boolean(url), `NEXT_PUBLIC_SUPABASE_URL${url ? ' is set' : ' is MISSING'}`);
report(Boolean(key), `SUPABASE_SERVICE_ROLE_KEY${key ? ' is set' : ' is MISSING'}`);

/*
  Google Calendar is OPTIONAL, so neither of these can fail the check: an app
  with no Google client is a correctly configured app that simply doesn't draw
  your calendar. What is worth saying out loud is the HALF-configured state —
  one of the two filled in — because that produces a Connect button that goes
  all the way to Google's consent screen and then fails on the way back, which
  is the least debuggable shape this could take.
*/
const googleId = process.env.GOOGLE_CLIENT_ID;
const googleSecret = process.env.GOOGLE_CLIENT_SECRET;
if (googleId && googleSecret) {
  console.log('✓ Google Calendar is configured (optional)');
} else if (googleId || googleSecret) {
  report(false,
    `Google Calendar is HALF configured: ${googleId ? 'GOOGLE_CLIENT_SECRET' : 'GOOGLE_CLIENT_ID'} is missing.`
    + '\n  Connecting will fail on the way back from Google. Fill both in, or neither.');
} else {
  console.log('· Google Calendar is not configured (optional — see .env.example)');
}

if (!url || !key) {
  console.log('\nFill those in .env.local (see .env.example) and run this again.');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

for (const table of ['tasks', 'app_settings']) {
  const { error, count } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (error) {
    report(false, `table "${table}": ${error.message}`);
  } else {
    report(true, `table "${table}": ${count} row${count === 1 ? '' : 's'}`);
  }
}

/*
  A table can exist and still be out of date: CREATE TABLE IF NOT EXISTS does
  nothing to a table that is already there, so a database from before /today has
  every table and none of the planning columns. Asking for them by name is the
  cheapest way to tell those two states apart, and this is the script whose
  whole job is telling you which one you are in.
*/
const PLANNING_COLUMNS = 'planned_date,daily_priority,estimated_minutes,scheduled_start,scheduled_minutes,is_hard';
const { error: columnsError } = await supabase.from('tasks').select(PLANNING_COLUMNS).limit(1);
report(
  !columnsError,
  columnsError
    ? `tasks is missing one of the /today planning columns (${columnsError.message}).`
      + '\n  Re-run supabase/schema.sql: it is idempotent and adds them.'
      + '\n  Or supabase/migrations/001_planning_day.sql, which is just those columns.'
    : 'tasks has the /today planning columns'
);

/*
  The tag column, asked for separately from the planning ones, because it is
  what an otherwise perfectly healthy database is most likely to be missing
  right now — and because the failure it causes is a quiet one: everything reads
  fine, and only tagging a block on the timeline is refused.
*/
const { error: tagError } = await supabase.from('tasks').select('google_label_id').limit(1);
report(
  !tagError,
  tagError
    ? `tasks is missing google_label_id (${tagError.message}).`
      + '\n  Tagging a block on the timeline will fail until it is there. Re-run supabase/schema.sql,'
      + '\n  or just: ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS google_label_id text;'
    : 'tasks has the timeline tag column'
);

if (failed) {
  console.log('\nIf a table or a column is missing, run supabase/schema.sql against this project.');
} else {
  console.log(`\nAll set. \`npm run dev\`, then sign in as "${process.env.AUTH_USERNAME}" at http://localhost:3000/login`);
}

process.exit(failed ? 1 : 0);
