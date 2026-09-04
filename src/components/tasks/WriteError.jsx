'use client';

/*
  A write that did not land, said out loud.

  Every edit in this app is optimistic: the row changes on screen and the save
  follows. When the save fails the row rolls back, and a row that springs back to
  what it was is the most confusing thing the app can do — it is indistinguishable
  from a button that is simply not wired up. You press it again. It does nothing
  again. You conclude the feature is broken, which is very nearly true and tells
  you nothing about why.

  This is the sentence that closes that gap.

  The MISSING COLUMN case gets its own copy, because it is not a transient fault
  and retrying will never fix it: this app's schema is applied by hand, so a
  database that predates a release is missing exactly the columns that release
  writes — and it FAILS SILENTLY IN ONE DIRECTION. Reads are unaffected (a
  `select *` simply returns fewer fields, and the model defaults them), so every
  list looks perfectly healthy while every write of that field is rejected. The
  fix is a migration, so the message is the migration.
*/

import { AlertTriangle, X } from 'lucide-react';

/*
  PostgREST's wording for the failure, in the two shapes it comes in
  (PGRST204 on a write, 42703 on a filter). Matched on the phrasing rather than
  the code because the code does not survive the error body the route hands on.
*/
function missingColumn(message = '') {
  const match = /Could not find the '([a-z_]+)' column|column tasks\.([a-z_]+) does not exist/i.exec(message);
  return match ? (match[1] || match[2]) : null;
}

export default function WriteError({ error, onDismiss }) {
  const column = missingColumn(error);

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 mb-4 flex items-start gap-3">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-500" />

      <div className="min-w-0 flex-1">
        {column ? (
          <>
            <p className="text-sm font-bold text-red-900">
              Your database is missing the <code className="font-mono">{column}</code> column
            </p>
            <p className="text-[13px] mt-1 leading-relaxed text-red-800">
              Nothing you change here can save until it is added — reading works, writing does
              not, which is why the page looks like it is ignoring you. Open Supabase → SQL
              Editor and run{' '}
              <code className="font-mono font-semibold">supabase/migrations/001_planning_day.sql</code>
              {' '}(or the whole of{' '}
              <code className="font-mono font-semibold">supabase/schema.sql</code>; both are safe to
              re-run and drop nothing). Then reload this page.
            </p>
            <p className="text-[12px] mt-1.5 text-red-700/80">
              <code className="font-mono">npm run db:check</code> confirms when it is done.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-bold text-red-900">That change didn’t save</p>
            <p className="text-[13px] mt-0.5 leading-relaxed text-red-800">{error}</p>
            <p className="text-[12px] mt-1.5 text-red-700/80">
              What you see has been put back to what the server has. Try again.
            </p>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss"
        className="p-1.5 rounded-lg text-red-400 hover:text-red-700 hover:bg-red-100 shrink-0 transition-colors"
      >
        <X size={15} />
      </button>
    </div>
  );
}
