import 'server-only';
import { createClient } from '@supabase/supabase-js';

/*
  Server-only Supabase client using the service-role key.

  This key BYPASSES Row Level Security, so it must never reach the browser. The
  `server-only` import above makes the build fail if any client component pulls
  this module into its bundle.

  Why it works this way: the app authenticates with its own JWT cookie
  (src/lib/auth.js), not Supabase Auth, so there is no `auth.uid()` for RLS to
  key off. RLS is therefore enabled on every table with NO policies at all
  (which locks the public anon key completely out of the database) and all
  access runs server-side through this trusted client. The browser never talks
  to Supabase directly; it talks to the API routes under src/app/api.

  See supabase/schema.sql for the matching lockdown.

  The client is built from placeholders when the environment is unset so that
  importing this module can never break a build (Vercel evaluates route modules
  at build time, before your project env vars necessarily exist locally).
  `assertSupabaseConfigured()` is what turns a missing key into a clear error,
  at the moment a request actually needs the database.
*/

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && serviceRoleKey);

/*
  Thrown when the environment has no database in it. It carries `status = 503`
  so apiResponses turns it into "Service Unavailable" with this message, rather
  than a bare 500 that reads like the code broke. The code is fine, the
  deployment is simply not finished.
*/
export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY '
      + 'in .env.local (see .env.example), run supabase/schema.sql against the project, '
      + 'then restart the dev server. Check it with: npm run db:check'
    );
    this.name = 'SupabaseNotConfiguredError';
    this.status = 503;
  }
}

export function assertSupabaseConfigured() {
  if (!isSupabaseConfigured) throw new SupabaseNotConfiguredError();
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  serviceRoleKey || 'placeholder',
  { auth: { persistSession: false, autoRefreshToken: false } }
);
